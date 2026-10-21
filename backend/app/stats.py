"""Attendance statistics shared by the student app and the lecturer dashboard.

Counting rules (the same everywhere, so the app and the dashboard never disagree):
  * A session counts for every student enrolled in the course once it has ENDED, including
    classes held before they joined: a student who joins after three classes has missed three.
  * If the student was marked present, the session counts for them even while it is still live,
    so being scanned always shows up straight away.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction

from sqlalchemy.orm import Session

from .models import Attendance, ClassSession, Course, Enrollment

AT_RISK_THRESHOLD = 75.0  # below this the student may be barred from the exam
_REQUIRED = Fraction(75, 100)  # AT_RISK_THRESHOLD as an exact fraction, so the maths below has no rounding


def percentage(attended: int, held: int) -> float:
    """Attendance percentage rounded to one decimal; 0 when nothing has been held."""
    if held == 0:
        return 0.0
    return round(attended * 100.0 / held, 1)


def is_at_risk(attended: int, held: int) -> bool:
    return held > 0 and attended < _REQUIRED * held


@dataclass(frozen=True)
class ExamStanding:
    """Where a student stands for one course's exam (each course is judged on its own attendance)."""
    eligible: bool
    classes_to_qualify: int  # classes in a row they must attend to get back to the threshold (0 if eligible)
    can_miss: int            # classes in a row they can miss and still be eligible (0 if not eligible)


def exam_standing(attended: int, held: int) -> ExamStanding:
    if not is_at_risk(attended, held):
        # largest m with attended / (held + m) >= required
        return ExamStanding(True, 0, int(attended / _REQUIRED) - held)
    # smallest n with (attended + n) / (held + n) >= required
    need = (_REQUIRED * held - attended) / (1 - _REQUIRED)
    return ExamStanding(False, -(-need.numerator // need.denominator), 0)


def session_counts_for(session: ClassSession, attended: bool) -> bool:
    return attended or session.ended_at is not None


@dataclass
class CourseStats:
    """Everything needed to report on one course, loaded with three queries."""
    course: Course
    sessions: list[ClassSession]                      # newest first
    enrollments: list[Enrollment]
    marks: dict[tuple[int, int], Attendance]          # (student_id, session_id) -> row
    _per_student: dict[int, tuple[int, int]] = field(default_factory=dict)

    @classmethod
    def load(cls, db: Session, course: Course) -> CourseStats:
        sessions = (
            db.query(ClassSession)
            .filter(ClassSession.course_id == course.id)
            .order_by(ClassSession.started_at.desc())
            .all()
        )
        enrollments = db.query(Enrollment).filter(Enrollment.course_id == course.id).all()
        rows = (
            db.query(Attendance).join(ClassSession).filter(ClassSession.course_id == course.id).all()
            if sessions else []
        )
        return cls(course, sessions, enrollments, {(a.student_id, a.session_id): a for a in rows})

    def attended(self, student_id: int, session_id: int) -> bool:
        return (student_id, session_id) in self.marks

    def student(self, enrollment: Enrollment) -> tuple[int, int]:
        """(classes_held, classes_attended) for one enrolled student."""
        sid = enrollment.student_id
        if sid not in self._per_student:
            held = attended = 0
            for s in self.sessions:
                was_there = self.attended(sid, s.id)
                if session_counts_for(s, was_there):
                    held += 1
                    attended += was_there
            self._per_student[sid] = (held, attended)
        return self._per_student[sid]

    def session(self, s: ClassSession) -> tuple[int, int]:
        """(present, expected) for one session. Expected = every student enrolled in the course."""
        present = sum(1 for e in self.enrollments if self.attended(e.student_id, s.id))
        return present, len(self.enrollments)

    @property
    def ended_sessions(self) -> list[ClassSession]:
        return [s for s in self.sessions if s.ended_at is not None]

    def average_pct(self) -> float:
        """Mean attendance over ended sessions (present / expected, pooled)."""
        present = expected = 0
        for s in self.ended_sessions:
            p, e = self.session(s)
            present += p
            expected += e
        return percentage(present, expected)

    def at_risk_count(self) -> int:
        count = 0
        for e in self.enrollments:
            held, attended = self.student(e)
            count += is_at_risk(attended, held)
        return count


def student_course_stats(db: Session, enrollment: Enrollment) -> tuple[int, int]:
    """(classes_held, classes_attended) for one enrolment, without loading the whole course."""
    sessions = db.query(ClassSession).filter(ClassSession.course_id == enrollment.course_id).all()
    attended_ids = {
        r[0] for r in db.query(Attendance.session_id)
        .filter(Attendance.student_id == enrollment.student_id,
                Attendance.session_id.in_([s.id for s in sessions]))
        .all()
    } if sessions else set()
    held = attended = 0
    for s in sessions:
        was_there = s.id in attended_ids
        if session_counts_for(s, was_there):
            held += 1
            attended += was_there
    return held, attended
