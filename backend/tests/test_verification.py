"""Email confirmation: a sign-up only becomes an account once its emailed code is entered."""
import io
import json
import urllib.error
import uuid
from datetime import timedelta

import pytest

from app import mailer
from app.config import settings
from app.database import SessionLocal
from app.models import Lecturer, PendingRegistration, Student, utcnow

from .conftest import SENT_CODES, emailed_code, send_verification_code


def _uid() -> str:
    return uuid.uuid4().hex[:6].upper()


def _student_body(**overrides) -> dict:
    uid = _uid()
    return {"matric_no": f"VER/{uid}", "full_name": "Vera Student", "email": f"ver{uid.lower()}@stu.ui.edu.ng",
            "department": "Computer Science", "level": "200", "password": "secret1", **overrides}


def _lecturer_body(**overrides) -> dict:
    return {"title": "Dr.", "name": "Vera Lecturer", "email": f"ver{_uid().lower()}@ui.edu.ng",
            "department": "Computer Science", "password": "secret123", **overrides}


def _start(client, role: str, body: dict) -> dict:
    r = client.post(f"/auth/{role}/register", json=body)
    assert r.status_code == 202, r.text
    return r.json()


def _verify(client, role: str, verification_id: str, code: str):
    return client.post(f"/auth/{role}/verify-email", json={"verification_id": verification_id, "code": code})


def _edit_pending(verification_id: str, **changes) -> None:
    """Move a sign-up's clocks, as if time had passed."""
    with SessionLocal() as db:
        row = db.get(PendingRegistration, verification_id)
        for field, value in changes.items():
            setattr(row, field, value)
        db.commit()


def _wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


# ---------------------------------------------------------------------------
# Sign-up
# ---------------------------------------------------------------------------
def test_register_emails_a_code_and_creates_no_account(client):
    body = _student_body()
    pending = _start(client, "student", body)
    assert pending["email"] == body["email"]
    assert pending["resend_in_seconds"] == settings.email_resend_seconds
    assert pending["code_minutes"] == settings.email_code_minutes
    code = emailed_code(body["email"])
    assert len(code) == 6 and code.isdigit()
    with SessionLocal() as db:
        assert db.query(Student).filter(Student.matric_no == body["matric_no"]).first() is None
        row = db.get(PendingRegistration, pending["verification_id"])
        assert code not in json.dumps(row.payload) and row.code_hash != code  # only a keyed hash is stored
        assert "password" not in row.payload and row.payload["password_hash"] != body["password"]


def test_student_email_is_required(client):
    body = _student_body()
    del body["email"]
    assert client.post("/auth/student/register", json=body).status_code == 422
    assert client.post("/auth/student/register", json={**body, "email": None}).status_code == 422
    assert client.post("/auth/student/register", json={**body, "email": "not-an-email"}).status_code == 422


def test_confirming_creates_the_account_and_signs_in(client):
    body = _student_body()
    pending = _start(client, "student", body)
    r = _verify(client, "student", pending["verification_id"], emailed_code(body["email"]))
    assert r.status_code == 201, r.text
    assert r.json()["student"]["matric_no"] == body["matric_no"]
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/auth/student/me", headers=headers).json()["email"] == body["email"]
    login = client.post("/auth/student/login", json={"matric_no": body["matric_no"], "password": body["password"]})
    assert login.status_code == 200
    # The code works once: the sign-up is gone
    assert _verify(client, "student", pending["verification_id"], emailed_code(body["email"])).status_code == 410
    with SessionLocal() as db:
        assert db.get(PendingRegistration, pending["verification_id"]) is None


def test_code_may_be_typed_with_spaces(client):
    body = _student_body()
    pending = _start(client, "student", body)
    code = emailed_code(body["email"])
    assert _verify(client, "student", pending["verification_id"], f" {code[:3]} {code[3:]} ").status_code == 201


# ---------------------------------------------------------------------------
# Wrong, expired and repeated codes
# ---------------------------------------------------------------------------
def test_wrong_code_is_rejected_and_tries_are_limited(client):
    body = _student_body()
    pending = _start(client, "student", body)
    vid, code = pending["verification_id"], emailed_code(body["email"])
    for _ in range(settings.email_code_max_attempts):
        r = _verify(client, "student", vid, _wrong(code))
        assert r.status_code == 400 and "not right" in r.json()["detail"]
    # Out of tries: even the right code is refused until a new one is requested
    r = _verify(client, "student", vid, code)
    assert r.status_code == 429 and "new code" in r.json()["detail"]

    _edit_pending(vid, code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds + 1))
    assert client.post("/auth/verification/resend", json={"verification_id": vid}).status_code == 200
    new_code = emailed_code(body["email"])
    if new_code != code:  # (a 1 in a million chance of drawing the same digits)
        assert _verify(client, "student", vid, code).status_code == 400
    assert _verify(client, "student", vid, new_code).status_code == 201


def test_expired_code_needs_a_new_one(client):
    body = _student_body()
    pending = _start(client, "student", body)
    vid = pending["verification_id"]
    _edit_pending(vid, code_expires_at=utcnow() - timedelta(seconds=1))
    r = _verify(client, "student", vid, emailed_code(body["email"]))
    assert r.status_code == 400 and "expired" in r.json()["detail"]


def test_resend_waits_between_codes(client):
    body = _student_body()
    pending = _start(client, "student", body)
    vid = pending["verification_id"]
    sent_before = len(SENT_CODES)
    r = client.post("/auth/verification/resend", json={"verification_id": vid})
    assert r.status_code == 429
    assert 0 < r.json()["retry_after"] <= settings.email_resend_seconds
    assert r.headers["retry-after"] == str(r.json()["retry_after"])
    assert len(SENT_CODES) == sent_before  # nothing was emailed

    _edit_pending(vid, code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds + 1))
    r = client.post("/auth/verification/resend", json={"verification_id": vid})
    assert r.status_code == 200, r.text
    assert r.json()["verification_id"] == vid and r.json()["resend_in_seconds"] == settings.email_resend_seconds
    assert len(SENT_CODES) == sent_before + 1


def test_forgotten_sign_up_expires(client):
    body = _student_body()
    pending = _start(client, "student", body)
    vid = pending["verification_id"]
    _edit_pending(vid, expires_at=utcnow() - timedelta(seconds=1))
    assert _verify(client, "student", vid, emailed_code(body["email"])).status_code == 410
    assert client.post("/auth/verification/resend", json={"verification_id": vid}).status_code == 410
    login = client.post("/auth/student/login", json={"matric_no": body["matric_no"], "password": body["password"]})
    assert login.status_code == 401
    # The next sign-up clears it away
    _start(client, "student", _student_body())
    with SessionLocal() as db:
        assert db.get(PendingRegistration, vid) is None


# ---------------------------------------------------------------------------
# Signing up again, and details taken meanwhile
# ---------------------------------------------------------------------------
def test_signing_up_again_replaces_the_earlier_sign_up(client):
    body = _student_body()
    first = _start(client, "student", body)
    sent_before = len(SENT_CODES)
    # Straight away (a corrected name): the code already emailed keeps working, no second email
    second = _start(client, "student", {**body, "full_name": "Vera Corrected"})
    assert second["verification_id"] != first["verification_id"]
    assert len(SENT_CODES) == sent_before
    assert 0 < second["resend_in_seconds"] <= settings.email_resend_seconds
    code = emailed_code(body["email"])
    assert _verify(client, "student", first["verification_id"], code).status_code == 410
    r = _verify(client, "student", second["verification_id"], code)
    assert r.status_code == 201 and r.json()["student"]["full_name"] == "Vera Corrected"


def test_signing_up_again_later_emails_a_new_code(client):
    body = _student_body()
    first = _start(client, "student", body)
    _edit_pending(first["verification_id"],
                  code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds + 1))
    sent_before = len(SENT_CODES)
    second = _start(client, "student", body)
    assert len(SENT_CODES) == sent_before + 1
    assert second["resend_in_seconds"] == settings.email_resend_seconds
    assert _verify(client, "student", second["verification_id"], emailed_code(body["email"])).status_code == 201


def test_mistyped_email_does_not_lock_the_matric_number(client):
    body = _student_body()
    typo = _start(client, "student", {**body, "email": f"typo{_uid().lower()}@stu.ui.edu.ng"})
    fixed = _start(client, "student", body)  # same matric number, the right address this time
    assert _verify(client, "student", fixed["verification_id"], emailed_code(body["email"])).status_code == 201
    # Whoever holds the mistyped address cannot take the matric number afterwards
    r = _verify(client, "student", typo["verification_id"], emailed_code(typo["email"]))
    assert r.status_code == 409 and "matric" in r.json()["detail"]


def test_existing_accounts_cannot_be_signed_up_again(client):
    seeded = _student_body(matric_no="csc/2021/001")
    assert client.post("/auth/student/register", json=seeded).status_code == 409
    assert client.post("/auth/lecturer/register", json=_lecturer_body(email="AO.Bello@ui.edu.ng")).status_code == 409
    assert client.post("/auth/lecturer/register", json=_lecturer_body(staff_id="ui/cs/0101")).status_code == 409


# ---------------------------------------------------------------------------
# Signing in before confirming
# ---------------------------------------------------------------------------
def test_login_before_confirming_resumes_the_confirmation(client):
    body = _student_body()
    pending = _start(client, "student", body)
    r = client.post("/auth/student/login", json={"matric_no": body["matric_no"].lower(), "password": body["password"]})
    assert r.status_code == 403
    assert isinstance(r.json()["detail"], str) and "Confirm your email" in r.json()["detail"]
    assert r.json()["verification"]["verification_id"] == pending["verification_id"]
    assert r.json()["verification"]["email"] == body["email"]
    assert "access_token" not in r.json()
    # Only with the password the sign-up was made with
    wrong = client.post("/auth/student/login", json={"matric_no": body["matric_no"], "password": "not-it"})
    assert wrong.status_code == 401 and "verification" not in wrong.json()


def test_login_after_the_code_ran_out_emails_a_fresh_one(client, monkeypatch):
    body = _student_body()
    pending = _start(client, "student", body)
    vid, first = pending["verification_id"], emailed_code(body["email"])
    credentials = {"matric_no": body["matric_no"], "password": body["password"]}

    # While the emailed code still works, signing in sends nothing
    sent = len(SENT_CODES)
    assert client.post("/auth/student/login", json=credentials).status_code == 403
    assert len(SENT_CODES) == sent and emailed_code(body["email"]) == first

    # The next day it has run out. If mail is down, signing in still leads to the confirmation
    yesterday = utcnow() - timedelta(hours=20)
    _edit_pending(vid, code_sent_at=yesterday, code_expires_at=yesterday + timedelta(minutes=settings.email_code_minutes))
    with monkeypatch.context() as down:
        def refuse(to, name, code):
            raise mailer.EmailError("down")

        down.setattr(mailer, "send_verification_code", refuse)
        r = client.post("/auth/student/login", json=credentials)
        assert r.status_code == 403 and r.json()["verification"]["verification_id"] == vid
        assert r.json()["verification"]["resend_in_seconds"] == 0

    # Otherwise a new code is emailed for the same sign-up, once
    r = client.post("/auth/student/login", json=credentials)
    assert r.status_code == 403 and r.json()["verification"]["verification_id"] == vid
    assert r.json()["verification"]["resend_in_seconds"] > 0
    assert len(SENT_CODES) == sent + 1
    assert client.post("/auth/student/login", json=credentials).status_code == 403
    assert len(SENT_CODES) == sent + 1
    assert _verify(client, "student", vid, emailed_code(body["email"])).status_code == 201


def test_lecturer_confirms_on_the_dashboard_not_the_phone(client):
    body = _lecturer_body(staff_id=f"ui/v/{_uid()}")
    pending = _start(client, "lecturer", body)
    credentials = {"email": body["email"], "password": body["password"]}

    dashboard = client.post("/auth/lecturer/login", json=credentials)
    assert dashboard.status_code == 403
    assert dashboard.json()["verification"]["verification_id"] == pending["verification_id"]
    phone = client.post("/auth/lecturer/login", json={**credentials, "device_id": str(uuid.uuid4())})
    assert phone.status_code == 403 and "web dashboard" in phone.json()["detail"]
    with SessionLocal() as db:
        assert db.query(Lecturer).filter(Lecturer.email == body["email"]).first() is None

    # A code only confirms the kind of account it was sent for
    code = emailed_code(body["email"])
    assert _verify(client, "student", pending["verification_id"], code).status_code == 410
    r = _verify(client, "lecturer", pending["verification_id"], code)
    assert r.status_code == 201, r.text
    assert r.json()["lecturer"]["staff_id"] == body["staff_id"].upper()
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/lecturer/courses", headers=headers).status_code == 200
    phone = client.post("/auth/lecturer/login", json={**credentials, "device_id": str(uuid.uuid4())})
    assert phone.status_code == 200 and phone.json()["refresh_token"]


def test_accounts_from_before_confirmation_still_sign_in(client):
    """Seeded accounts were written straight to the tables, as every account was before confirmation existed."""
    r = client.post("/auth/student/login", json={"matric_no": "CSC/2021/001", "password": "password123"})
    assert r.status_code == 200 and r.json()["student"]["matric_no"] == "CSC/2021/001"
    r = client.post("/auth/lecturer/login", json={"email": "ao.bello@ui.edu.ng", "password": "password123"})
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Mail delivery
# ---------------------------------------------------------------------------
def test_sign_up_fails_cleanly_when_the_email_cannot_be_sent(client, monkeypatch):
    def refuse(to, name, code):
        raise mailer.EmailError("The example.com domain is not verified.")

    monkeypatch.setattr(mailer, "send_verification_code", refuse)
    body = _student_body()
    r = client.post("/auth/student/register", json=body)
    assert r.status_code == 502
    assert "could not send" in r.json()["detail"] and "not verified" not in r.json()["detail"]
    with SessionLocal() as db:
        assert db.query(PendingRegistration).filter(PendingRegistration.email == body["email"]).first() is None


def test_resend_failure_keeps_the_earlier_code(client, monkeypatch):
    body = _student_body()
    pending = _start(client, "student", body)
    vid, code = pending["verification_id"], emailed_code(body["email"])
    _edit_pending(vid, code_sent_at=utcnow() - timedelta(seconds=settings.email_resend_seconds + 1))

    def refuse(to, name, code):
        raise mailer.EmailError("down")

    monkeypatch.setattr(mailer, "send_verification_code", refuse)
    assert client.post("/auth/verification/resend", json={"verification_id": vid}).status_code == 502
    assert _verify(client, "student", vid, code).status_code == 201


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_mailer_posts_to_resend(monkeypatch):
    calls = []

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        return _FakeResponse(b'{"id": "49a3999c"}')

    monkeypatch.setattr(mailer.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "email_from", "no-reply@mail.example.com")
    mailer.send_email("ada@example.com", "Subject", "plain", "<p>html</p>")

    (request, timeout), = calls
    assert request.full_url == "https://api.resend.com/emails" and request.get_method() == "POST"
    assert request.get_header("Authorization") == "Bearer re_test_key"
    assert request.get_header("Content-type") == "application/json"
    assert request.get_header("User-agent")  # Resend rejects requests without one
    assert timeout == settings.email_timeout_seconds
    assert json.loads(request.data) == {
        "from": "Face Attendance <no-reply@mail.example.com>", "to": ["ada@example.com"],
        "subject": "Subject", "text": "plain", "html": "<p>html</p>",
    }


def test_mailer_sender_forms(monkeypatch):
    monkeypatch.setattr(settings, "email_from", "")
    assert mailer.sender() == "Face Attendance <onboarding@resend.dev>"
    monkeypatch.setattr(settings, "email_from", "UI Attendance <hello@ui.example>")
    assert mailer.sender() == "UI Attendance <hello@ui.example>"


def test_mailer_reports_resends_reason(monkeypatch):
    def refused(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO(
            b'{"statusCode": 403, "name": "validation_error", "message": "The example.com domain is not verified."}'))

    monkeypatch.setattr(mailer.urllib.request, "urlopen", refused)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    with pytest.raises(mailer.EmailError, match="HTTP 403.*domain is not verified"):
        mailer.send_email("ada@example.com", "Subject", "plain", "<p>html</p>")

    def unreachable(request, timeout):
        raise urllib.error.URLError("timed out")

    monkeypatch.setattr(mailer.urllib.request, "urlopen", unreachable)
    with pytest.raises(mailer.EmailError, match="Could not reach Resend"):
        mailer.send_email("ada@example.com", "Subject", "plain", "<p>html</p>")


def test_without_an_api_key_the_code_goes_to_the_log(monkeypatch, caplog):
    def no_network(request, timeout):
        raise AssertionError("nothing may be sent without an API key")

    monkeypatch.setattr(mailer.urllib.request, "urlopen", no_network)
    monkeypatch.setattr(settings, "resend_api_key", "")
    with caplog.at_level("WARNING", logger="app.mailer"):
        send_verification_code("ada@example.com", "Ada Lovelace", "123456")
    assert "NOT sent" in caplog.text and "123456" in caplog.text and "ada@example.com" in caplog.text


def test_verification_email_content(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send_email", lambda *message: sent.append(message))
    send_verification_code("ada@example.com", "<b>Ada</b> Lovelace", "042137")
    (to, subject, text, html_body), = sent
    assert to == "ada@example.com"
    assert subject == "042137 is your Face Attendance confirmation code"
    assert "042137" in text and f"{settings.email_code_minutes} minutes" in text
    assert "042137" in html_body and "&lt;b&gt;Ada&lt;/b&gt;" in html_body and "<b>Ada</b>" not in html_body
