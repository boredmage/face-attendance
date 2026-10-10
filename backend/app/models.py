"""Database models for the attendance system.

All timestamps are stored as naive UTC (see `utcnow`) and serialised with a `Z` suffix by the
schemas, so the dashboard and the phone can show them in their own local time.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    matric_no: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    department: Mapped[str] = mapped_column(String(120))
    level: Mapped[str] = mapped_column(String(10), default="100")
    password_hash: Mapped[str] = mapped_column(String(256))
    # Face embedding vectors (one list of floats per enrolment pose) produced by DeepFace
    face_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    face_image_path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    face_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    enrollments: Mapped[list[Enrollment]] = relationship(back_populates="student", cascade="all, delete-orphan")
    attendance: Mapped[list[Attendance]] = relationship(back_populates="student", cascade="all, delete-orphan")


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

    student: Mapped[Student] = relationship(back_populates="enrollments")
    course: Mapped[Course] = relationship(back_populates="enrollments")


class ClassSession(Base):
    """One class meeting, started and ended by the lecturer from their phone."""
    __tablename__ = "class_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # None while live
    venue: Mapped[str | None] = mapped_column(String(120), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(200), nullable=True)

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
