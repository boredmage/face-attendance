"""Enrol a student's face from photo files, without using the phone app.

    python enrol_face_cli.py CSC/2021/001 frontal.jpg [left.jpg right.jpg up.jpg down.jpg]

Give the frontal photo first. Extra photos with the head turned make recognition more
tolerant of the angle at marking time; all photos must be the same person.

Useful for demos: enrol the seeded demo students with a clear frontal photo, then start a
class from the lecturer's phone and scan them.
"""
import sys

from app.database import SessionLocal
from app.face_service import FaceError, enrol_embeddings, save_face_image
from app.models import Student, utcnow


def main(matric_no: str, image_paths: list[str]) -> None:
    payloads = []
    for path in image_paths:
        with open(path, "rb") as f:
            payloads.append(f.read())
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.matric_no == matric_no.upper()).first()
        if student is None:
            sys.exit(f"No student with matric number {matric_no}")
        try:
            student.face_embedding = enrol_embeddings(payloads)
        except FaceError as exc:
            sys.exit(f"Enrolment failed: {exc}")
        student.face_image_path = save_face_image(payloads[0], student.matric_no)
        student.face_enrolled_at = utcnow()
        db.commit()
        print(f"Enrolled {student.full_name} ({student.matric_no}); "
              f"{len(student.face_embedding)} photo(s), embedding length {len(student.face_embedding[0])}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
