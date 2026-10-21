"""Database models for the attendance system.

All timestamps are stored as naive UTC (see `utcnow`) and serialised with a `Z` suffix by the
schemas, so the dashboard and the phone can show them in their own local time.
"""
from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid() -> str:
    return str(uuid_lib.uuid4())


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    matric_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    department: Mapped[str] = mapped_column(String(120))
    level: Mapped[str] = mapped_column(String(10), default="100")
    password_hash: Mapped[str] = mapped_column(String(256))
    # Face embedding vectors (one list of floats per enrolment pose). Since the offline-first
    # redesign they are computed on the student's phone; `embedding_model` says which model made
    # them (None = legacy server-side DeepFace), so vectors from different models are never compared.
    face_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(40), nullable=True)
    face_image_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Every enrolment photo (frontal first), kept so faces can be re-embedded if the model changes
    face_image_paths: Mapped[list | None] = mapped_column(JSON, nullable=True)
    face_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Bumped whenever anything the lecturer's device caches changes (name, face): drives sync pulls
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    enrollments: Mapped[list[Enrollment]] = relationship(back_populates="student", cascade="all, delete-orphan")
    attendance: Mapped[list[Attendance]] = relationship(back_populates="student", cascade="all, delete-orphan")

    @property
    def face_ready(self) -> bool:
        """Enrolled with the model the lecturer's phone uses, so it can be recognised in class."""
        from .config import settings
        return bool(self.face_embedding) and self.embedding_model == settings.face_model_version


class Lecturer(Base):
    __tablename__ = "lecturers"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str | None] = mapped_column(String(20), nullable=True)  # Dr., Prof., Mr., ...
    name: Mapped[str] = mapped_column(String(120))
    staff_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    department: Mapped[str] = mapped_column(String(120))
    faculty: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    office: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    courses: Mapped[list[Course]] = relationship(back_populates="lecturer")
    notifications: Mapped[list[Notification]] = relationship(back_populates="lecturer", cascade="all, delete-orphan")

    @property
    def display_name(self) -> str:
        return f"{self.title} {self.name}" if self.title else self.name


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    semester: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "First" | "Second"
    # Archived courses disappear from the student catalogue but keep their history
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("lecturers.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    lecturer: Mapped[Lecturer] = relationship(back_populates="courses")
    enrollments: Mapped[list[Enrollment]] = relationship(back_populates="course", cascade="all, delete-orphan")
    sessions: Mapped[list[ClassSession]] = relationship(back_populates="course", cascade="all, delete-orphan")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("student_id", "course_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    # Classes held before this moment don't count against the student
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    student: Mapped[Student] = relationship(back_populates="enrollments")
    course: Mapped[Course] = relationship(back_populates="enrollments")


class ClassSession(Base):
    """One class meeting, started and ended by the lecturer from their phone.

    Sessions are normally created offline on the lecturer's device and arrive through
    /lecturer/sync/push; `uuid` is the device-generated id that makes those pushes idempotent.
    """
    __tablename__ = "class_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=new_uuid)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # None while live
    venue: Mapped[str | None] = mapped_column(String(120), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Set when the session came from a device sync (None = created through the online API)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Largest correction applied to the device's timestamps (server minus device clock), if any
    clock_offset_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    course: Mapped[Course] = relationship(back_populates="sessions")
    attendance: Mapped[list[Attendance]] = relationship(back_populates="session", cascade="all, delete-orphan")

    @property
    def is_live(self) -> bool:
        return self.ended_at is None


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("student_id", "session_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    session_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    marked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    method: Mapped[str] = mapped_column(String(16), default="face")  # face | manual | seed
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)

    student: Mapped[Student] = relationship(back_populates="attendance")
    session: Mapped[ClassSession] = relationship(back_populates="attendance")


class Notification(Base):
    """Dashboard notification for a lecturer (e.g. a student joined one of their courses)."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("lecturers.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # student_joined
    message: Mapped[str] = mapped_column(String(300))
    course_id: Mapped[int | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    lecturer: Mapped[Lecturer] = relationship(back_populates="notifications")


class Device(Base):
    """A lecturer's attendance phone. Each login on a phone creates a new device id.

    A lecturer has one active device: logging in on another phone revokes the previous one, which
    may then only push what it still has queued for `sync_revoked_grace_days`.
    """
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RefreshToken(Base):
    """Long-lived, rotating token that lets an offline device get new access tokens."""
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    # Set when the token is exchanged for a new one; presenting a used token again revokes the device
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SyncOp(Base):
    """Every operation a device has pushed, so re-sending a batch never applies anything twice."""
    __tablename__ = "sync_ops"

    op_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # applied | rejected
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Tombstone(Base):
    """Record of a deletion, so devices learn about it on their next pull.

    kind / key:  enrollment "<course_id>:<student_id>",  session "<uuid>",  course "<id>",
                 attendance "<session_uuid>:<student_id>"
    """
    __tablename__ = "tombstones"

    id: Mapped[int] = mapped_column(primary_key=True)
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("lecturers.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    key: Mapped[str] = mapped_column(String(80))
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
