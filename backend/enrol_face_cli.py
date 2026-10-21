"""Enrol a student's face from photo files, without using the phone app.

    python enrol_face_cli.py CSC/2021/001 frontal.jpg [left.jpg right.jpg up.jpg down.jpg]

Give the frontal photo first. Extra photos with the head turned make recognition more
tolerant of the angle at marking time; all photos must be the same person.

Faces are embedded with the same TFLite model and crop rules the phones use (app/face_tflite.py,
with YuNet standing in for ML Kit), so the lecturer's phone can recognise the student after its
next sync. Needs the model file: run `python -m tools.convert_facenet_tflite` once.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageOps

from app.config import settings
from app.database import SessionLocal
from app.face_service import FaceError, check_same_person, save_face_image
from app.face_tflite import MODEL_VERSION, TFLiteEmbedder, detect_largest_face, preprocess_crop
from app.migrate import upgrade_db
from app.models import Student, utcnow

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "mobile", "assets", "models", "facenet512.tflite")


def main(matric_no: str, image_paths: list[str]) -> None:
    if MODEL_VERSION != settings.face_model_version:
        sys.exit(f"app/face_tflite.py is {MODEL_VERSION} but FACE_MODEL_VERSION is {settings.face_model_version}")
    embedder = TFLiteEmbedder(MODEL_PATH)
    payloads, embeddings = [], []
    for path in image_paths:
        with open(path, "rb") as f:
            payloads.append(f.read())
        rgb = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert("RGB"))
        box = detect_largest_face(rgb)
        if box is None:
            sys.exit(f"No face found in {path}")
        embeddings.append(embedder.embed_tensor(preprocess_crop(rgb, box)).tolist())
    try:
        check_same_person(embeddings)
    except FaceError as exc:
        sys.exit(f"Enrolment failed: {exc}")

    upgrade_db()
    db = SessionLocal()
    try:
        student = db.query(Student).filter(Student.matric_no == matric_no.upper()).first()
        if student is None:
            sys.exit(f"No student with matric number {matric_no}")
        paths = [save_face_image(p, student.matric_no) for p in payloads]
        student.face_embedding = embeddings
        student.embedding_model = MODEL_VERSION
        student.face_image_path = paths[0]
        student.face_image_paths = paths
        student.face_enrolled_at = utcnow()
        db.commit()
        print(f"Enrolled {student.full_name} ({student.matric_no}); {len(embeddings)} photo(s) with {MODEL_VERSION}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
