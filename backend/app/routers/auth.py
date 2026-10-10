"""Registration and login for students (mobile app) and lecturers (dashboard + attendance mode)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Lecturer, Student
from ..schemas import (LecturerLogin, LecturerMe, LecturerRegister, LecturerToken, LecturerUpdate,
                       StudentLogin, StudentOut, StudentRegister, StudentToken)
from ..security import (create_access_token, get_current_lecturer, get_current_student, hash_password,
                        verify_password)

router = APIRouter(prefix="/auth", tags=["auth"])


def student_out(s: Student) -> StudentOut:
    return StudentOut(
        id=s.id,
        matric_no=s.matric_no,
        full_name=s.full_name,
        email=s.email,
        department=s.department,
        level=s.level,
        face_enrolled=bool(s.face_embedding),
    )


def lecturer_out(l: Lecturer) -> LecturerMe:
    return LecturerMe(
        id=l.id,
        title=l.title,
        name=l.name,
        display_name=l.display_name,
        staff_id=l.staff_id,
        email=l.email,
        department=l.department,
        faculty=l.faculty,
        phone=l.phone,
        office=l.office,
    )


def _clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


# ---------- Students ----------
@router.post("/student/register", response_model=StudentToken, status_code=status.HTTP_201_CREATED)
def register_student(body: StudentRegister, db: Session = Depends(get_db)):
    """Create a student account. The app sends the student straight to face enrolment afterwards."""
    matric = body.matric_no.strip().upper()
    email = _clean(str(body.email) if body.email else None)
    if db.query(Student).filter(Student.matric_no == matric).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this matric number already exists")
    if email and db.query(Student).filter(Student.email == email.lower()).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    student = Student(
        matric_no=matric,
        full_name=body.full_name.strip(),
        email=email.lower() if email else None,
        department=body.department.strip(),
        level=body.level.strip() or "100",
        password_hash=hash_password(body.password),
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return StudentToken(access_token=create_access_token(student.id, "student"), student=student_out(student))


@router.post("/student/login", response_model=StudentToken)
def login_student(body: StudentLogin, db: Session = Depends(get_db)):
    matric = body.matric_no.strip().upper()
    student = db.query(Student).filter(Student.matric_no == matric).first()
    if student is None or not verify_password(body.password, student.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid matric number or password")
    return StudentToken(access_token=create_access_token(student.id, "student"), student=student_out(student))


@router.get("/student/me", response_model=StudentOut)
def student_me(student: Student = Depends(get_current_student)):
    return student_out(student)


# ---------- Lecturers ----------
@router.post("/lecturer/register", response_model=LecturerToken, status_code=status.HTTP_201_CREATED)
def register_lecturer(body: LecturerRegister, db: Session = Depends(get_db)):
    email = str(body.email).strip().lower()
    staff_id = _clean(body.staff_id)
    staff_id = staff_id.upper() if staff_id else None
    if db.query(Lecturer).filter(Lecturer.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "A lecturer with this email already exists")
    if staff_id and db.query(Lecturer).filter(Lecturer.staff_id == staff_id).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "A lecturer with this staff ID already exists")
    lecturer = Lecturer(
        title=_clean(body.title),
        name=body.name.strip(),
        staff_id=staff_id,
        email=email,
        department=body.department.strip(),
        faculty=_clean(body.faculty),
        phone=_clean(body.phone),
        office=_clean(body.office),
        password_hash=hash_password(body.password),
    )
    db.add(lecturer)
    db.commit()
    db.refresh(lecturer)
    return LecturerToken(access_token=create_access_token(lecturer.id, "lecturer"), lecturer=lecturer_out(lecturer))


@router.post("/lecturer/login", response_model=LecturerToken)
def login_lecturer(body: LecturerLogin, db: Session = Depends(get_db)):
    lecturer = db.query(Lecturer).filter(Lecturer.email == str(body.email).strip().lower()).first()
    if lecturer is None or not verify_password(body.password, lecturer.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return LecturerToken(access_token=create_access_token(lecturer.id, "lecturer"), lecturer=lecturer_out(lecturer))


@router.get("/lecturer/me", response_model=LecturerMe)
def lecturer_me(lecturer: Lecturer = Depends(get_current_lecturer)):
    return lecturer_out(lecturer)


@router.patch("/lecturer/me", response_model=LecturerMe)
def update_lecturer_me(body: LecturerUpdate, lecturer: Lecturer = Depends(get_current_lecturer),
                       db: Session = Depends(get_db)):
    for field, value in body.model_dump(exclude_unset=True).items():
        if field in ("name", "department"):
            if value is None or not value.strip():
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} cannot be empty")
            setattr(lecturer, field, value.strip())
        else:
            setattr(lecturer, field, _clean(value))
    db.commit()
    return lecturer_out(lecturer)
