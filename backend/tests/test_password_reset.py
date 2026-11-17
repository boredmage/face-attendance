"""Forgotten passwords: an emailed code lets the owner set a new password and signs out old sessions."""
import uuid
from datetime import timedelta

from app.config import settings
from app.database import SessionLocal
from app.models import Device, PasswordReset, RefreshToken, Student, utcnow

from .conftest import PASSWORD_CHANGED, RESET_CODES, emailed_reset_code, register


def _uid() -> str:
    return uuid.uuid4().hex[:6].upper()


def _student(client) -> dict:
    uid = _uid()
    body = {"matric_no": f"PWR/{uid}", "full_name": "Pat Reset", "email": f"pwr{uid.lower()}@stu.ui.edu.ng",
            "department": "Computer Science", "level": "300", "password": "oldpass1"}
    token = register(client, "student", body)["access_token"]
    return {**body, "headers": {"Authorization": f"Bearer {token}"}}


def _lecturer(client) -> dict:
    body = {"title": "Dr.", "name": "Pat Lecturer", "email": f"pwr{_uid().lower()}@ui.edu.ng",
            "department": "Computer Science", "password": "oldpass123"}
    register(client, "lecturer", body)
    return body


def _forgot(client, role: str, identifier: str) -> dict:
    r = client.post("/auth/password/forgot", json={"role": role, "identifier": identifier})
    assert r.status_code == 202, r.text
    return r.json()


def _reset(client, reset_id: str, code: str, new_password: str):
    return client.post("/auth/password/reset", json={"reset_id": reset_id, "code": code, "new_password": new_password})


def _edit(reset_id: str, **changes) -> None:
    with SessionLocal() as db:
        row = db.get(PasswordReset, reset_id)
        for field, value in changes.items():
            setattr(row, field, value)
        db.commit()


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


def test_student_resets_by_matric_number_and_old_sessions_stop_working(client):
    s = _student(client)
    assert client.get("/auth/student/me", headers=s["headers"]).status_code == 200
    pending = _forgot(client, "student", s["matric_no"].lower())  # matched however it is typed
    assert pending["resend_in_seconds"] == settings.email_resend_seconds
    assert pending["code_minutes"] == settings.email_code_minutes
    code = emailed_reset_code(s["email"])

    assert _reset(client, pending["reset_id"], code, "newpass1").status_code == 204
    assert PASSWORD_CHANGED[-1] == s["email"]
    # The token from before the reset is refused; the old password no longer signs in; the new one does
    r = client.get("/auth/student/me", headers=s["headers"])
    assert r.status_code == 401 and "password was changed" in r.json()["detail"]
    assert client.post("/auth/student/login", json={"matric_no": s["matric_no"], "password": "oldpass1"}).status_code == 401
    r = client.post("/auth/student/login", json={"matric_no": s["matric_no"], "password": "newpass1"})
    assert r.status_code == 200
    fresh = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/auth/student/me", headers=fresh).status_code == 200
    # The code is used up
    assert _reset(client, pending["reset_id"], code, "another1").status_code == 410


def test_student_can_also_reset_by_email(client):
    s = _student(client)
    pending = _forgot(client, "student", s["email"].upper())
    assert _reset(client, pending["reset_id"], emailed_reset_code(s["email"]), "newpass1").status_code == 204


def test_lecturer_reset_signs_out_the_attendance_phone(client):
    l = _lecturer(client)
    device_id = str(uuid.uuid4())
    r = client.post("/auth/lecturer/login", json={"email": l["email"], "password": l["password"], "device_id": device_id})
    assert r.status_code == 200
    refresh, phone = r.json()["refresh_token"], {"Authorization": f"Bearer {r.json()['access_token']}"}

    pending = _forgot(client, "lecturer", l["email"])
    code = emailed_reset_code(l["email"])
    r = _reset(client, pending["reset_id"], code, "short12")  # lecturers need 8 characters
    assert r.status_code == 422
    assert _reset(client, pending["reset_id"], code, "newpass123").status_code == 204

    assert client.get("/auth/lecturer/me", headers=phone).status_code == 401
    r = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 401 and r.headers["X-Device-State"] == "signed_out"
    with SessionLocal() as db:
        assert db.query(RefreshToken).filter(RefreshToken.device_id == device_id).count() == 0
        assert db.get(Device, device_id) is not None  # the phone keeps its record (and its queue)
    # Signing in again on the same phone works with the new password
    r = client.post("/auth/lecturer/login", json={"email": l["email"], "password": "newpass123", "device_id": device_id})
    assert r.status_code == 200
    assert client.get("/auth/lecturer/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200


def test_unknown_account_gets_the_same_answer_and_no_email(client):
    before = len(RESET_CODES)
    pending = _forgot(client, "student", f"NOBODY/{_uid()}")
    assert set(pending) == {"reset_id", "resend_in_seconds", "code_minutes"}
    assert pending["resend_in_seconds"] == settings.email_resend_seconds
    assert len(RESET_CODES) == before
    # No code is right for it
    with SessionLocal() as db:
        assert db.get(PasswordReset, pending["reset_id"]).account_id is None
    r = _reset(client, pending["reset_id"], "123456", "newpass1")
    assert r.status_code == 400 and r.json()["detail"] == "That code is not right. Check the email and try again."


def test_student_without_an_email_is_answered_like_no_account(client):
    s = _student(client)
    with SessionLocal() as db:
        db.query(Student).filter(Student.matric_no == s["matric_no"]).update({Student.email: None})
        db.commit()
    before = len(RESET_CODES)
    pending = _forgot(client, "student", s["matric_no"])
    assert len(RESET_CODES) == before
    with SessionLocal() as db:
        assert db.get(PasswordReset, pending["reset_id"]).account_id is None


def test_asking_again_straight_away_keeps_the_code(client):
    s = _student(client)
    first = _forgot(client, "student", s["matric_no"])
    sent = len(RESET_CODES)
    again = _forgot(client, "student", s["matric_no"])
    assert again["reset_id"] == first["reset_id"] and len(RESET_CODES) == sent


def test_wrong_codes_are_limited(client):
    s = _student(client)
    pending = _forgot(client, "student", s["matric_no"])
    code = emailed_reset_code(s["email"])
    for _ in range(settings.email_code_max_attempts):
        assert _reset(client, pending["reset_id"], _wrong(code), "newpass1").status_code == 400
    assert _reset(client, pending["reset_id"], code, "newpass1").status_code == 429
    # A new code starts the count again
    _edit(pending["reset_id"], code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds))
    r = client.post("/auth/password/resend", json={"reset_id": pending["reset_id"]})
    assert r.status_code == 200, r.text
    new_code = emailed_reset_code(s["email"])
    assert _reset(client, pending["reset_id"], new_code, "newpass1").status_code == 204


def test_resend_waits_and_old_code_stops_working(client):
    s = _student(client)
    pending = _forgot(client, "student", s["matric_no"])
    old = emailed_reset_code(s["email"])
    r = client.post("/auth/password/resend", json={"reset_id": pending["reset_id"]})
    assert r.status_code == 429 and 0 < r.json()["retry_after"] <= settings.email_resend_seconds
    _edit(pending["reset_id"], code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds))
    assert client.post("/auth/password/resend", json={"reset_id": pending["reset_id"]}).status_code == 200
    new = emailed_reset_code(s["email"])
    if new != old:
        assert _reset(client, pending["reset_id"], old, "newpass1").status_code == 400
    assert _reset(client, pending["reset_id"], new, "newpass1").status_code == 204


def test_expired_code_and_expired_reset(client):
    s = _student(client)
    pending = _forgot(client, "student", s["matric_no"])
    code = emailed_reset_code(s["email"])
    _edit(pending["reset_id"], code_expires_at=utcnow() - timedelta(seconds=1))
    r = _reset(client, pending["reset_id"], code, "newpass1")
    assert r.status_code == 400 and "expired" in r.json()["detail"]
    _edit(pending["reset_id"], expires_at=utcnow() - timedelta(seconds=1))
    assert _reset(client, pending["reset_id"], code, "newpass1").status_code == 410
    assert client.post("/auth/password/resend", json={"reset_id": pending["reset_id"]}).status_code == 410
