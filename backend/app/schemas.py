"""Pydantic request / response schemas."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, PlainSerializer

# Stored as naive UTC; always sent with an explicit offset so clients convert to local time
UTCDateTime = Annotated[
    datetime,
    PlainSerializer(lambda d: (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).isoformat(), return_type=str),
]


# ---------- Auth ----------
class StudentRegister(BaseModel):
    matric_no: str = Field(..., min_length=3, max_length=32)
    full_name: str = Field(..., min_length=3, max_length=120)
    email: EmailStr | None = None
    department: str = Field(..., min_length=2, max_length=120)
    level: str = Field("100", max_length=10)
    password: str = Field(..., min_length=6, max_length=128)


class StudentLogin(BaseModel):
    matric_no: str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)


class LecturerRegister(BaseModel):
    title: str | None = Field(None, max_length=20)
    name: str = Field(..., min_length=3, max_length=120)
    staff_id: str | None = Field(None, max_length=32)
    email: EmailStr
    department: str = Field(..., min_length=2, max_length=120)
    faculty: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=32)
    office: str | None = Field(None, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)


class LecturerLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)
    # Sent by the attendance app (not the dashboard): registers this phone as the lecturer's
    # active device and returns a refresh token so it can keep syncing after being offline.
    device_id: str | None = Field(None, min_length=8, max_length=36)
    device_label: str | None = Field(None, max_length=120)
    app_version: str | None = Field(None, max_length=40)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=20, max_length=200)


class RefreshResult(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # False once the lecturer has signed in on another phone: this one may only push its queue
    device_active: bool


class LecturerUpdate(BaseModel):
    title: str | None = Field(None, max_length=20)
    name: str | None = Field(None, min_length=3, max_length=120)
    department: str | None = Field(None, min_length=2, max_length=120)
    faculty: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=32)
    office: str | None = Field(None, max_length=120)


class StudentOut(BaseModel):
    id: int
    matric_no: str
    full_name: str
    email: str | None
    department: str
    level: str
    face_enrolled: bool
    # Enrolled, but with an older face model: the app asks the student to scan their face again
    face_needs_update: bool = False


class LecturerMe(BaseModel):
    id: int
    title: str | None
    name: str
    display_name: str
    staff_id: str | None
    email: str
    department: str
    faculty: str | None
    phone: str | None
    office: str | None


class StudentToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Literal["student"] = "student"
    student: StudentOut


class LecturerToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Literal["lecturer"] = "lecturer"
    lecturer: LecturerMe
    refresh_token: str | None = None  # only when the login named a device_id


# ---------- Student side ----------
class LiveClass(BaseModel):
    session_id: int
    course_id: int
    course_code: str
    course_title: str
    lecturer_name: str
    venue: str | None
    started_at: UTCDateTime
    attended: bool


class RecentAttendance(BaseModel):
    session_id: int
    course_code: str
    course_title: str
    started_at: UTCDateTime
    attended: bool
    marked_at: UTCDateTime | None


class CourseSummary(BaseModel):
    id: int
    code: str
    title: str
    lecturer_name: str
    classes_held: int
    classes_attended: int
    attendance_pct: float
    # Exam eligibility is decided per course, never on an average across courses
    required_pct: float
    eligible: bool
    classes_to_qualify: int
    can_miss: int


class StudentDashboard(BaseModel):
    student: StudentOut
    total_courses: int
    courses: list[CourseSummary]
    live_classes: list[LiveClass]
    recent: list[RecentAttendance]


class CatalogCourse(BaseModel):
    id: int
    code: str
    title: str
    description: str | None
    units: int | None
    level: str | None
    semester: str | None
    lecturer_name: str
    department: str
    students: int
    joined: bool


class JoinResult(BaseModel):
    message: str
    course: CourseSummary


class StudentSessionEntry(BaseModel):
    session_id: int
    started_at: UTCDateTime
    ended_at: UTCDateTime | None
    venue: str | None
    topic: str | None
    attended: bool
    marked_at: UTCDateTime | None


class CourseDetailOut(BaseModel):
    id: int
    code: str
    title: str
    description: str | None
    lecturer_name: str
    lecturer_department: str
    joined_at: UTCDateTime
    classes_held: int
    classes_attended: int
    attendance_pct: float
    at_risk: bool
    required_pct: float
    eligible: bool
    classes_to_qualify: int
    can_miss: int
    sessions: list[StudentSessionEntry]


class LecturerOut(BaseModel):
    id: int
    name: str
    department: str
    courses: list[str]
    email: str | None
    phone: str | None
    office: str | None


class FaceEnrolResult(BaseModel):
    message: str
    embedding_length: int
    images_used: int = 1


# ---------- Lecturer side: courses ----------
class CourseCreate(BaseModel):
    code: str = Field(..., min_length=3, max_length=16)
    title: str = Field(..., min_length=3, max_length=160)
    description: str | None = Field(None, max_length=2000)
    units: int | None = Field(None, ge=0, le=12)
    level: str | None = Field(None, max_length=10)
    semester: str | None = Field(None, max_length=20)


class CourseUpdate(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=160)
    description: str | None = Field(None, max_length=2000)
    units: int | None = Field(None, ge=0, le=12)
    level: str | None = Field(None, max_length=10)
    semester: str | None = Field(None, max_length=20)
    is_active: bool | None = None


class LecturerCourse(BaseModel):
    id: int
    code: str
    title: str
    description: str | None
    units: int | None
    level: str | None
    semester: str | None
    is_active: bool
    created_at: UTCDateTime
    students: int
    faces_enrolled: int
    sessions: int
    avg_attendance_pct: float
    at_risk: int
    live_session_id: int | None
    last_session_at: UTCDateTime | None


class CourseStudentRow(BaseModel):
    student_id: int
    matric_no: str
    full_name: str
    department: str
    level: str
    face_enrolled: bool
    joined_at: UTCDateTime
    classes_held: int
    classes_attended: int
    attendance_pct: float
    at_risk: bool


class SessionSummary(BaseModel):
    id: int
    course_id: int
    course_code: str
    course_title: str
    started_at: UTCDateTime
    ended_at: UTCDateTime | None
    duration_minutes: int | None
    venue: str | None
    topic: str | None
    is_live: bool
    present: int
    expected: int
    attendance_pct: float
    # Recorded on the lecturer's phone and uploaded later (None = created through the online API)
    synced_at: UTCDateTime | None = None
    # Set when the phone's clock was wrong and its times were corrected by this many seconds
    clock_offset_seconds: float | None = None


class TrendPoint(BaseModel):
    session_id: int
    label: str
    started_at: UTCDateTime
    course_code: str
    present: int
    expected: int
    attendance_pct: float


class LecturerCourseDetail(BaseModel):
    course: LecturerCourse
    students: list[CourseStudentRow]
    sessions: list[SessionSummary]
    trend: list[TrendPoint]


# ---------- Lecturer side: sessions / attendance ----------
class SessionStart(BaseModel):
    venue: str | None = Field(None, max_length=120)
    topic: str | None = Field(None, max_length=200)


class PresentRow(BaseModel):
    student_id: int
    matric_no: str
    full_name: str
    marked_at: UTCDateTime
    minutes_after_start: int
    method: str
    confidence: float | None


class AbsentRow(BaseModel):
    student_id: int
    matric_no: str
    full_name: str
    face_enrolled: bool


class SessionDetail(BaseModel):
    session: SessionSummary
    present: list[PresentRow]
    absent: list[AbsentRow]


class ScanStudent(BaseModel):
    id: int
    matric_no: str
    full_name: str


class ScanResult(BaseModel):
    status: Literal["marked", "already_marked", "not_recognised"]
    message: str
    student: ScanStudent | None
    confidence: float | None
    marked_at: UTCDateTime | None
    present: int
    expected: int


# ---------- Lecturer side: overview / notifications ----------
class CourseBreakdown(BaseModel):
    course_id: int
    code: str
    title: str
    students: int
    sessions: int
    avg_attendance_pct: float


class AtRiskStudent(BaseModel):
    student_id: int
    matric_no: str
    full_name: str
    course_id: int
    course_code: str
    classes_held: int
    classes_attended: int
    attendance_pct: float


class WeekdayStat(BaseModel):
    weekday: str
    sessions: int
    avg_attendance_pct: float


class LecturerOverview(BaseModel):
    lecturer: LecturerMe
    total_courses: int
    active_courses: int
    total_students: int
    total_enrolments: int
    faces_enrolled: int
    total_sessions: int
    sessions_this_week: int
    avg_attendance_pct: float
    total_checkins: int
    live_sessions: list[SessionSummary]
    trend: list[TrendPoint]
    by_course: list[CourseBreakdown]
    by_weekday: list[WeekdayStat]
    at_risk: list[AtRiskStudent]
    recent_sessions: list[SessionSummary]
    unread_notifications: int


class NotificationOut(BaseModel):
    id: int
    kind: str
    message: str
    course_id: int | None
    course_code: str | None
    student_id: int | None
    student_name: str | None
    student_matric: str | None
    created_at: UTCDateTime
    read: bool


class NotificationList(BaseModel):
    unread: int
    items: list[NotificationOut]


# ---------- Offline sync (lecturer attendance device) ----------
class SyncFace(BaseModel):
    model: str
    poses: int
    data: str  # base64 of `poses` x 512 little-endian float32, L2-normalised


class SyncStudent(BaseModel):
    id: int
    matric_no: str
    full_name: str
    face: SyncFace | None  # None = not enrolled, or enrolled with an older model (needs_update)
    needs_update: bool = False


class SyncCourse(BaseModel):
    id: int
    code: str
    title: str
    is_active: bool


class SyncEnrollment(BaseModel):
    course_id: int
    student_id: int
    joined_at: UTCDateTime


class SyncSession(BaseModel):
    uuid: str
    course_id: int
    started_at: UTCDateTime
    ended_at: UTCDateTime | None
    venue: str | None
    topic: str | None


class SyncMark(BaseModel):
    session_uuid: str
    student_id: int
    marked_at: UTCDateTime
    method: str


class SyncDeleted(BaseModel):
    courses: list[int] = []
    enrollments: list[tuple[int, int]] = []   # (course_id, student_id)
    sessions: list[str] = []                  # uuids
    marks: list[tuple[str, int]] = []         # (session_uuid, student_id)


class SyncMatching(BaseModel):
    model_version: str
    threshold: float
    margin: float


class SyncOfflinePolicy(BaseModel):
    warn_days: int
    strong_warn_days: int
    block_days: int


class SyncPullResult(BaseModel):
    server_time: UTCDateTime
    cursor: str          # pass back as `since` next time
    full: bool           # True: replace everything local with this snapshot
    matching: SyncMatching
    offline_policy: SyncOfflinePolicy
    courses: list[SyncCourse]
    students: list[SyncStudent]
    enrollments: list[SyncEnrollment]
    sessions: list[SyncSession]
    marks: list[SyncMark]
    deleted: SyncDeleted


SyncOpType = Literal["session.start", "session.end", "attendance.mark", "attendance.unmark"]


class SyncOpIn(BaseModel):
    op_id: str = Field(..., min_length=8, max_length=36)
    type: SyncOpType
    payload: dict


class SyncPushRequest(BaseModel):
    device_time: datetime  # the phone's clock when it sent the batch (for clock correction)
    ops: list[SyncOpIn] = Field(..., max_length=500)


class SyncOpResult(BaseModel):
    op_id: str
    status: Literal["applied", "rejected"]
    reason: str | None = None


class SyncPushResult(BaseModel):
    server_time: UTCDateTime
    clock_offset_seconds: float  # server minus device; applied when beyond the tolerance
    results: list[SyncOpResult]


class DeviceOut(BaseModel):
    id: str
    label: str | None
    app_version: str | None
    created_at: UTCDateTime
    last_seen_at: UTCDateTime | None
    last_sync_at: UTCDateTime | None
    active: bool
    revoked_at: UTCDateTime | None
