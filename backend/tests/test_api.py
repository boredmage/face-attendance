"""API tests: registration, roles, course joining + notifications, and the lecturer class flow.

Runs with FACE_BACKEND=mock, where each solid-colour test image acts as a different face.
"""
import csv
import io
import os
import uuid
from datetime import timedelta

import pytest

from app.database import SessionLocal
from app.models import ClassSession, Enrollment, Student, utcnow

from .conftest import make_jpeg

RED, BLUE, GREEN = (200, 30, 30), (30, 30, 200), (30, 200, 30)


def _uid() -> str:
    return uuid.uuid4().hex[:6].upper()


def _new_lecturer(client) -> dict:
    r = client.post("/auth/lecturer/register", json={
        "title": "Dr.", "name": "Test Lecturer", "email": f"lect{_uid().lower()}@ui.edu.ng",
        "department": "Computer Science", "password": "secret123",
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _new_student(client, face_color=None) -> tuple[dict, dict]:
    r = client.post("/auth/student/register", json={
        "matric_no": f"TST/{_uid()}", "full_name": "Test Student", "department": "Computer Science",
        "level": "300", "password": "secret1",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    if face_color is not None:
        files = [("images", (f"p{i}.jpg", make_jpeg(face_color), "image/jpeg")) for i in range(5)]
        assert client.post("/student/enrol-face", headers=headers, files=files).status_code == 200
    return headers, body["student"]


def _new_course(client, lecturer) -> dict:
    r = client.post("/lecturer/courses", headers=lecturer, json={"code": f"t{_uid()[:4]} 1", "title": "Test Course"})
    assert r.status_code == 201, r.text
    return r.json()


def _scan(client, lecturer, session_id, color):
    return client.post(f"/lecturer/sessions/{session_id}/scan", headers=lecturer,
                       files={"image": ("scan.jpg", make_jpeg(color), "image/jpeg")})


# ---------------------------------------------------------------------------
# Auth and roles
# ---------------------------------------------------------------------------
def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_student_register_and_duplicate(client):
    body = {"matric_no": "csc/2024/777", "full_name": "New Student", "email": "new777@stu.ui.edu.ng",
            "department": "Computer Science", "level": "100", "password": "secret1"}
    r = client.post("/auth/student/register", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["student"]["matric_no"] == "CSC/2024/777"
    assert r.json()["student"]["face_enrolled"] is False
    assert client.post("/auth/student/register", json=body).status_code == 409
    assert client.post("/auth/student/register",
                       json={**body, "matric_no": "CSC/2024/778"}).status_code == 409  # same email


def test_student_login_is_case_insensitive_and_checks_password(client):
    assert client.post("/auth/student/login", json={"matric_no": "csc/2021/001", "password": "password123"}).status_code == 200
    assert client.post("/auth/student/login", json={"matric_no": "CSC/2021/001", "password": "nope"}).status_code == 401


def test_lecturer_register_login_and_profile(client):
    email = f"reg{_uid().lower()}@ui.edu.ng"
    r = client.post("/auth/lecturer/register", json={
        "title": "Prof.", "name": "Ada Lovelace", "staff_id": "ui/cs/9", "email": email.upper(),
        "department": "Computer Science", "password": "longpassword",
    })
    assert r.status_code == 201, r.text
    assert r.json()["lecturer"]["display_name"] == "Prof. Ada Lovelace"
    assert r.json()["lecturer"]["staff_id"] == "UI/CS/9"
    dup = client.post("/auth/lecturer/register", json={
        "name": "Someone", "email": email, "department": "CS", "password": "longpassword"})
    assert dup.status_code == 409
    short = client.post("/auth/lecturer/register", json={
        "name": "Someone", "email": "x" + email, "department": "CS", "password": "short"})
    assert short.status_code == 422

    r = client.post("/auth/lecturer/login", json={"email": email, "password": "longpassword"})
    assert r.status_code == 200
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.patch("/auth/lecturer/me", headers=headers, json={"office": "Room 5", "phone": ""})
    assert r.json()["office"] == "Room 5" and r.json()["phone"] is None
    assert client.patch("/auth/lecturer/me", headers=headers, json={"name": "  "}).status_code == 422


def test_roles_are_separated(client, student_auth, lecturer_auth):
    assert client.get("/student/courses").status_code == 401
    assert client.get("/lecturer/courses").status_code == 401
    assert client.get("/lecturer/overview", headers=student_auth).status_code == 403
    assert client.get("/student/dashboard", headers=lecturer_auth).status_code == 403


# ---------------------------------------------------------------------------
# Student side
# ---------------------------------------------------------------------------
def test_seeded_student_views(client, student_auth):
    dash = client.get("/student/dashboard", headers=student_auth).json()
    assert dash["total_courses"] == 4
    assert "overall_attendance_pct" not in dash  # eligibility is per course, never averaged
    courses = client.get("/student/courses", headers=student_auth).json()
    assert dash["courses"] == courses
    for c in courses:
        assert c["classes_attended"] <= c["classes_held"]
        assert c["eligible"] == (c["classes_held"] == 0 or c["attendance_pct"] >= 75)
        if c["classes_held"]:
            assert c["attendance_pct"] == round(c["classes_attended"] * 100 / c["classes_held"], 1)
    detail = client.get(f"/student/courses/{courses[0]['id']}", headers=student_auth).json()
    assert detail["at_risk"] == (detail["classes_held"] > 0 and detail["attendance_pct"] < 75)
    assert client.get("/student/courses/99999", headers=student_auth).status_code == 404
    lecturers = client.get("/student/lecturers", headers=student_auth).json()
    assert any(l["name"] == "Dr. A. O. Bello" and l["courses"] == ["CSC401", "CSC407"] for l in lecturers)


def test_enrol_face_validation(client):
    student, _ = _new_student(client)
    assert client.post("/student/enrol-face", headers=student).status_code == 400
    files = [("images", (f"p{i}.jpg", make_jpeg(), "image/jpeg")) for i in range(9)]
    r = client.post("/student/enrol-face", headers=student, files=files)
    assert r.status_code == 400 and "at most" in r.json()["detail"].lower()


def test_reenrolment_deletes_old_photos(client):
    student, info = _new_student(client, face_color=RED)

    def photo_paths() -> list[str]:
        with SessionLocal() as db:
            s = db.get(Student, info["id"])
            return list(s.face_image_paths)

    old = photo_paths()
    assert len(old) == 5 and all(os.path.exists(p) for p in old)
    files = [("images", (f"p{i}.jpg", make_jpeg(RED), "image/jpeg")) for i in range(3)]
    assert client.post("/student/enrol-face", headers=student, files=files).status_code == 200
    new = photo_paths()
    assert len(new) == 3 and all(os.path.exists(p) for p in new)
    assert not any(os.path.exists(p) for p in old)


def test_join_requires_face_then_notifies_lecturer(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    assert course["code"].endswith("1") and " " not in course["code"] and course["code"].isupper()

    student, info = _new_student(client)
    r = client.post(f"/student/courses/{course['id']}/join", headers=student)
    assert r.status_code == 403 and "enrol your face" in r.json()["detail"].lower()

    files = [("images", ("p.jpg", make_jpeg(RED), "image/jpeg"))]
    assert client.post("/student/enrol-face", headers=student, files=files).status_code == 200
    assert client.get("/auth/student/me", headers=student).json()["face_enrolled"] is True

    catalog = client.get("/student/catalog", headers=student, params={"q": course["code"]}).json()
    assert [c["joined"] for c in catalog] == [False]
    r = client.post(f"/student/courses/{course['id']}/join", headers=student)
    assert r.status_code == 201, r.text
    assert r.json()["course"]["code"] == course["code"]
    assert client.post(f"/student/courses/{course['id']}/join", headers=student).status_code == 409
    assert client.get("/student/catalog", headers=student, params={"q": course["code"]}).json()[0]["joined"] is True

    notes = client.get("/lecturer/notifications", headers=lecturer).json()
    assert notes["unread"] == 1
    item = notes["items"][0]
    assert item["kind"] == "student_joined" and item["course_code"] == course["code"]
    assert item["student_matric"] == info["matric_no"] and info["matric_no"] in item["message"]
    assert client.post(f"/lecturer/notifications/{item['id']}/read", headers=lecturer).json()["read"] is True
    assert client.post("/lecturer/notifications/read-all", headers=lecturer).json()["unread"] == 0


def test_archived_course_hidden_from_catalog(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    student, _ = _new_student(client, face_color=GREEN)
    r = client.patch(f"/lecturer/courses/{course['id']}", headers=lecturer, json={"is_active": False})
    assert r.json()["is_active"] is False
    codes = [c["code"] for c in client.get("/student/catalog", headers=student).json()]
    assert course["code"] not in codes
    assert client.post(f"/student/courses/{course['id']}/join", headers=student).status_code == 404
    assert client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).status_code == 400


# ---------------------------------------------------------------------------
# Lecturer: class flow
# ---------------------------------------------------------------------------
def test_full_class_flow(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    ada, ada_info = _new_student(client, face_color=RED)
    ben, ben_info = _new_student(client, face_color=BLUE)
    for s in (ada, ben):
        assert client.post(f"/student/courses/{course['id']}/join", headers=s).status_code == 201

    # Start the class; a second class can't run at the same time
    r = client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer, json={"venue": "LT1"})
    assert r.status_code == 201, r.text
    session = r.json()
    assert session["is_live"] and session["venue"] == "LT1" and session["expected"] == 2
    other = _new_course(client, lecturer)
    assert client.post(f"/lecturer/courses/{other['id']}/sessions", headers=lecturer).status_code == 409
    listed = {c["id"]: c for c in client.get("/lecturer/courses", headers=lecturer).json()}
    assert listed[course["id"]]["live_session_id"] == session["id"]

    # Scan Ada, again (duplicate), then Ben
    r = _scan(client, lecturer, session["id"], RED).json()
    assert r["status"] == "marked" and r["student"]["matric_no"] == ada_info["matric_no"]
    assert (r["present"], r["expected"]) == (1, 2)
    assert _scan(client, lecturer, session["id"], RED).json()["status"] == "already_marked"
    r = _scan(client, lecturer, session["id"], BLUE).json()
    assert r["student"]["matric_no"] == ben_info["matric_no"] and r["present"] == 2

    # Students see the live class and that they're marked
    live = client.get("/student/dashboard", headers=ada).json()["live_classes"]
    assert [(l["course_code"], l["attended"]) for l in live] == [(course["code"], True)]

    # Correct a mark from the dashboard: remove Ben, then add him back manually
    r = client.delete(f"/lecturer/sessions/{session['id']}/attendance/{ben_info['id']}", headers=lecturer)
    assert r.json()["present"] == 1
    r = client.put(f"/lecturer/sessions/{session['id']}/attendance/{ben_info['id']}", headers=lecturer)
    assert r.json()["present"] == 2

    # End the class; scanning is closed afterwards
    ended = client.post(f"/lecturer/sessions/{session['id']}/end", headers=lecturer).json()
    assert ended["is_live"] is False and ended["attendance_pct"] == 100.0
    assert _scan(client, lecturer, session["id"], RED).status_code == 400

    detail = client.get(f"/lecturer/sessions/{session['id']}", headers=lecturer).json()
    assert {p["method"] for p in detail["present"]} == {"face", "manual"}
    assert detail["absent"] == []

    course_detail = client.get(f"/lecturer/courses/{course['id']}", headers=lecturer).json()
    assert course_detail["course"]["sessions"] == 1
    assert course_detail["course"]["avg_attendance_pct"] == 100.0
    # Enrolled through the legacy photo-only path: not recognisable by the on-device model
    assert course_detail["course"]["faces_enrolled"] == 0
    assert all(s["classes_held"] == 1 and s["attendance_pct"] == 100.0 for s in course_detail["students"])
    assert len(course_detail["trend"]) == 1

    student_view = client.get(f"/student/courses/{course['id']}", headers=ada).json()
    assert (student_view["classes_held"], student_view["classes_attended"]) == (1, 1)

    overview = client.get("/lecturer/overview", headers=lecturer).json()
    assert overview["total_sessions"] == 1 and overview["total_students"] == 2
    assert overview["live_sessions"] == []

    # CSV exports
    rows = list(csv.reader(io.StringIO(client.get(f"/lecturer/sessions/{session['id']}/export.csv", headers=lecturer).text)))
    assert rows[0][0] == "Matric No" and len(rows) == 3
    register = client.get(f"/lecturer/courses/{course['id']}/export.csv", headers=lecturer)
    assert register.headers["content-type"].startswith("text/csv")
    reg_rows = list(csv.reader(io.StringIO(register.text)))
    assert [r[2] for r in reg_rows[1:]] == ["P", "P"]


def test_scan_needs_students_with_enrolled_faces(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    session = client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).json()
    r = _scan(client, lecturer, session["id"], RED)
    assert r.status_code == 400 and "enrolled their face" in r.json()["detail"]
    client.post(f"/lecturer/sessions/{session['id']}/end", headers=lecturer)


def test_absent_student_and_late_joiner(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    present, _ = _new_student(client, face_color=RED)
    absent, _ = _new_student(client, face_color=BLUE)
    for s in (present, absent):
        client.post(f"/student/courses/{course['id']}/join", headers=s)
    session = client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).json()
    _scan(client, lecturer, session["id"], RED)
    client.post(f"/lecturer/sessions/{session['id']}/end", headers=lecturer)

    # Joined after the class: they still missed it
    late, _ = _new_student(client, face_color=GREEN)
    client.post(f"/student/courses/{course['id']}/join", headers=late)

    detail = client.get(f"/lecturer/courses/{course['id']}", headers=lecturer).json()
    by_held = sorted((s["classes_held"], s["classes_attended"], s["at_risk"]) for s in detail["students"])
    assert by_held == [(1, 0, True), (1, 0, True), (1, 1, False)]
    assert detail["course"]["avg_attendance_pct"] == 33.3
    assert detail["course"]["at_risk"] == 2
    session_detail = client.get(f"/lecturer/sessions/{session['id']}", headers=lecturer).json()
    assert len(session_detail["present"]) == 1 and len(session_detail["absent"]) == 2
    late_sessions = client.get(f"/student/courses/{course['id']}", headers=late).json()["sessions"]
    assert [s["attended"] for s in late_sessions] == [False]


def test_stale_live_session_is_closed_automatically(client):
    lecturer = _new_lecturer(client)
    course = _new_course(client, lecturer)
    session = client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).json()
    db = SessionLocal()
    try:
        row = db.get(ClassSession, session["id"])
        row.started_at = utcnow() - timedelta(hours=10)
        db.commit()
    finally:
        db.close()
    sessions = client.get("/lecturer/sessions", headers=lecturer, params={"course_id": course["id"]}).json()
    assert sessions[0]["is_live"] is False and sessions[0]["duration_minutes"] == 4 * 60
    # ...which frees the lecturer to start the next class
    assert client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).status_code == 201


def test_courses_are_private_to_their_lecturer(client, lecturer_auth):
    other = _new_lecturer(client)
    course = _new_course(client, other)
    assert client.get(f"/lecturer/courses/{course['id']}", headers=lecturer_auth).status_code == 404
    assert client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer_auth).status_code == 404
    duplicate = client.post("/lecturer/courses", headers=lecturer_auth, json={"code": course["code"], "title": "Copy"})
    assert duplicate.status_code == 409


def test_delete_course_and_session_rules(client):
    lecturer = _new_lecturer(client)
    empty = _new_course(client, lecturer)
    assert client.delete(f"/lecturer/courses/{empty['id']}", headers=lecturer).status_code == 204

    course = _new_course(client, lecturer)
    student, info = _new_student(client, face_color=RED)
    client.post(f"/student/courses/{course['id']}/join", headers=student)
    session = client.post(f"/lecturer/courses/{course['id']}/sessions", headers=lecturer).json()
    client.post(f"/lecturer/sessions/{session['id']}/end", headers=lecturer)
    r = client.delete(f"/lecturer/courses/{course['id']}", headers=lecturer)
    assert r.status_code == 409 and "archive" in r.json()["detail"].lower()

    assert client.delete(f"/lecturer/sessions/{session['id']}", headers=lecturer).status_code == 204
    assert client.get(f"/lecturer/sessions/{session['id']}", headers=lecturer).status_code == 404

    assert client.delete(f"/lecturer/courses/{course['id']}/students/{info['id']}", headers=lecturer).status_code == 204
    db = SessionLocal()
    try:
        assert db.query(Enrollment).filter_by(course_id=course["id"]).count() == 0
    finally:
        db.close()


@pytest.mark.parametrize("path", ["/lecturer/overview", "/lecturer/courses", "/lecturer/sessions"])
def test_seeded_lecturer_views(client, lecturer_auth, path):
    assert client.get(path, headers=lecturer_auth).status_code == 200


def test_seeded_overview_numbers(client, lecturer_auth):
    o = client.get("/lecturer/overview", headers=lecturer_auth).json()
    assert o["lecturer"]["email"] == "ao.bello@ui.edu.ng"
    assert o["total_courses"] == 2 and o["total_students"] == 8
    assert 0 < o["avg_attendance_pct"] < 100
    assert o["trend"] and all(0 <= p["attendance_pct"] <= 100 for p in o["trend"])
    assert all(a["attendance_pct"] < 75 for a in o["at_risk"])
