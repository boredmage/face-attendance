"""FastAPI entry point.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
Docs at:   http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import face_service
from .database import Base, engine
from .config import settings
from .routers import auth, lecturer, student

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # For a final-year project this is simpler than Alembic migrations.
    Base.metadata.create_all(bind=engine)
    # Load DeepFace + detector weights now so the first enrolment isn't a 30 s+ request
    face_service.warm_up()
    yield


app = FastAPI(
    title="Face Recognition Attendance API",
    description="Backend for the face-recognition attendance system: student app, lecturer app mode and lecturer dashboard.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    # The phone app is not a browser, so CORS only concerns the lecturer dashboard
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(student.router)
app.include_router(lecturer.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
