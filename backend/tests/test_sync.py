"""Offline-first sync: device login + refresh tokens, on-device enrolment, pull and push."""
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np

from app.config import settings
from app.database import SessionLocal
from app.models import Course, Device, Enrollment, Student

from .conftest import make_jpeg

PASSWORD = "secret123"


def _uid() -> str:
    return uuid.uuid4().hex[:6].upper()


def _now_iso(delta: timedelta = timedelta(0)) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _new_lecturer(client) -> tuple[str, dict]:
    email = f"sync{_uid().lower()}@ui.edu.ng"
    r = client.post("/auth/lecturer/register", json={
        "name": "Sync Lecturer", "email": email, "department": "Computer Science", "password": PASSWORD,
    })
    assert r.status_code == 201, r.text
    return email, _auth(r.json()["access_token"])


def _device_login(client, email: str, device_id: str | None = None) -> dict:
    r = client.post("/auth/lecturer/login", json={
        "email": email, "password": PASSWORD, "device_id": device_id or str(uuid.uuid4()),
        "device_label": "Galaxy S23", "app_version": "2.0.0",
    })
    assert r.status_code == 200, r.text
    return r.json()


def _face(seed: int, poses: int = 3) -> list[list[float]]:
    """A fake person: one random direction plus small per-pose noise (well inside the same-person limit)."""
    rng = np.random.default_rng(seed)
    base = rng.normal(size=512)
    base /= np.linalg.norm(base)
    return [(base + rng.normal(scale=0.01, size=512)).tolist() for _ in range(poses)]


def _new_student(client, face_seed: int | None) -> tuple[dict, dict]:
    r = client.post("/auth/student/register", json={
        "matric_no": f"SYN/{_uid()}", "full_name": f"Student {_uid()}", "department": "Computer Science",
        "level": "400", "password": "secret1",
    })
    assert r.status_code == 201, r.text
    headers, info = _auth(r.json()["access_token"]), r.json()["student"]
    if face_seed is not None:
        enrolled = _enrol(client, headers, _face(face_seed))
        assert enrolled.status_code == 200, enrolled.text
    return headers, info


def _enrol(client, headers, poses, model_version=None):
    files = [("images", (f"p{i}.jpg", make_jpeg((10 * i, 50, 90)), "image/jpeg")) for i in range(len(poses))]
    data = {"embeddings": json.dumps(poses), "model_version": model_version or settings.face_model_version}
    return client.post("/student/enrol-face", headers=headers, files=files, data=data)


def _course(client, lecturer) -> dict:
    r = client.post("/lecturer/courses", headers=lecturer, json={"code": f"S{_uid()[:4]} 1", "title": "Sync Course"})
    assert r.status_code == 201, r.text
    return r.json()


def _setup_class(client, n_students: int = 2):
    """Lecturer with a course, a device login and `n_students` enrolled+joined students."""
    email, dashboard = _new_lecturer(client)
    course = _course(client, dashboard)
    students = []
    for i in range(n_students):
        headers, info = _new_student(client, face_seed=uuid.uuid4().int % 1_000_000)
        assert client.post(f"/student/courses/{course['id']}/join", headers=headers).status_code == 201
        students.append((headers, info))
    login = _device_login(client, email)
    return email, dashboard, course, students, login


def _op(type_: str, **payload) -> dict:
    return {"op_id": str(uuid.uuid4()), "type": type_, "payload": payload}


def _push(client, device_headers, ops, device_time=None):
    r = client.post("/lecturer/sync/push", headers=device_headers,
                    json={"device_time": device_time or _now_iso(), "ops": ops})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Enrolment with on-device embeddings
# ---------------------------------------------------------------------------
def test_enrol_with_device_embeddings(client):
    headers, _ = _new_student(client, face_seed=None)
    assert _enrol(client, headers, _face(1)).status_code == 200
    me = client.get("/auth/student/me", headers=headers).json()
    assert me["face_enrolled"] is True and me["face_needs_update"] is False


def test_enrol_rejects_bad_device_embeddings(client):
    headers, _ = _new_student(client, face_seed=None)
    assert _enrol(client, headers, _face(2), model_version="old-model").status_code == 409
    assert _enrol(client, headers, [[0.1] * 128]).status_code == 422          # wrong size
    assert _enrol(client, headers, [_face(3)[0], _face(4)[0]]).status_code == 422  # two different people
    files = [("images", ("p.jpg", make_jpeg(), "image/jpeg"))]
    r = client.post("/student/enrol-face", headers=headers, files=files,
                    data={"embeddings": json.dumps(_face(5, poses=2)), "model_version": settings.face_model_version})
    assert r.status_code == 400  # one photo per pose


def test_enrol_rejects_face_already_on_another_account(client):
    first, _ = _new_student(client, face_seed=None)
    second, _ = _new_student(client, face_seed=None)
    assert _enrol(client, first, _face(77)).status_code == 200
    assert _enrol(client, second, _face(77)).status_code == 409


# ---------------------------------------------------------------------------
# Device login and refresh tokens
# ---------------------------------------------------------------------------
def test_device_login_and_refresh_rotation(client):
    email, _ = _new_lecturer(client)
    login = _device_login(client, email)
    assert login["refresh_token"]
    r = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert r.status_code == 200 and r.json()["device_active"] is True
    new_refresh = r.json()["refresh_token"]
    assert client.get("/lecturer/sync/pull", headers=_auth(r.json()["access_token"])).status_code == 200

    # Re-using a spent refresh token means it was copied: the device is signed out entirely
    r = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert r.status_code == 401 and r.headers["X-Device-State"] == "signed_out"
    assert client.post("/auth/refresh", json={"refresh_token": new_refresh}).status_code == 401


def test_dashboard_token_cannot_sync(client):
    _, dashboard = _new_lecturer(client)
    assert client.get("/lecturer/sync/pull", headers=dashboard).status_code == 403


def test_new_phone_replaces_old_one_which_may_still_push(client):
    email, dashboard, course, students, old = _setup_class(client, n_students=1)
    old_headers = _auth(old["access_token"])
    new = _device_login(client, email)

    r = client.get("/lecturer/sync/pull", headers=old_headers)
    assert r.status_code == 403 and r.headers["X-Device-State"] == "replaced"
    refreshed = client.post("/auth/refresh", json={"refresh_token": old["refresh_token"]}).json()
    assert refreshed["device_active"] is False

    # The old phone's queue still gets in during the grace period
    sid = str(uuid.uuid4())
    res = _push(client, old_headers, [
        _op("session.start", uuid=sid, course_id=course["id"], started_at=_now_iso(timedelta(minutes=-30))),
        _op("attendance.mark", session_uuid=sid, student_id=students[0][1]["id"], marked_at=_now_iso(), method="face",
            confidence=0.91),
        _op("session.end", uuid=sid, ended_at=_now_iso()),
    ])
    assert [x["status"] for x in res["results"]] == ["applied"] * 3

    devices = client.get("/lecturer/devices", headers=dashboard).json()
    assert [d["active"] for d in devices] == [True, False]
    assert client.get("/lecturer/sync/pull", headers=_auth(new["access_token"])).status_code == 200

    # After the grace period the old phone is fully signed out
    db = SessionLocal()
    try:
        old_device = db.get(Device, devices[1]["id"])
        old_device.revoked_at -= timedelta(days=settings.sync_revoked_grace_days + 1)
        db.commit()
    finally:
        db.close()
    assert client.post("/lecturer/sync/push", headers=old_headers,
                       json={"device_time": _now_iso(), "ops": []}).status_code == 401


def test_dashboard_can_revoke_device(client):
    email, dashboard = _new_lecturer(client)
    login = _device_login(client, email)
    device_id = client.get("/lecturer/devices", headers=dashboard).json()[0]["id"]
    assert client.post(f"/lecturer/devices/{device_id}/revoke", headers=dashboard).json()["active"] is False
    r = client.get("/lecturer/sync/pull", headers=_auth(login["access_token"]))
    assert r.status_code == 403 and r.headers["X-Device-State"] == "replaced"


# ---------------------------------------------------------------------------
# Pull
# ---------------------------------------------------------------------------
def test_full_pull_contains_roster_and_faces(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=2)
    legacy, _ = _new_student(client, face_seed=None)
    client.post("/student/enrol-face", headers=legacy, files=[("images", ("p.jpg", make_jpeg((1, 2, 3)), "image/jpeg"))])
    assert client.post(f"/student/courses/{course['id']}/join", headers=legacy).status_code == 201

    body = client.get("/lecturer/sync/pull", headers=_auth(login["access_token"])).json()
    assert body["full"] is True
    assert body["matching"]["model_version"] == settings.face_model_version
    assert body["offline_policy"] == {"warn_days": 7, "strong_warn_days": 14, "block_days": 30}
    assert [c["id"] for c in body["courses"]] == [course["id"]]
    assert len(body["enrollments"]) == 3

    by_id = {s["id"]: s for s in body["students"]}
    face = by_id[students[0][1]["id"]]["face"]
    vec = np.frombuffer(base64.b64decode(face["data"]), dtype="<f4").reshape(face["poses"], 512)
    assert face["poses"] == 3 and np.allclose(np.linalg.norm(vec, axis=1), 1, atol=1e-5)
    legacy_row = next(s for s in body["students"] if s["id"] not in {st[1]["id"] for st in students})
    assert legacy_row["face"] is None and legacy_row["needs_update"] is True


def test_incremental_pull_sends_only_changes_and_deletions(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=2)
    device = _auth(login["access_token"])
    _age_rows(course["id"])  # pulls overlap the previous cursor by a few seconds; keep setup rows out of it
    cursor = client.get("/lecturer/sync/pull", headers=device).json()["cursor"]

    body = client.get("/lecturer/sync/pull", headers=device, params={"since": cursor}).json()
    assert body["full"] is False and body["courses"] == [] and body["enrollments"] == []

    # A new student joins, one is removed, another re-enrols their face, the course is renamed
    newcomer, info = _new_student(client, face_seed=4242)
    client.post(f"/student/courses/{course['id']}/join", headers=newcomer)
    removed_id = students[0][1]["id"]
    assert client.delete(f"/lecturer/courses/{course['id']}/students/{removed_id}", headers=dashboard).status_code == 204
    assert _enrol(client, students[1][0], _face(999)).status_code == 200
    client.patch(f"/lecturer/courses/{course['id']}", headers=dashboard, json={"title": "Renamed"})

    body = client.get("/lecturer/sync/pull", headers=device, params={"since": cursor}).json()
    assert [c["title"] for c in body["courses"]] == ["Renamed"]
    assert {s["id"] for s in body["students"]} == {info["id"], students[1][1]["id"]}
    assert [e["student_id"] for e in body["enrollments"]] == [info["id"]]
    assert body["deleted"]["enrollments"] == [[course["id"], removed_id]]


def _age_rows(course_id: int) -> None:
    earlier = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    db = SessionLocal()
    try:
        db.query(Course).filter(Course.id == course_id).update({Course.updated_at: earlier})
        student_ids = [e.student_id for e in db.query(Enrollment).filter(Enrollment.course_id == course_id)]
        db.query(Enrollment).filter(Enrollment.course_id == course_id).update({Enrollment.updated_at: earlier})
        db.query(Student).filter(Student.id.in_(student_ids)).update({Student.updated_at: earlier})
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------
def test_offline_class_round_trip(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=2)
    device = _auth(login["access_token"])
    sid = str(uuid.uuid4())
    (_, ada), (_, ben) = students
    ops = [
        _op("session.start", uuid=sid, course_id=course["id"], started_at=_now_iso(timedelta(hours=-1)), venue="LT2"),
        _op("attendance.mark", session_uuid=sid, student_id=ada["id"], marked_at=_now_iso(timedelta(minutes=-50)),
            method="face", confidence=0.87),
        _op("attendance.mark", session_uuid=sid, student_id=ben["id"], marked_at=_now_iso(timedelta(minutes=-40)),
            method="manual", confidence=0.5),
        _op("session.end", uuid=sid, ended_at=_now_iso(timedelta(minutes=-5))),
    ]
    res = _push(client, device, ops)
    assert [r["status"] for r in res["results"]] == ["applied"] * 4

    # Re-sending the whole batch (e.g. the response was lost) changes nothing
    again = _push(client, device, ops)
    assert again["results"] == res["results"]

    sessions = client.get("/lecturer/sessions", headers=dashboard, params={"course_id": course["id"]}).json()
    assert len(sessions) == 1
    s = sessions[0]
    assert (s["present"], s["expected"], s["is_live"], s["venue"]) == (2, 2, False, "LT2")
    detail = client.get(f"/lecturer/sessions/{s['id']}", headers=dashboard).json()
    methods = {p["student_id"]: (p["method"], p["confidence"]) for p in detail["present"]}
    assert methods == {ada["id"]: ("face", 0.87), ben["id"]: ("manual", None)}


def test_push_rejections(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=1)
    other_email, other_dash = _new_lecturer(client)
    foreign_course = _course(client, other_dash)
    device = _auth(login["access_token"])
    outsider, outsider_info = _new_student(client, face_seed=31337)
    sid = str(uuid.uuid4())
    res = _push(client, device, [
        _op("session.start", uuid=str(uuid.uuid4()), course_id=foreign_course["id"], started_at=_now_iso()),
        _op("attendance.mark", session_uuid=str(uuid.uuid4()), student_id=students[0][1]["id"], marked_at=_now_iso()),
        _op("session.start", uuid=sid, course_id=course["id"], started_at=_now_iso()),
        _op("attendance.mark", session_uuid=sid, student_id=outsider_info["id"], marked_at=_now_iso()),
        _op("session.end", uuid=sid),
    ])
    statuses = [(r["status"], r["reason"]) for r in res["results"]]
    assert statuses[0] == ("rejected", "Course not found")
    assert statuses[1] == ("rejected", "Unknown class")
    assert statuses[2] == ("applied", None)
    assert statuses[3] == ("rejected", "Student is no longer registered for this course")
    assert statuses[4][0] == "rejected" and "ended_at" in statuses[4][1]


def test_marks_for_class_deleted_on_dashboard_are_rejected(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=1)
    device = _auth(login["access_token"])
    sid = str(uuid.uuid4())
    _push(client, device, [_op("session.start", uuid=sid, course_id=course["id"], started_at=_now_iso())])
    session_id = client.get("/lecturer/sessions", headers=dashboard, params={"course_id": course["id"]}).json()[0]["id"]
    assert client.delete(f"/lecturer/sessions/{session_id}", headers=dashboard).status_code == 204

    res = _push(client, device, [_op("attendance.mark", session_uuid=sid, student_id=students[0][1]["id"],
                                     marked_at=_now_iso())])
    assert res["results"][0] == {"op_id": res["results"][0]["op_id"], "status": "rejected",
                                 "reason": "This class was deleted on the dashboard"}


def test_wrong_phone_clock_is_corrected(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=1)
    device = _auth(login["access_token"])
    skew = timedelta(hours=-2)  # the phone's clock is two hours behind
    sid = str(uuid.uuid4())
    res = _push(client, device, [
        _op("session.start", uuid=sid, course_id=course["id"], started_at=_now_iso(skew - timedelta(minutes=30))),
        _op("session.end", uuid=sid, ended_at=_now_iso(skew)),
    ], device_time=_now_iso(skew))
    assert abs(res["clock_offset_seconds"] - 7200) < 5

    s = client.get("/lecturer/sessions", headers=dashboard, params={"course_id": course["id"]}).json()[0]
    started = datetime.fromisoformat(s["started_at"])
    assert abs((datetime.now(timezone.utc) - started) - timedelta(minutes=30)) < timedelta(seconds=10)
    assert s["duration_minutes"] == 30


def test_dashboard_end_then_device_end_keeps_earlier_time(client):
    email, dashboard, course, students, login = _setup_class(client, n_students=1)
    device = _auth(login["access_token"])
    sid = str(uuid.uuid4())
    _push(client, device, [_op("session.start", uuid=sid, course_id=course["id"],
                               started_at=_now_iso(timedelta(minutes=-60)))])
    session_id = client.get("/lecturer/sessions", headers=dashboard, params={"course_id": course["id"]}).json()[0]["id"]
    client.post(f"/lecturer/sessions/{session_id}/end", headers=dashboard)

    # The pull tells the phone the class was ended elsewhere
    body = client.get("/lecturer/sync/pull", headers=device).json()
    assert next(s for s in body["sessions"] if s["uuid"] == sid)["ended_at"] is not None

    res = _push(client, device, [_op("session.end", uuid=sid, ended_at=_now_iso(timedelta(minutes=-20)))])
    assert res["results"][0]["status"] == "applied"
    s = client.get(f"/lecturer/sessions/{session_id}", headers=dashboard).json()["session"]
    assert s["duration_minutes"] == 40
