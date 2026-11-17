"""Email confirmation for new accounts.

Registering does not create the account: the cleaned fields wait in `pending_registrations` and a
6-digit code is emailed. Entering the code (routers/auth.py: /auth/*/verify-email) creates the
account and signs it in. Until then nothing can sign in, so an unconfirmed sign-up can be replaced
or dropped freely, and a mistyped address never locks up a matric number or staff ID.
"""
import hashlib
import hmac
import math
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import mailer
from .config import settings
from .models import PendingRegistration, utcnow
from .schemas import PendingVerification
from .security import verify_password

EXPIRED = "This sign-up has expired. Please register again."
MAIL_FAILED = "We could not send the confirmation email. Check the address and try again in a moment."


def _hash_code(code: str) -> str:
    # Keyed with the server secret: a copy of the database alone does not give the codes away
    return hmac.new(settings.jwt_secret.encode(), code.encode(), hashlib.sha256).hexdigest()


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _resend_wait(row: PendingRegistration, now: datetime) -> int:
    """Seconds until another code may be sent to this sign-up's address."""
    ready = row.code_sent_at + timedelta(seconds=settings.email_resend_seconds)
    return max(0, math.ceil((ready - now).total_seconds()))


def _out(row: PendingRegistration, now: datetime | None = None) -> PendingVerification:
    return PendingVerification(
        verification_id=row.id,
        email=row.email,
        resend_in_seconds=_resend_wait(row, now or utcnow()),
        code_minutes=settings.email_code_minutes,
    )


def _for_address(db: Session, role: str, email: str) -> PendingRegistration | None:
    return db.query(PendingRegistration).filter(PendingRegistration.role == role,
                                                PendingRegistration.email == email).first()


def _send(db: Session, email: str, name: str, code: str) -> None:
    """Email a code; nothing has been written when this raises."""
    # Nothing to save yet: this only ends the read transaction, so the database (SQLite: one
    # writer at a time) is not held while the request to the mail service runs.
    db.commit()
    try:
        mailer.send_verification_code(email, name, code)
    except mailer.EmailError:  # already logged with the mail service's reason
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, MAIL_FAILED) from None


def start(db: Session, *, role: str, email: str, login_key: str, name: str, payload: dict) -> PendingVerification:
    """Hold a sign-up until its address is confirmed and email the code for it.

    `payload` holds the columns of the account to create. A sign-up for the same address replaces
    the earlier one, whoever made it: only the latest handle works.
    """
    now = utcnow()
    current = _for_address(db, role, email)
    # Signing up again straight away (to correct another field) keeps the code that was just
    # emailed, so one address is never sent more than one code per `email_resend_seconds`.
    if (current is not None and current.expires_at > now and current.code_expires_at > now
            and _resend_wait(current, now) > 0):
        code_hash, sent_at, attempts = current.code_hash, current.code_sent_at, current.attempts
        code_expires_at = current.code_expires_at
    else:
        code = _new_code()
        _send(db, email, name, code)
        code_hash, sent_at, attempts = _hash_code(code), utcnow(), 0
        code_expires_at = sent_at + timedelta(minutes=settings.email_code_minutes)

    # Housekeeping: forget sign-ups nobody confirmed
    db.query(PendingRegistration).filter(PendingRegistration.expires_at <= now).delete(synchronize_session=False)
    current = _for_address(db, role, email)
    if current is not None:
        db.delete(current)
        db.flush()  # the DELETE has to reach the database before the INSERT (unique role + email)
    row = PendingRegistration(
        id=secrets.token_urlsafe(32), role=role, email=email, login_key=login_key, payload=payload,
        code_hash=code_hash, code_sent_at=sent_at, code_expires_at=code_expires_at, attempts=attempts,
        expires_at=utcnow() + timedelta(hours=settings.pending_registration_hours),
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # two sign-ups for one address at the same moment
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Another sign-up for this email is in progress. Try again.")
    return _out(row)


def _reissue(db: Session, verification_id: str) -> PendingRegistration:
    """Email a fresh code for a sign-up and save it (the earlier code stops working)."""
    row = db.get(PendingRegistration, verification_id)
    if row is None:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    code = _new_code()
    _send(db, row.email, row.payload.get("full_name") or row.payload.get("name") or "", code)
    row = db.get(PendingRegistration, verification_id)
    if row is None:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    row.code_hash = _hash_code(code)
    row.code_sent_at = utcnow()
    row.code_expires_at = row.code_sent_at + timedelta(minutes=settings.email_code_minutes)
    row.attempts = 0
    db.commit()
    return row


def resume(db: Session, role: str, login_key: str, password: str) -> PendingVerification | None:
    """The unconfirmed sign-up these sign-in details belong to, if there is one.

    When its code has run out (they come back the next day), a fresh one is emailed first: the
    password has just shown who is asking, and the screen they land on says a code was sent.
    """
    now = utcnow()
    rows = (db.query(PendingRegistration)
            .filter(PendingRegistration.role == role, PendingRegistration.login_key == login_key,
                    PendingRegistration.expires_at > now)
            .order_by(PendingRegistration.created_at.desc()).limit(3).all())
    for row in rows:
        if not verify_password(password, row.payload["password_hash"]):
            continue
        verification_id = row.id
        if row.code_expires_at <= now and _resend_wait(row, now) == 0:
            try:
                row = _reissue(db, verification_id)
            except HTTPException:
                # Mail is down, or the sign-up has just gone: "send a new code" on that screen covers it
                row = db.get(PendingRegistration, verification_id)
                if row is None:
                    return None
        return _out(row)
    return None


def unconfirmed_response(pending: PendingVerification, detail: str) -> JSONResponse:
    """403 for a sign-in to an unconfirmed sign-up: `detail` for people, `verification` for the app."""
    return JSONResponse(status_code=status.HTTP_403_FORBIDDEN,
                        content={"detail": detail, "verification": pending.model_dump()})


def confirm(db: Session, role: str, verification_id: str, code: str) -> PendingRegistration:
    """Check an emailed code. Returns the sign-up it confirms; the caller creates the account."""
    now = utcnow()
    row = db.get(PendingRegistration, verification_id)
    if row is None or row.role != role or row.expires_at <= now:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    if row.code_expires_at <= now:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This code has expired. Send a new code.")
    # Count the try before looking at the code, in one statement: guesses sent in parallel
    # cannot get past the limit.
    counted = (db.query(PendingRegistration)
               .filter(PendingRegistration.id == verification_id,
                       PendingRegistration.attempts < settings.email_code_max_attempts)
               .update({PendingRegistration.attempts: PendingRegistration.attempts + 1}, synchronize_session=False))
    db.commit()
    if not counted:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many incorrect codes. Send a new code.")
    row = db.get(PendingRegistration, verification_id)
    if row is None:
        raise HTTPException(status.HTTP_410_GONE, EXPIRED)
    if not hmac.compare_digest(row.code_hash, _hash_code("".join(code.split()))):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is not right. Check the email and try again.")
    return row


def resend(db: Session, verification_id: str) -> PendingVerification | JSONResponse:
    """Email a fresh code for a sign-up (the earlier code stops working)."""
    now = utcnow()
    row = db.get(PendingRegistration, verification_id)
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
    return _out(_reissue(db, verification_id))
