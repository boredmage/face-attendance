# FastAPI backend. Faces are embedded on the phones, so the default image is slim (no TensorFlow).
# Build with --build-arg WITH_DEEPFACE=true to also serve old app versions that upload photos only
# (FACE_LEGACY=true); that adds ~1 GB and a 200 MB weight download on first start.
FROM python:3.13-slim

ARG WITH_DEEPFACE=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN if [ "$WITH_DEEPFACE" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/* \
      && pip install -r requirements.txt; \
    else \
      grep -viE '^(deepface|tf-keras|opencv-python|pytest|httpx)' requirements.txt > /tmp/req.txt \
      && pip install -r /tmp/req.txt; \
    fi

COPY alembic.ini enrol_face_cli.py ./
COPY app ./app
COPY migrations ./migrations
COPY tools ./tools

# Database and enrolment photos live here (mounted as a volume by docker-compose)
RUN mkdir -p /data/face_images
ENV DATABASE_URL=sqlite:////data/attendance.db \
    FACE_IMAGE_DIR=/data/face_images

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
