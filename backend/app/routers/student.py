"""Student-facing endpoints: dashboard, course catalogue + joining, history, lecturers, face enrolment.

Students never mark their own attendance; the lecturer's phone does that (see routers/lecturer.py).
"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import face_service
from ..database import get_db
from ..models import Attendance, ClassSession, Course, Enrollment, Lecturer, Notification, Student, utcnow
from ..schemas import (CatalogCourse, CourseDetailOut, CourseSummary, FaceEnrolResult, JoinResult, LecturerOut,
                       LiveClass, RecentAttendance, StudentDashboard, StudentSessionEntry)
from ..security import get_current_student
from ..stats import AT_RISK_THRESHOLD, exam_standing, is_at_risk, percentage, session_counts_for, student_course_stats
from .auth import student_out

router = APIRouter(prefix="/student", tags=["student"])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_ENROL_IMAGES = 8


def _enrollments(db: Session, student: Student) -> list[Enrollment]:
    return (
        db.query(Enrollment).join(Course)
        .filter(Enrollment.student_id == student.id)
        .order_by(Course.code)
        .all()
    )


def _marks(db: Session, student: Student) -> dict[int, Attendance]:
    return {a.session_id: a for a in db.query(Attendance).filter(Attendance.student_id == student.id).all()}


def _standing(attended: int, held: int) -> dict:
    s = exam_standing(attended, held)
    return dict(required_pct=AT_RISK_THRESHOLD, eligible=s.eligible,
                classes_to_qualify=s.classes_to_qualify, can_miss=s.can_miss)


def _summary(db: Session, e: Enrollment) -> CourseSummary:
    held, attended = student_course_stats(db, e)
    return CourseSummary(
        id=e.course.id,
        code=e.course.code,
        title=e.course.title,
        lecturer_name=e.course.lecturer.display_name,
        classes_held=held,
        classes_attended=attended,
        attendance_pct=percentage(attended, held),
        **_standing(attended, held),
    )


def _require_face(student: Student) -> None:
    if not student.face_embedding:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Enrol your face before joining courses")


@router.get("/dashboard", response_model=StudentDashboard)
def dashboard(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    enrollments = _enrollments(db, student)
    joined = {e.course_id: e for e in enrollments}
    marks = _marks(db, student)

    sessions = (
        db.query(ClassSession)
        .filter(ClassSession.course_id.in_(joined.keys()))
        .order_by(ClassSession.started_at.desc())
        .all()
        if joined else []
    )
    live: list[LiveClass] = []
    recent: list[RecentAttendance] = []
    for s in sessions:
        mark = marks.get(s.id)
        if s.is_live:
            live.append(LiveClass(
                session_id=s.id, course_id=s.course_id, course_code=s.course.code, course_title=s.course.title,
                lecturer_name=s.course.lecturer.display_name, venue=s.venue, started_at=s.started_at,
                attended=mark is not None,
            ))
        if len(recent) < 10 and session_counts_for(s, joined[s.course_id].joined_at, mark is not None):
            recent.append(RecentAttendance(
                session_id=s.id, course_code=s.course.code, course_title=s.course.title,
                started_at=s.started_at, attended=mark is not None,
                marked_at=mark.marked_at if mark else None,
            ))
    return StudentDashboard(
        student=student_out(student),
        total_courses=len(enrollments),
        courses=[_summary(db, e) for e in enrollments],
        live_classes=live,
        recent=recent,
    )


@router.get("/courses", response_model=list[CourseSummary])
def my_courses(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    return [_summary(db, e) for e in _enrollments(db, student)]


@router.get("/catalog", response_model=list[CatalogCourse])
def catalog(
    q: str | None = Query(None, description="Search course code, title or lecturer"),
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Every active course a student can join, with whether they've already joined it."""
    joined = {e.course_id for e in db.query(Enrollment).filter(Enrollment.student_id == student.id).all()}
    counts = dict(db.query(Enrollment.course_id, func.count(Enrollment.id)).group_by(Enrollment.course_id).all())
    query = db.query(Course).join(Lecturer).filter(Course.is_active.is_(True))
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(Course.code.ilike(like), Course.title.ilike(like), Lecturer.name.ilike(like)))
    return [
        CatalogCourse(
            id=c.id, code=c.code, title=c.title, description=c.description, units=c.units, level=c.level,
            semester=c.semester, lecturer_name=c.lecturer.display_name, department=c.lecturer.department,
            students=counts.get(c.id, 0), joined=c.id in joined,
        )
        for c in query.order_by(Course.code).all()
    ]


@router.post("/courses/{course_id}/join", response_model=JoinResult, status_code=status.HTTP_201_CREATED)
def join_course(course_id: int, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    """Register for a course. The course's lecturer gets a dashboard notification."""
    _require_face(student)
    course = db.get(Course, course_id)
    if course is None or not course.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Course not found")
    if db.query(Enrollment).filter_by(student_id=student.id, course_id=course_id).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"You are already registered for {course.code}")

    enrollment = Enrollment(student_id=student.id, course_id=course.id, joined_at=utcnow())
    db.add(enrollment)
    db.add(Notification(
        lecturer_id=course.lecturer_id,
        kind="student_joined",
        message=f"{student.full_name} ({student.matric_no}) joined {course.code}",
        course_id=course.id,
        student_id=student.id,
    ))
    try:
        db.commit()
    except IntegrityError:  # double tap: the other request already created it
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"You are already registered for {course.code}")
    db.refresh(enrollment)
    return JoinResult(message=f"You joined {course.code}", course=_summary(db, enrollment))


@router.get("/courses/{course_id}", response_model=CourseDetailOut)
def course_detail(course_id: int, student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    enrollment = db.query(Enrollment).filter_by(student_id=student.id, course_id=course_id).first()
    if enrollment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You are not registered for this course")
    course = enrollment.course
    marks = _marks(db, student)
    sessions = (
        db.query(ClassSession)
        .filter(ClassSession.course_id == course_id)
        .order_by(ClassSession.started_at.desc())
        .all()
    )
    entries = []
    for s in sessions:
        mark = marks.get(s.id)
        # Show live classes too (as "in progress") but hide ones from before the student joined
        if s.is_live or session_counts_for(s, enrollment.joined_at, mark is not None):
            entries.append(StudentSessionEntry(
                session_id=s.id, started_at=s.started_at, ended_at=s.ended_at, venue=s.venue, topic=s.topic,
                attended=mark is not None, marked_at=mark.marked_at if mark else None,
            ))
    held, attended = student_course_stats(db, enrollment)
    return CourseDetailOut(
        id=course.id,
        code=course.code,
        title=course.title,
        description=course.description,
        lecturer_name=course.lecturer.display_name,
        lecturer_department=course.lecturer.department,
        joined_at=enrollment.joined_at,
        classes_held=held,
        classes_attended=attended,
        attendance_pct=percentage(attended, held),
        at_risk=is_at_risk(attended, held),
        **_standing(attended, held),
        sessions=entries,
    )


@router.get("/lecturers", response_model=list[LecturerOut])
def my_lecturers(student: Student = Depends(get_current_student), db: Session = Depends(get_db)):
    by_lecturer: dict[int, list[str]] = {}
    for e in _enrollments(db, student):
        by_lecturer.setdefault(e.course.lecturer_id, []).append(e.course.code)
    if not by_lecturer:
        return []
    lecturers = db.query(Lecturer).filter(Lecturer.id.in_(by_lecturer.keys())).order_by(Lecturer.name).all()
    return [
        LecturerOut(
            id=l.id, name=l.display_name, department=l.department, courses=sorted(by_lecturer[l.id]),
            email=l.email, phone=l.phone, office=l.office,
        )
        for l in lecturers
    ]


@router.post("/enrol-face", response_model=FaceEnrolResult)
async def enrol_face(
    images: list[UploadFile] = File(default=[], description="Pose photos: frontal first, then head turned"),
    student: Student = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """Register (or replace) the student's reference face.

    The app sends several photos captured Face-ID style (looking straight, then turned
    left/right/up/down). One embedding is stored per photo; all must be the same person.
    """
    if not images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No image uploaded")
    if len(images) > MAX_ENROL_IMAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"At most {MAX_ENROL_IMAGES} photos per enrolment")

    payloads: list[bytes] = []
    for upload in images:
        data = await upload.read()
        if not data or len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "An image is empty or larger than 5 MB")
        payloads.append(data)

    try:
        # Embedding several photos takes seconds on CPU; keep the event loop free meanwhile
        embeddings = await run_in_threadpool(face_service.enrol_embeddings, payloads)
    except face_service.FaceError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))

    # JSON columns may hold SQL NULL or JSON null, so filter in Python
    others = [(o.id, o.face_embedding) for o in
              db.query(Student.id, Student.face_embedding).filter(Student.id != student.id).all() if o.face_embedding]
    if face_service.find_duplicate(embeddings, others) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This face is already registered to another student account. Contact your lecturer.")

    student.face_embedding = embeddings
    student.face_image_path = face_service.save_face_image(payloads[0], student.matric_no)
    student.face_enrolled_at = utcnow()
    db.commit()
    return FaceEnrolResult(
        message="Face enrolled successfully",
        embedding_length=len(embeddings[0]),
        images_used=len(embeddings),
    )
