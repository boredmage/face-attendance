"""Populate the database with demo data.

    python -m app.seed            # creates tables + demo data (skips if data exists)
    python -m app.seed --reset    # drops everything first (needed after upgrading from v1)

Demo logins (password for all: password123)
    Lecturer dashboard / lecturer mode:  ao.bello@ui.edu.ng   (CSC401, CSC407)
                                         ft.ibrahim@ui.edu.ng (CSC403)
    Students (mobile app):               CSC/2021/001 .. CSC/2021/008

Students have no face enrolled; enrol them in the app (or with enrol_face_cli.py) before scanning.
"""
import argparse
import random
from datetime import datetime, time, timedelta, timezone

from .database import Base, SessionLocal, engine
from .migrate import upgrade_db
from .models import Attendance, ClassSession, Course, Enrollment, Lecturer, Notification, Student, utcnow
from .security import hash_password

DEMO_PASSWORD = "password123"

LECTURERS = [
    dict(title="Dr.", name="A. O. Bello", staff_id="UI/CS/0101", department="Computer Science",
         faculty="Science", email="ao.bello@ui.edu.ng", phone="+234 803 000 0001", office="CS Building, Room 204"),
    dict(title="Prof.", name="F. T. Ibrahim", staff_id="UI/CS/0042", department="Computer Science",
         faculty="Science", email="ft.ibrahim@ui.edu.ng", phone="+234 803 000 0002", office="CS Building, Room 101"),
    dict(title="Dr.", name="R. K. Adeyemi", staff_id="UI/MT/0077", department="Mathematics",
         faculty="Science", email="rk.adeyemi@ui.edu.ng", phone=None, office="Maths Block, Room 12"),
]

# (code, title, lecturer index, weekday (0=Mon), start hour, units)
COURSES = [
    ("CSC401", "Algorithms and Complexity Analysis", 0, 0, 9, 3),
    ("CSC407", "Computer Networks", 0, 3, 10, 3),
    ("CSC403", "Software Engineering II", 1, 1, 11, 3),
    ("MAT401", "Numerical Analysis", 2, 4, 8, 2),
]

STUDENTS = [
    ("CSC/2021/001", "Adebayo Oluwaseun", 0.92),
    ("CSC/2021/002", "Chidinma Okafor", 0.70),
    ("CSC/2021/003", "Ibrahim Musa", 0.45),
    ("CSC/2021/004", "Funmilayo Adeleke", 0.85),
    ("CSC/2021/005", "Emeka Nwosu", 0.60),
    ("CSC/2021/006", "Aisha Bello", 0.95),
    ("CSC/2021/007", "Tunde Bakare", 0.78),
    ("CSC/2021/008", "Grace Eze", 0.55),
]
WEEKS = 10
LAGOS = timezone(timedelta(hours=1))


def _utc(local: datetime) -> datetime:
    """Lagos wall-clock time -> naive UTC, as stored in the DB."""
    return local.replace(tzinfo=LAGOS).astimezone(timezone.utc).replace(tzinfo=None)


def seed(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(bind=engine)
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    upgrade_db()
    db = SessionLocal()
    try:
        if db.query(Lecturer).count() or db.query(Student).count():
            print("Database already seeded; use --reset to start over.")
            return

        random.seed(42)
        now = utcnow()
        start_of_term = now - timedelta(weeks=WEEKS + 1)
        lecturers = [Lecturer(**l, password_hash=hash_password(DEMO_PASSWORD), created_at=start_of_term) for l in LECTURERS]
        db.add_all(lecturers)
        db.flush()

        courses = [
            Course(code=code, title=title, lecturer_id=lecturers[li].id, units=units, level="400", semester="First",
                   description=f"{title} for 400-level students.", created_at=start_of_term)
            for code, title, li, _, _, units in COURSES
        ]
        db.add_all(courses)
        db.flush()

        students = [
            Student(matric_no=m, full_name=n, department="Computer Science", level="400",
                    email=f"{n.split()[0].lower()}.{m[-3:]}@stu.ui.edu.ng",
                    password_hash=hash_password(DEMO_PASSWORD), created_at=start_of_term)
            for m, n, _ in STUDENTS
        ]
        db.add_all(students)
        db.flush()

        # Everyone takes the CSC courses from the start of term; the last student joined CSC401
        # four weeks ago (so earlier classes don't count against them). Only half take MAT401.
        joined: dict[tuple[int, int], datetime] = {}
        for i, s in enumerate(students):
            for c in courses:
                if c.code == "MAT401" and i % 2:
                    continue
                at = start_of_term
                if c.code == "CSC401" and i == len(students) - 1:
                    at = now - timedelta(weeks=4, days=1)
                joined[(s.id, c.id)] = at
                db.add(Enrollment(student_id=s.id, course_id=c.id, joined_at=at))

        # One class a week per course over the last WEEKS weeks (up to today), ~100 min long
        today = datetime.now(LAGOS).date()
        monday = today - timedelta(days=today.weekday())
        for (code, _, _, weekday, hour, _), course in zip(COURSES, courses):
            for week in range(-WEEKS + 1, 1):
                if code == "CSC403" and week == -6:
                    continue  # a missed week, for realism
                day = monday + timedelta(weeks=week, days=weekday)
                started = _utc(datetime.combine(day, time(hour, random.choice([0, 2, 5]))))
                if started + timedelta(hours=2) > now:
                    continue  # later this week: not held yet
                session = ClassSession(course_id=course.id, started_at=started,
                                       ended_at=started + timedelta(minutes=random.randint(95, 115)),
                                       venue="LT1" if weekday % 2 == 0 else "Lab 2")
                db.add(session)
                db.flush()
                for s, (_, _, rate) in zip(students, STUDENTS):
                    at = joined.get((s.id, course.id))
                    if at is None or at > started or random.random() >= rate:
                        continue
                    # Most arrive in the first 10 minutes; a few stragglers
                    late = random.choice([1, 2, 3, 4, 5, 6, 8, 10, 14, 22])
                    db.add(Attendance(student_id=s.id, session_id=session.id, method="seed",
                                      marked_at=started + timedelta(minutes=late, seconds=random.randint(0, 59)),
                                      confidence=round(random.uniform(0.74, 0.97), 3)))

        # A few recent "student joined" notifications for the dashboard bell
        late_joiner = students[-1]
        db.add(Notification(lecturer_id=lecturers[0].id, kind="student_joined",
                            message=f"{late_joiner.full_name} ({late_joiner.matric_no}) joined CSC401",
                            course_id=courses[0].id, student_id=late_joiner.id,
                            created_at=now - timedelta(weeks=4, days=1)))
        for i, s in enumerate(students[:3]):
            db.add(Notification(lecturer_id=lecturers[1].id, kind="student_joined",
                                message=f"{s.full_name} ({s.matric_no}) joined CSC403",
                                course_id=courses[2].id, student_id=s.id,
                                created_at=start_of_term + timedelta(hours=i + 1), read_at=start_of_term + timedelta(days=1)))
        db.commit()
        print("Seeded demo data.")
        print(f"Lecturer logins (password '{DEMO_PASSWORD}'): " + ", ".join(l["email"] for l in LECTURERS))
        print(f"Student logins (password '{DEMO_PASSWORD}'): " + ", ".join(m for m, _, _ in STUDENTS))
        print("Enrol students' faces in the app (or with enrol_face_cli.py) before scanning them in class.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="drop all tables first")
    seed(parser.parse_args().reset)
