"""FastAPI entry point.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
Docs at:   http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from . import face_service
from .config import settings
from .migrate import upgrade_db
from .routers import auth, lecturer, student, sync

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    upgrade_db()
    # Legacy server-side recognition: load DeepFace now so the first request isn't a 30 s+ wait
    if settings.face_legacy:
        face_service.warm_up()
    yield


app = FastAPI(
    title="Face Recognition Attendance API",
    description="Backend for the face-recognition attendance system: student app, lecturer app mode and lecturer dashboard.",
    version="2.0.0",
    lifespan=lifespan,
)

# Sync pulls carry every student's face embeddings; they compress well
app.add_middleware(GZipMiddleware, minimum_size=2048)
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
app.include_router(sync.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
