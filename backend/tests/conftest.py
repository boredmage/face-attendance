import os

# Must be set BEFORE app modules are imported so Settings picks them up
os.environ["DATABASE_URL"] = "sqlite:///./test_attendance.db"
os.environ["FACE_BACKEND"] = "mock"
os.environ["JWT_SECRET"] = "test-secret-that-is-at-least-32-bytes-long"
os.environ["FACE_IMAGE_DIR"] = "./test_face_images"  # keep test uploads out of the real folder

import io  # noqa: E402
import shutil  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _seeded_db():
    seed(reset=True)
    yield
    for f in ("./test_attendance.db",):
        if os.path.exists(f):
            os.remove(f)
    shutil.rmtree("./test_face_images", ignore_errors=True)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login_headers(client, path: str, body: dict) -> dict:
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def lecturer_auth(client):
    """Seeded Dr. Bello, who teaches CSC401 and CSC407."""
    return login_headers(client, "/auth/lecturer/login", {"email": "ao.bello@ui.edu.ng", "password": "password123"})


@pytest.fixture(scope="session")
def student_auth(client):
    return login_headers(client, "/auth/student/login", {"matric_no": "CSC/2021/001", "password": "password123"})


def make_jpeg(color=(120, 90, 70)) -> bytes:
    """Solid-colour JPEG. With FACE_BACKEND=mock, different colours behave like different faces."""
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def jpeg_bytes():
    return make_jpeg()
