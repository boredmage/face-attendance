"""Password hashing (PBKDF2, stdlib only) and JWT helpers."""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Lecturer, Student

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


def create_access_token(user_id: int, role: str) -> str:
    """JWT for a student or a lecturer; `role` keeps one kind of token from opening the other's routes."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


_bearer = HTTPBearer(auto_error=False)


def _decode(creds: HTTPAuthorizationCredentials | None, role: str) -> int:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = int(payload["sub"])
        token_role = payload["role"]
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    if token_role != role:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action is only available to {role}s")
    return user_id


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
