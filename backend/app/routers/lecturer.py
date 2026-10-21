"""Lecturer endpoints: used by the web dashboard and by the phone's attendance-taking mode.

Dashboard: overview statistics, courses (create / edit / archive), class logs, manual
corrections, CSV exports and notifications.
Phone:     list courses, start a class, scan faces (1:N identification), end the class.
"""
import csv
import io
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import face_service
from ..config import settings
from ..database import get_db
from ..models import (Attendance, ClassSession, Course, Enrollment, Lecturer, Notification, Student,
                      utcnow)
from ..schemas import (AbsentRow, AtRiskStudent, CourseBreakdown, CourseCreate, CourseStudentRow, CourseUpdate,
                       LecturerCourse, LecturerCourseDetail, LecturerOverview, NotificationList, NotificationOut,
                       PresentRow, ScanResult, ScanStudent, SessionDetail, SessionStart, SessionSummary,
                       TrendPoint, WeekdayStat)
from ..security import get_current_lecturer
from ..stats import CourseStats, is_at_risk, percentage
from .auth import lecturer_out
from .sync import record_tombstone

router = APIRouter(prefix="/lecturer", tags=["lecturer"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _local(dt: datetime) -> datetime:
    """Naive UTC from the DB -> the institution's local time (for weekdays and CSV exports)."""
    return dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(settings.display_timezone))


# ---------------------------------------------------------------------------
# Loading helpers (always scoped to the signed-in lecturer)
# ---------------------------------------------------------------------------
def _own_course(db: Session, lecturer: Lecturer, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None or course.lecturer_id != lecturer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    return course


def _own_session(db: Session, lecturer: Lecturer, session_id: int) -> ClassSession:
    session = db.get(ClassSession, session_id)
    if session is None or session.course.lecturer_id != lecturer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class session not found")
    return session


def close_stale_sessions(db: Session, lecturer: Lecturer) -> None:
    """End classes that were left running (lecturer forgot to tap End) so they count in the stats."""
    limit = timedelta(hours=settings.session_auto_end_hours)
    stale = (
        db.query(ClassSession).join(Course)
        .filter(Course.lecturer_id == lecturer.id, ClassSession.ended_at.is_(None),
                ClassSession.started_at < utcnow() - limit)
        .all()
    )
    for s in stale:
        s.ended_at = s.started_at + limit
    if stale:
        db.commit()


def _all_stats(db: Session, lecturer: Lecturer) -> list[CourseStats]:
    courses = db.query(Course).filter(Course.lecturer_id == lecturer.id).order_by(Course.code).all()
    return [CourseStats.load(db, c) for c in courses]


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------
def _session_summary(stats: CourseStats, s: ClassSession) -> SessionSummary:
    present, expected = stats.session(s)
    duration = None
    if s.ended_at is not None:
        duration = max(0, round((s.ended_at - s.started_at).total_seconds() / 60))
    return SessionSummary(
        id=s.id, course_id=s.course_id, course_code=stats.course.code, course_title=stats.course.title,
        started_at=s.started_at, ended_at=s.ended_at, duration_minutes=duration, venue=s.venue, topic=s.topic,
        is_live=s.is_live, present=present, expected=expected, attendance_pct=percentage(present, expected),
        synced_at=s.synced_at, clock_offset_seconds=s.clock_offset_seconds,
    )


def _course_out(stats: CourseStats) -> LecturerCourse:
    c = stats.course
    live = next((s for s in stats.sessions if s.is_live), None)
    return LecturerCourse(
        id=c.id, code=c.code, title=c.title, description=c.description, units=c.units, level=c.level,
        semester=c.semester, is_active=c.is_active, created_at=c.created_at,
        students=len(stats.enrollments),
        faces_enrolled=sum(1 for e in stats.enrollments if e.student.face_ready),
        sessions=len(stats.ended_sessions),
        avg_attendance_pct=stats.average_pct(),
        at_risk=stats.at_risk_count(),
        live_session_id=live.id if live else None,
        last_session_at=stats.sessions[0].started_at if stats.sessions else None,
    )


def _trend(stats_list: list[CourseStats], limit: int, with_code: bool) -> list[TrendPoint]:
    """Attendance % of the most recent ended classes, oldest first (for line charts)."""
    points = []
    for stats in stats_list:
        ended = sorted(stats.ended_sessions, key=lambda s: s.started_at)
        for n, s in enumerate(ended, start=1):
            present, expected = stats.session(s)
            points.append(TrendPoint(
                session_id=s.id,
                label=f"{stats.course.code} #{n}" if with_code else f"Class {n}",
                started_at=s.started_at, course_code=stats.course.code,
                present=present, expected=expected, attendance_pct=percentage(present, expected),
            ))
    points.sort(key=lambda p: p.started_at)
    return points[-limit:]


def _notification_out(n: Notification, db: Session) -> NotificationOut:
    course = db.get(Course, n.course_id) if n.course_id else None
    student = db.get(Student, n.student_id) if n.student_id else None
    return NotificationOut(
        id=n.id, kind=n.kind, message=n.message, course_id=n.course_id,
        course_code=course.code if course else None, student_id=n.student_id,
        student_name=student.full_name if student else None,
        student_matric=student.matric_no if student else None,
        created_at=n.created_at, read=n.read_at is not None,
    )


def _unread(db: Session, lecturer: Lecturer) -> int:
    return db.query(Notification).filter(Notification.lecturer_id == lecturer.id, Notification.read_at.is_(None)).count()


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------
@router.get("/overview", response_model=LecturerOverview)
def overview(lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    close_stale_sessions(db, lecturer)
    all_stats = _all_stats(db, lecturer)

    students: set[int] = set()
    faces = 0
    enrolments = sessions_total = checkins = 0
    pooled_present = pooled_expected = 0
    week_start = utcnow() - timedelta(days=7)
    sessions_this_week = 0
    weekday: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])  # sessions, present, expected
    live: list[SessionSummary] = []
    recent: list[tuple[datetime, SessionSummary]] = []
    at_risk: list[AtRiskStudent] = []

    for stats in all_stats:
        enrolments += len(stats.enrollments)
        for e in stats.enrollments:
            if e.student_id not in students:
                students.add(e.student_id)
                faces += e.student.face_ready
            held, attended = stats.student(e)
            if is_at_risk(attended, held):
                at_risk.append(AtRiskStudent(
                    student_id=e.student_id, matric_no=e.student.matric_no, full_name=e.student.full_name,
                    course_id=stats.course.id, course_code=stats.course.code, classes_held=held,
                    classes_attended=attended, attendance_pct=percentage(attended, held),
                ))
        checkins += len(stats.marks)
        for s in stats.sessions:
            summary = _session_summary(stats, s)
            if s.is_live:
                live.append(summary)
                continue
            sessions_total += 1
            sessions_this_week += s.started_at >= week_start
            pooled_present += summary.present
            pooled_expected += summary.expected
            bucket = weekday[_local(s.started_at).weekday()]
            bucket[0] += 1
            bucket[1] += summary.present
            bucket[2] += summary.expected
            recent.append((s.started_at, summary))

    recent.sort(key=lambda r: r[0], reverse=True)
    at_risk.sort(key=lambda a: a.attendance_pct)
    return LecturerOverview(
        lecturer=lecturer_out(lecturer),
        total_courses=len(all_stats),
        active_courses=sum(1 for s in all_stats if s.course.is_active),
        total_students=len(students),
        total_enrolments=enrolments,
        faces_enrolled=faces,
        total_sessions=sessions_total,
        sessions_this_week=sessions_this_week,
        avg_attendance_pct=percentage(pooled_present, pooled_expected),
        total_checkins=checkins,
        live_sessions=live,
        trend=_trend(all_stats, limit=20, with_code=True),
        by_course=[
            CourseBreakdown(
                course_id=s.course.id, code=s.course.code, title=s.course.title, students=len(s.enrollments),
                sessions=len(s.ended_sessions), avg_attendance_pct=s.average_pct(),
            )
            for s in all_stats
        ],
        by_weekday=[
            WeekdayStat(weekday=WEEKDAYS[d], sessions=b[0], avg_attendance_pct=percentage(b[1], b[2]))
            for d, b in sorted(weekday.items())
        ],
        at_risk=at_risk[:15],
        recent_sessions=[r[1] for r in recent[:8]],
        unread_notifications=_unread(db, lecturer),
    )


# ---------------------------------------------------------------------------
# Courses
# ---------------------------------------------------------------------------
@router.get("/courses", response_model=list[LecturerCourse])
def list_courses(lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    close_stale_sessions(db, lecturer)
    return [_course_out(s) for s in _all_stats(db, lecturer)]


@router.post("/courses", response_model=LecturerCourse, status_code=status.HTTP_201_CREATED)
def create_course(body: CourseCreate, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    code = "".join(body.code.split()).upper()  # "csc 401" -> "CSC401"
    if db.query(Course).filter(Course.code == code).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"A course with code {code} already exists")
    course = Course(
        code=code, title=body.title.strip(), description=(body.description or "").strip() or None,
        units=body.units, level=(body.level or "").strip() or None, semester=(body.semester or "").strip() or None,
        lecturer_id=lecturer.id,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return _course_out(CourseStats.load(db, course))


@router.get("/courses/{course_id}", response_model=LecturerCourseDetail)
def course_detail(course_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    close_stale_sessions(db, lecturer)
    stats = CourseStats.load(db, _own_course(db, lecturer, course_id))
    rows = []
    for e in stats.enrollments:
        held, attended = stats.student(e)
        rows.append(CourseStudentRow(
            student_id=e.student_id, matric_no=e.student.matric_no, full_name=e.student.full_name,
            department=e.student.department, level=e.student.level, face_enrolled=e.student.face_ready,
            joined_at=e.joined_at, classes_held=held, classes_attended=attended,
            attendance_pct=percentage(attended, held), at_risk=is_at_risk(attended, held),
        ))
    rows.sort(key=lambda r: r.matric_no)
    return LecturerCourseDetail(
        course=_course_out(stats),
        students=rows,
        sessions=[_session_summary(stats, s) for s in stats.sessions],
        trend=_trend([stats], limit=50, with_code=False),
    )


@router.patch("/courses/{course_id}", response_model=LecturerCourse)
def update_course(course_id: int, body: CourseUpdate, lecturer: Lecturer = Depends(get_current_lecturer),
                  db: Session = Depends(get_db)):
    course = _own_course(db, lecturer, course_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "title":
            if not value or not value.strip():
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Title cannot be empty")
            value = value.strip()
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(course, field, value)
    db.commit()
    return _course_out(CourseStats.load(db, course))


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    """Only courses without any classes can be deleted; otherwise archive them to keep the records."""
    course = _own_course(db, lecturer, course_id)
    if course.sessions:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This course already has attendance records. Archive it instead of deleting.")
    db.query(Notification).filter(Notification.course_id == course.id).update({Notification.course_id: None})
    db.delete(course)
    record_tombstone(db, lecturer.id, "course", str(course.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/courses/{course_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_student(course_id: int, student_id: int, lecturer: Lecturer = Depends(get_current_lecturer),
                   db: Session = Depends(get_db)):
    """Drop a student from the course (their past attendance in it is removed too)."""
    course = _own_course(db, lecturer, course_id)
    enrollment = db.query(Enrollment).filter_by(course_id=course.id, student_id=student_id).first()
    if enrollment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student is not registered for this course")
    session_ids = [s.id for s in course.sessions]
    if session_ids:
        db.query(Attendance).filter(Attendance.student_id == student_id, Attendance.session_id.in_(session_ids)) \
            .delete(synchronize_session=False)
    db.delete(enrollment)
    record_tombstone(db, lecturer.id, "enrollment", f"{course.id}:{student_id}")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/courses/{course_id}/export.csv")
def export_course(course_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    """Attendance register: one row per student, one column per class (P / A)."""
    stats = CourseStats.load(db, _own_course(db, lecturer, course_id))
    ended = sorted(stats.ended_sessions, key=lambda s: s.started_at)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Matric No", "Name", *[_local(s.started_at).strftime("%Y-%m-%d %H:%M") for s in ended],
                     "Attended", "Held", "Percentage"])
    for e in sorted(stats.enrollments, key=lambda e: e.student.matric_no):
        cells = ["P" if stats.attended(e.student_id, s.id) else "A" for s in ended]
        held, attended = stats.student(e)
        writer.writerow([e.student.matric_no, e.student.full_name, *cells, attended, held, percentage(attended, held)])
    filename = f"{stats.course.code}_attendance_register.csv"
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------------------
# Class sessions
# ---------------------------------------------------------------------------
@router.post("/courses/{course_id}/sessions", response_model=SessionSummary, status_code=status.HTTP_201_CREATED)
def start_session(course_id: int, body: SessionStart | None = None, lecturer: Lecturer = Depends(get_current_lecturer),
                  db: Session = Depends(get_db)):
    """Start taking attendance for a class now. A lecturer can only run one class at a time."""
    course = _own_course(db, lecturer, course_id)
    if not course.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This course is archived")
    close_stale_sessions(db, lecturer)
    running = (
        db.query(ClassSession).join(Course)
        .filter(Course.lecturer_id == lecturer.id, ClassSession.ended_at.is_(None))
        .first()
    )
    if running is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"{running.course.code} is still in progress. End it before starting another class.")
    body = body or SessionStart()
    session = ClassSession(
        course_id=course.id, started_at=utcnow(),
        venue=(body.venue or "").strip() or None, topic=(body.topic or "").strip() or None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_summary(CourseStats.load(db, course), session)


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(
    course_id: int | None = None,
    state: str | None = Query(None, pattern="^(live|ended)$"),
    limit: int = Query(200, ge=1, le=1000),
    lecturer: Lecturer = Depends(get_current_lecturer),
    db: Session = Depends(get_db),
):
    """Class logs across all of the lecturer's courses, newest first."""
    close_stale_sessions(db, lecturer)
    all_stats = _all_stats(db, lecturer)
    if course_id is not None:
        all_stats = [s for s in all_stats if s.course.id == course_id]
    out = []
    for stats in all_stats:
        for s in stats.sessions:
            if state == "live" and not s.is_live or state == "ended" and s.is_live:
                continue
            out.append(_session_summary(stats, s))
    out.sort(key=lambda s: s.started_at, reverse=True)
    return out[:limit]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def session_detail(session_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    session = _own_session(db, lecturer, session_id)
    stats = CourseStats.load(db, session.course)
    present, absent = [], []
    for e in stats.enrollments:
        mark = stats.marks.get((e.student_id, session.id))
        if mark is not None:
            present.append(PresentRow(
                student_id=e.student_id, matric_no=e.student.matric_no, full_name=e.student.full_name,
                marked_at=mark.marked_at,
                minutes_after_start=max(0, int((mark.marked_at - session.started_at).total_seconds() // 60)),
                method=mark.method, confidence=mark.confidence,
            ))
        else:
            absent.append(AbsentRow(student_id=e.student_id, matric_no=e.student.matric_no,
                                    full_name=e.student.full_name, face_enrolled=e.student.face_ready))
    present.sort(key=lambda p: p.marked_at)
    absent.sort(key=lambda a: a.matric_no)
    return SessionDetail(session=_session_summary(stats, session), present=present, absent=absent)


@router.post("/sessions/{session_id}/end", response_model=SessionSummary)
def end_session(session_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    session = _own_session(db, lecturer, session_id)
    if session.ended_at is None:
        session.ended_at = utcnow()
        db.commit()
    return _session_summary(CourseStats.load(db, session.course), session)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    """Remove a class started by mistake, together with its attendance marks."""
    session = _own_session(db, lecturer, session_id)
    db.delete(session)
    record_tombstone(db, lecturer.id, "session", session.uuid)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/{session_id}/scan", response_model=ScanResult)
async def scan_face(
    session_id: int,
    image: UploadFile = File(...),
    lecturer: Lecturer = Depends(get_current_lecturer),
    db: Session = Depends(get_db),
):
    """Legacy (pre offline-first app): the phone sends one photo; the server identifies the student.

    Current apps match faces on the phone and send the marks through /lecturer/sync/push.
    """
    if not settings.face_legacy:
        raise HTTPException(status.HTTP_410_GONE, "Update the app: attendance is now recognised on the phone")
    session = _own_session(db, lecturer, session_id)
    if not session.is_live:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This class has ended")

    image_bytes = await image.read()
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image is empty or larger than 5 MB")

    enrollments = db.query(Enrollment).filter(Enrollment.course_id == session.course_id).all()
    # Only faces enrolled through the legacy server-side path were made by this model
    candidates = [(e.student_id, e.student.face_embedding) for e in enrollments
                  if e.student.face_embedding and e.student.embedding_model is None]
    if not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No student in this course has enrolled their face yet")

    try:
        student_id, confidence, _ = await run_in_threadpool(face_service.identify, image_bytes, candidates)
    except face_service.FaceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except RuntimeError as exc:  # DeepFace missing
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))

    def counts() -> tuple[int, int]:
        return CourseStats.load(db, session.course).session(session)

    if student_id is None:
        present, expected = counts()
        return ScanResult(status="not_recognised",
                          message="Face not recognised as a student registered for this course.",
                          student=None, confidence=None, marked_at=None, present=present, expected=expected)

    student = db.get(Student, student_id)
    who = ScanStudent(id=student.id, matric_no=student.matric_no, full_name=student.full_name)
    row = db.query(Attendance).filter_by(student_id=student.id, session_id=session.id).first()
    created = False
    if row is None:
        row = Attendance(student_id=student.id, session_id=session.id, marked_at=utcnow(), method="face",
                         confidence=round(confidence, 4))
        db.add(row)
        try:
            db.commit()
            created = True
        except IntegrityError:  # the same face scanned twice at once
            db.rollback()
            row = db.query(Attendance).filter_by(student_id=student.id, session_id=session.id).first()
    present, expected = counts()
    return ScanResult(
        status="marked" if created else "already_marked",
        message=f"{student.full_name} marked present" if created else f"{student.full_name} is already marked",
        student=who, confidence=round(confidence, 4), marked_at=row.marked_at, present=present, expected=expected,
    )


@router.put("/sessions/{session_id}/attendance/{student_id}", response_model=SessionSummary)
def mark_manually(session_id: int, student_id: int, lecturer: Lecturer = Depends(get_current_lecturer),
                  db: Session = Depends(get_db)):
    """Dashboard correction: mark a registered student present (e.g. the camera failed for them)."""
    session = _own_session(db, lecturer, session_id)
    if db.query(Enrollment).filter_by(course_id=session.course_id, student_id=student_id).first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student is not registered for this course")
    if db.query(Attendance).filter_by(session_id=session.id, student_id=student_id).first() is None:
        db.add(Attendance(student_id=student_id, session_id=session.id, marked_at=utcnow(), method="manual"))
        db.commit()
    return _session_summary(CourseStats.load(db, session.course), session)


@router.delete("/sessions/{session_id}/attendance/{student_id}", response_model=SessionSummary)
def unmark(session_id: int, student_id: int, lecturer: Lecturer = Depends(get_current_lecturer),
           db: Session = Depends(get_db)):
    """Dashboard correction: remove a wrong attendance mark."""
    session = _own_session(db, lecturer, session_id)
    if db.query(Attendance).filter_by(session_id=session.id, student_id=student_id).delete():
        record_tombstone(db, lecturer.id, "attendance", f"{session.uuid}:{student_id}")
    db.commit()
    return _session_summary(CourseStats.load(db, session.course), session)


@router.get("/sessions/{session_id}/export.csv")
def export_session(session_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    detail = session_detail(session_id, lecturer, db)
    s = detail.session
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Matric No", "Name", "Status", "Time marked", "Minutes after start", "Method", "Confidence"])
    for p in detail.present:
        writer.writerow([p.matric_no, p.full_name, "Present", _local(p.marked_at).strftime("%Y-%m-%d %H:%M:%S"),
                         p.minutes_after_start, p.method,
                         f"{p.confidence * 100:.0f}%" if p.confidence is not None else ""])
    for a in detail.absent:
        writer.writerow([a.matric_no, a.full_name, "Absent", "", "", "", ""])
    filename = f"{s.course_code}_{_local(s.started_at).strftime('%Y-%m-%d_%H%M')}.csv"
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@router.get("/notifications", response_model=NotificationList)
def notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    lecturer: Lecturer = Depends(get_current_lecturer),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.lecturer_id == lecturer.id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    items = query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()
    return NotificationList(unread=_unread(db, lecturer), items=[_notification_out(n, db) for n in items])


@router.post("/notifications/read-all", response_model=NotificationList)
def read_all(lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.lecturer_id == lecturer.id, Notification.read_at.is_(None)) \
        .update({Notification.read_at: utcnow()})
    db.commit()
    return notifications(False, 50, lecturer, db)


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def read_one(notification_id: int, lecturer: Lecturer = Depends(get_current_lecturer), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if n is None or n.lecturer_id != lecturer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    if n.read_at is None:
        n.read_at = utcnow()
        db.commit()
    return _notification_out(n, db)
