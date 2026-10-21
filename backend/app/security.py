"""Password hashing (PBKDF2, stdlib only), JWT helpers and lecturer-device refresh tokens."""
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Device, Lecturer, RefreshToken, Student, utcnow

_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _ITERATIONS)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_access_token(user_id: int, role: str, device_id: str | None = None) -> str:
    """JWT for a student or a lecturer; `role` keeps one kind of token from opening the other's routes.

    Tokens issued to a lecturer's attendance phone also carry its device id (`dev`), which the
    sync endpoints require.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    if device_id:
        payload["dev"] = device_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


# ---------------------------------------------------------------------------
# Lecturer devices
# ---------------------------------------------------------------------------
DEVICE_STATE_HEADER = "X-Device-State"  # "replaced" | "signed_out", so the app can react without parsing text


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_refresh_token(db: Session, device: Device) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(RefreshToken(device_id=device.id, token_hash=_hash_token(raw),
                        expires_at=utcnow() + timedelta(days=settings.refresh_token_days)))
    return raw


def device_in_grace(device: Device) -> bool:
    """A replaced device may still push its queue for a few days after being revoked."""
    return device.revoked_at is not None and utcnow() < device.revoked_at + timedelta(days=settings.sync_revoked_grace_days)


def device_usable(device: Device) -> bool:
    return device.revoked_at is None or device_in_grace(device)


def _signed_out() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, "This phone was signed out. Sign in again.",
                         headers={DEVICE_STATE_HEADER: "signed_out"})


def rotate_refresh_token(db: Session, raw: str) -> tuple[Device, str]:
    """Exchange a refresh token for a new one (each token works once).

    Presenting a token that was already used means it was copied: the device is revoked outright.
    """
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == _hash_token(raw)).first()
    if row is None or row.expires_at < utcnow():
        raise _signed_out()
    device = db.get(Device, row.device_id)
    if device is None:
        raise _signed_out()
    if row.used_at is not None:
        device.revoked_at = utcnow() - timedelta(days=settings.sync_revoked_grace_days)
        db.query(RefreshToken).filter(RefreshToken.device_id == device.id).delete()
        db.commit()
        raise _signed_out()
    if not device_usable(device):
        raise _signed_out()
    row.used_at = utcnow()
    new_raw = issue_refresh_token(db, device)
    device.last_seen_at = utcnow()
    db.commit()
    return device, new_raw


_bearer = HTTPBearer(auto_error=False)


def _payload(creds: HTTPAuthorizationCredentials | None, role: str) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        int(payload["sub"])
        token_role = payload["role"]
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if token_role != role:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action is only available to {role}s")
    return payload


def _decode(creds: HTTPAuthorizationCredentials | None, role: str) -> int:
    return int(_payload(creds, role)["sub"])


def get_current_student(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Student:
    """Dependency: decode a student JWT from the Authorization header and load the student."""
    student = db.get(Student, _decode(creds, "student"))
    if student is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Student no longer exists")
    return student


def get_current_lecturer(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Lecturer:
    """Dependency: decode a lecturer JWT and load the lecturer."""
    lecturer = db.get(Lecturer, _decode(creds, "lecturer"))
    if lecturer is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Lecturer no longer exists")
    return lecturer


@dataclass
class DeviceContext:
    lecturer: Lecturer
    device: Device

    @property
    def active(self) -> bool:
        return self.device.revoked_at is None


def get_current_device(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> DeviceContext:
    """Dependency for the sync endpoints: a lecturer token issued to one of their devices."""
    payload = _payload(creds, "lecturer")
    device_id = payload.get("dev")
    if not device_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sign in from the attendance app to sync")
    lecturer = db.get(Lecturer, int(payload["sub"]))
    device = db.get(Device, device_id)
    if lecturer is None or device is None or device.lecturer_id != lecturer.id or not device_usable(device):
        raise _signed_out()
    device.last_seen_at = utcnow()
    return DeviceContext(lecturer, device)
