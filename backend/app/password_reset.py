"""Forgotten passwords: a 6-digit code emailed to the account's address lets its owner choose a new one.

Asking (routers/auth.py: /auth/password/forgot) answers the same way whether or not an account
matched: every request gets a `password_resets` row and a handle, and emails go out after the
response (a background task), so neither the answer nor its timing tells whether an account exists.
A row that matched nothing has `account_id` None; its code was never sent and is never accepted.

Setting the new password (/auth/password/reset) also bumps the account's `token_version`, which
signs out every token issued before, and deletes a lecturer's refresh tokens, so a phone signed in
with the old password has to sign in again. The phone keeps its unsynced queue: signing in again
on it pushes the queue as before.
"""
import hmac
import logging
import math
import secrets
from datetime import datetime, timedelta

from fastapi import BackgroundTasks, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import mailer
from .config import settings
from .models import Device, Lecturer, PasswordReset, RefreshToken, Student, utcnow
from .schemas import PasswordResetPending
from .security import hash_password
from .verification import _hash_code, _new_code

log = logging.getLogger(__name__)

EXPIRED = "This password reset has expired. Ask for a new code."
WRONG_CODE = "That code is not right. Check the email and try again."
MIN_PASSWORD = {"student": 6, "lecturer": 8}

Account = Student | Lecturer


def _find_account(db: Session, role: str, identifier: str) -> Account | None:
    """The account a request names: a student by matric number or email, a lecturer by email."""
    identifier = identifier.strip()
    if role == "lecturer":
        return db.query(Lecturer).filter(Lecturer.email == identifier.lower()).first()
    if "@" in identifier:
        return db.query(Student).filter(Student.email == identifier.lower()).first()
    return db.query(Student).filter(Student.matric_no == identifier.upper()).first()


def _load_account(db: Session, row: PasswordReset) -> Account | None:
    if row.account_id is None:
        return None
    return db.get(Student if row.role == "student" else Lecturer, row.account_id)


def _name(account: Account) -> str:
    return account.full_name if isinstance(account, Student) else account.name


def _resend_wait(row: PasswordReset, now: datetime) -> int:
    ready = row.code_sent_at + timedelta(seconds=settings.email_resend_seconds)
    return max(0, math.ceil((ready - now).total_seconds()))


def _out(row: PasswordReset, now: datetime | None = None) -> PasswordResetPending:
    return PasswordResetPending(reset_id=row.id, resend_in_seconds=_resend_wait(row, now or utcnow()),
                                code_minutes=settings.email_code_minutes)


def _send_later(background: BackgroundTasks, send, *args) -> None:
    """Email after the response has gone. A failure is logged by the mailer; the person sees
    "send a new code" either way, which is all they could do about it."""
    def run():
        try:
            send(*args)
        except mailer.EmailError:
            pass
    background.add_task(run)


def _email_code(background: BackgroundTasks, account: Account | None, code: str) -> None:
    if account is not None and account.email:
        # Looked up when the task runs, not now, so the tests' recorder is the one called
        _send_later(background, lambda *a: mailer.send_password_reset_code(*a), account.email, _name(account), code)


def request(db: Session, background: BackgroundTasks, role: str, identifier: str) -> PasswordResetPending:
    """Start a reset for whoever `identifier` names, emailing them a code. Replaces their earlier one."""
    now = utcnow()
    account = _find_account(db, role, identifier)
    # An account without an email address (created before addresses were required) cannot be
    # reached: it is answered like one that does not exist.
    account_id = account.id if account is not None and account.email else None

    db.query(PasswordReset).filter(PasswordReset.expires_at <= now).delete(synchronize_session=False)
    current = None
    if account_id is not None:
        current = (db.query(PasswordReset)
                   .filter(PasswordReset.role == role, PasswordReset.account_id == account_id).first())
    # Asking again straight away keeps the code just sent: an address gets at most one code per
    # `email_resend_seconds`, however often the form is sent
    if current is not None and current.code_expires_at > now and _resend_wait(current, now) > 0:
        db.commit()
        return _out(current, now)
    if current is not None:
        db.delete(current)
        db.flush()  # the DELETE has to reach the database before the INSERT (unique role + account)

    code = _new_code()
    row = PasswordReset(id=secrets.token_urlsafe(32), role=role, account_id=account_id, code_hash=_hash_code(code),
                        code_sent_at=now, code_expires_at=now + timedelta(minutes=settings.email_code_minutes),
                        attempts=0, expires_at=now + timedelta(minutes=settings.password_reset_minutes))
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # two requests for one account at the same moment: the other one's code stands
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A code for this account was just requested. Check your email.")
    _email_code(background, account if account_id is not None else None, code)
    return _out(row, now)


def resend(db: Session, background: BackgroundTasks, reset_id: str) -> PasswordResetPending | JSONResponse:
    """Email a fresh code for a reset (the earlier code stops working)."""
    now = utcnow()
    row = db.get(PasswordReset, reset_id)
    if row is None or row.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    wait = _resend_wait(row, now)
    if wait:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": f"You can send a new code in {wait} second{'' if wait == 1 else 's'}.",
                     "retry_after": wait},
            headers={"Retry-After": str(wait)},
        )
    code = _new_code()
    row.code_hash = _hash_code(code)
    row.code_sent_at = now
    row.code_expires_at = now + timedelta(minutes=settings.email_code_minutes)
    row.attempts = 0
    account = _load_account(db, row)
    db.commit()
    _email_code(background, account, code)
    return _out(row, now)


def reset(db: Session, background: BackgroundTasks, reset_id: str, code: str, new_password: str) -> None:
    """Check the emailed code and set the new password, signing out every earlier session."""
    now = utcnow()
    row = db.get(PasswordReset, reset_id)
    if row is None or row.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    minimum = MIN_PASSWORD[row.role]
    if len(new_password) < minimum:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Use at least {minimum} characters.")
    if row.code_expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This code has expired. Send a new code.")
    # Count the try before looking at the code, in one statement: guesses sent in parallel
    # cannot get past the limit
    counted = (db.query(PasswordReset)
               .filter(PasswordReset.id == reset_id, PasswordReset.attempts < settings.email_code_max_attempts)
               .update({PasswordReset.attempts: PasswordReset.attempts + 1}, synchronize_session=False))
    db.commit()
    if not counted:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many incorrect codes. Send a new code.")
    row = db.get(PasswordReset, reset_id)
    if row is None:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    account = _load_account(db, row)
    # A row that matched no account was never sent a code: no guess is right for it
    if account is None or not hmac.compare_digest(row.code_hash, _hash_code("".join(code.split()))):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, WRONG_CODE)

    account.password_hash = hash_password(new_password)
    account.token_version = (account.token_version or 0) + 1
    if isinstance(account, Lecturer):
        device_ids = db.query(Device.id).filter(Device.lecturer_id == account.id)
        db.query(RefreshToken).filter(RefreshToken.device_id.in_(device_ids)).delete(synchronize_session=False)
    role, account_id, email, name = row.role, account.id, account.email, _name(account)
    db.delete(row)
    db.commit()
    log.info("Password reset for %s %s", role, account_id)
    _send_later(background, lambda *a: mailer.send_password_changed(*a), email, name)
