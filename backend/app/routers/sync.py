"""Offline-first sync for the lecturer's attendance phone (see docs/offline-first-plan.md).

The phone keeps its own copy of the lecturer's courses, rosters and face embeddings, takes
attendance entirely locally and queues every change as an operation:

  GET  /lecturer/sync/pull?since=<cursor>   what changed on the server (rosters, faces, deletions)
  POST /lecturer/sync/push                  queued operations; each op_id is applied at most once

Plus the dashboard's view of the lecturer's devices.
"""
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import (Attendance, ClassSession, Course, Device, Enrollment, Lecturer, Student, SyncOp, Tombstone,
                      utcnow)
from ..schemas import (DeviceOut, SyncCourse, SyncDeleted, SyncEnrollment, SyncFace, SyncMark, SyncMatching,
                       SyncOfflinePolicy, SyncOpIn, SyncOpResult, SyncPullResult, SyncPushRequest, SyncPushResult,
                       SyncSession, SyncStudent)
from ..security import DEVICE_STATE_HEADER, DeviceContext, get_current_device, get_current_lecturer

router = APIRouter(prefix="/lecturer", tags=["sync"])

# Rows written just before a pull can commit just after it; re-sending a few seconds of changes
# is harmless (the phone upserts), missing them is not.
CURSOR_OVERLAP = timedelta(seconds=5)
# Sessions (and their marks) the phone gets back from the server: live ones plus recent ones,
# enough to resume a class and to notice when the dashboard ended or edited it.
RECENT_SESSIONS = timedelta(days=1)


def record_tombstone(db: Session, lecturer_id: int, kind: str, key: str) -> None:
    """Remember a deletion so the lecturer's phone removes its copy on the next pull."""
    db.add(Tombstone(lecturer_id=lecturer_id, kind=kind, key=key))


def _naive_utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _parse_time(value) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp missing")
    return _naive_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


# ---------------------------------------------------------------------------
# Pull
# ---------------------------------------------------------------------------
def encode_face(student: Student) -> SyncFace | None:
    if not student.face_embedding or student.embedding_model != settings.face_model_version:
        return None
    poses = [np.asarray(v, dtype=np.float32) for v in student.face_embedding if v]
    poses = [v / (np.linalg.norm(v) + 1e-9) for v in poses]
    data = np.concatenate(poses).astype("<f4").tobytes()
    return SyncFace(model=student.embedding_model, poses=len(poses), data=base64.b64encode(data).decode())


def _sync_student(s: Student) -> SyncStudent:
    face = encode_face(s)
    return SyncStudent(id=s.id, matric_no=s.matric_no, full_name=s.full_name, face=face,
                       needs_update=face is None and bool(s.face_embedding))


def _sync_session(s: ClassSession) -> SyncSession:
    return SyncSession(uuid=s.uuid, course_id=s.course_id, started_at=s.started_at, ended_at=s.ended_at,
                       venue=s.venue, topic=s.topic)


@router.get("/sync/pull", response_model=SyncPullResult)
def pull(
    response: Response,
    since: str | None = Query(None, description="cursor from the previous pull; omit for a full snapshot"),
    ctx: DeviceContext = Depends(get_current_device),
    db: Session = Depends(get_db),
):
    if not ctx.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is now used on another phone",
                            headers={DEVICE_STATE_HEADER: "replaced"})
    now = utcnow()
    try:
        after = _parse_time(since) - CURSOR_OVERLAP if since else None
    except ValueError:
        after = None  # unreadable cursor: send everything
    full = after is None

    courses = db.query(Course).filter(Course.lecturer_id == ctx.lecturer.id).all()
    course_ids = [c.id for c in courses]
    enrollments = db.query(Enrollment).filter(Enrollment.course_id.in_(course_ids)).all() if course_ids else []
    student_ids = {e.student_id for e in enrollments}

    if full:
        changed_courses = courses
        changed_enrollments = enrollments
        changed_student_ids = student_ids
    else:
        changed_courses = [c for c in courses if c.updated_at > after]
        changed_enrollments = [e for e in enrollments if e.updated_at > after]
        changed_student_ids = {e.student_id for e in changed_enrollments}
        if student_ids:
            changed_student_ids |= {
                sid for (sid,) in db.query(Student.id)
                .filter(Student.id.in_(student_ids), Student.updated_at > after).all()
            }
    students = db.query(Student).filter(Student.id.in_(changed_student_ids)).all() if changed_student_ids else []

    sessions: list[ClassSession] = []
    if course_ids:
        q = db.query(ClassSession).filter(ClassSession.course_id.in_(course_ids))
        recent = (ClassSession.started_at >= now - RECENT_SESSIONS) | ClassSession.ended_at.is_(None)
        q = q.filter(recent)
        if not full:
            q = q.filter(ClassSession.updated_at > after)
        sessions = q.all()
    marks: list[SyncMark] = []
    if course_ids:
        mq = (db.query(Attendance, ClassSession.uuid).join(ClassSession)
              .filter(ClassSession.course_id.in_(course_ids),
                      (ClassSession.started_at >= now - RECENT_SESSIONS) | ClassSession.ended_at.is_(None)))
        if not full:
            mq = mq.filter(Attendance.updated_at > after)
        marks = [SyncMark(session_uuid=u, student_id=a.student_id, marked_at=a.marked_at, method=a.method)
                 for a, u in mq.all()]

    deleted = SyncDeleted()
    if not full:
        for t in db.query(Tombstone).filter(Tombstone.lecturer_id == ctx.lecturer.id, Tombstone.deleted_at > after):
            if t.kind == "course":
                deleted.courses.append(int(t.key))
            elif t.kind == "enrollment":
                c, s = t.key.split(":")
                deleted.enrollments.append((int(c), int(s)))
            elif t.kind == "session":
                deleted.sessions.append(t.key)
            elif t.kind == "attendance":
                u, s = t.key.rsplit(":", 1)
                deleted.marks.append((u, int(s)))

    ctx.device.last_sync_at = now
    db.commit()
    return SyncPullResult(
        server_time=now,
        cursor=now.replace(tzinfo=timezone.utc).isoformat(),
        full=full,
        matching=SyncMatching(model_version=settings.face_model_version, threshold=settings.face_distance_threshold,
                              margin=settings.face_identify_margin),
        offline_policy=SyncOfflinePolicy(warn_days=settings.sync_warn_days,
                                         strong_warn_days=settings.sync_strong_warn_days,
                                         block_days=settings.sync_block_days),
        courses=[SyncCourse(id=c.id, code=c.code, title=c.title, is_active=c.is_active) for c in changed_courses],
        students=[_sync_student(s) for s in students],
        enrollments=[SyncEnrollment(course_id=e.course_id, student_id=e.student_id, joined_at=e.joined_at)
                     for e in changed_enrollments],
        sessions=[_sync_session(s) for s in sessions],
        marks=marks,
        deleted=deleted,
    )


# ---------------------------------------------------------------------------
# Push
# ---------------------------------------------------------------------------
class Rejected(Exception):
    """An operation that can never be applied (it is recorded, and the phone shows it)."""


class _Batch:
    def __init__(self, db: Session, ctx: DeviceContext, shift: timedelta, now: datetime):
        self.db, self.ctx, self.shift, self.now = db, ctx, shift, now
        self.offset_seconds = shift.total_seconds() if shift else None

    def time(self, payload: dict, key: str) -> datetime:
        """A device timestamp, corrected for the device's clock and never in the future."""
        try:
            value = _parse_time(payload.get(key)) + self.shift
        except ValueError:
            raise Rejected(f"'{key}' is missing or not a timestamp")
        return min(value, self.now)

    def session(self, payload: dict, key: str = "uuid") -> ClassSession:
        uuid = payload.get(key)
        if not isinstance(uuid, str):
            raise Rejected(f"'{key}' is missing")
        s = self.db.query(ClassSession).filter(ClassSession.uuid == uuid).first()
        if s is None or s.course.lecturer_id != self.ctx.lecturer.id:
            gone = self.db.query(Tombstone).filter_by(lecturer_id=self.ctx.lecturer.id, kind="session", key=uuid).first()
            raise Rejected("This class was deleted on the dashboard" if gone else "Unknown class")
        return s

    def touch(self, s: ClassSession) -> None:
        s.synced_at = self.now
        if self.offset_seconds is not None:
            s.clock_offset_seconds = self.offset_seconds

    # -- operations --
    def session_start(self, p: dict) -> str | None:
        uuid = p.get("uuid")
        if not isinstance(uuid, str) or not 8 <= len(uuid) <= 36:
            raise Rejected("'uuid' is missing")
        course = self.db.get(Course, p.get("course_id")) if isinstance(p.get("course_id"), int) else None
        if course is None or course.lecturer_id != self.ctx.lecturer.id:
            raise Rejected("Course not found")
        existing = self.db.query(ClassSession).filter(ClassSession.uuid == uuid).first()
        if existing is not None:
            if existing.course_id != course.id:
                raise Rejected("A different class already uses this id")
            return "already recorded"
        s = ClassSession(uuid=uuid, course_id=course.id, started_at=self.time(p, "started_at"),
                         venue=(str(p.get("venue") or "").strip()[:120] or None),
                         topic=(str(p.get("topic") or "").strip()[:200] or None),
                         device_id=self.ctx.device.id)
        self.touch(s)
        self.db.add(s)
        self.db.flush()
        return None

    def session_end(self, p: dict) -> str | None:
        s = self.session(p)
        ended = max(self.time(p, "ended_at"), s.started_at)
        note = None
        if s.ended_at is None:
            s.ended_at = ended
        elif ended < s.ended_at:
            # Ended on the dashboard (or auto-ended) after the class really finished on the phone
            s.ended_at = ended
        else:
            note = "already ended"
        self.touch(s)
        return note

    def attendance_mark(self, p: dict) -> str | None:
        s = self.session(p, "session_uuid")
        student_id = p.get("student_id")
        if not isinstance(student_id, int):
            raise Rejected("'student_id' is missing")
        if self.db.query(Enrollment).filter_by(course_id=s.course_id, student_id=student_id).first() is None:
            raise Rejected("Student is no longer registered for this course")
        method = p.get("method") if p.get("method") in ("face", "manual") else "face"
        confidence = p.get("confidence")
        confidence = round(float(confidence), 4) if isinstance(confidence, (int, float)) and method == "face" else None
        self.touch(s)
        if self.db.query(Attendance).filter_by(session_id=s.id, student_id=student_id).first() is not None:
            return "already marked"
        self.db.add(Attendance(student_id=student_id, session_id=s.id, marked_at=max(self.time(p, "marked_at"), s.started_at),
                               method=method, confidence=confidence))
        self.db.flush()
        return None

    def attendance_unmark(self, p: dict) -> str | None:
        s = self.session(p, "session_uuid")
        student_id = p.get("student_id")
        if not isinstance(student_id, int):
            raise Rejected("'student_id' is missing")
        self.touch(s)
        if not self.db.query(Attendance).filter_by(session_id=s.id, student_id=student_id).delete():
            return "was not marked"
        return None

    def apply(self, op: SyncOpIn) -> SyncOpResult:
        handler = {
            "session.start": self.session_start,
            "session.end": self.session_end,
            "attendance.mark": self.attendance_mark,
            "attendance.unmark": self.attendance_unmark,
        }[op.type]
        savepoint = self.db.begin_nested()
        try:
            note = handler(op.payload)
            savepoint.commit()
            result = SyncOpResult(op_id=op.op_id, status="applied", reason=note)
        except Rejected as exc:
            savepoint.rollback()
            result = SyncOpResult(op_id=op.op_id, status="rejected", reason=str(exc))
        self.db.add(SyncOp(op_id=op.op_id, device_id=self.ctx.device.id, type=op.type, status=result.status,
                           reason=result.reason))
        self.db.flush()
        return result


@router.post("/sync/push", response_model=SyncPushResult)
def push(body: SyncPushRequest, ctx: DeviceContext = Depends(get_current_device), db: Session = Depends(get_db)):
    """Apply queued operations in order. Re-sending an op_id returns its first result unchanged.

    Allowed for a replaced device during its grace period, so nothing recorded offline is lost.
    """
    now = utcnow()
    offset = now - _naive_utc(body.device_time)
    shift = offset if abs(offset.total_seconds()) > settings.sync_clock_tolerance_seconds else timedelta(0)
    batch = _Batch(db, ctx, shift, now)

    seen = {r.op_id: r for r in db.query(SyncOp).filter(SyncOp.op_id.in_([o.op_id for o in body.ops])).all()}
    results: list[SyncOpResult] = []
    for op in body.ops:
        if op.op_id in seen:
            prior = seen[op.op_id]
            if prior.device_id != ctx.device.id:
                results.append(SyncOpResult(op_id=op.op_id, status="rejected", reason="Operation id reused"))
            else:
                results.append(SyncOpResult(op_id=op.op_id, status=prior.status, reason=prior.reason))
            continue
        result = batch.apply(op)
        seen[op.op_id] = SyncOp(op_id=op.op_id, device_id=ctx.device.id, status=result.status, reason=result.reason)
        results.append(result)
    ctx.device.last_sync_at = now
    db.commit()
    return SyncPushResult(server_time=now, clock_offset_seconds=round(offset.total_seconds(), 1), results=results)


# ---------------------------------------------------------------------------
# Devices (dashboard)
# ---------------------------------------------------------------------------
def _device_out(d: Device) -> DeviceOut:
    return DeviceOut(id=d.id, label=d.label, app_version=d.app_version, created_at=d.created_at,
                     last_seen_at=d.last_seen_at, last_sync_at=d.last_sync_at, active=d.revoked_at is None,
                     revoked_at=d.revoked_at)


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    """The lecturer's attendance phones, active one first."""
    devices = db.query(Device).filter(Device.lecturer_id == lecturer.id).all()
    devices.sort(key=lambda d: (d.revoked_at is not None, -(d.last_seen_at or d.created_at).timestamp()))
    return [_device_out(d) for d in devices]


@router.post("/devices/{device_id}/revoke", response_model=DeviceOut)
def revoke_device(device_id: str, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    """Sign a phone out. It may still upload what it recorded offline during the grace period."""
    device = db.get(Device, device_id)
    if device is None or device.lecturer_id != lecturer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        db.commit()
    return _device_out(device)

