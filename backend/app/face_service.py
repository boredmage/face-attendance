"""Face recognition service.

Two backends:
  * deepface  – real recognition. At enrolment the phone sends several photos (frontal first,
                then head turned left/right/up/down, Face-ID style). We compute one embedding
                per photo with DeepFace (Facenet512 by default), check they all belong to the
                same person, and store the list on the student row. At verification we embed
                the new photo and take the smallest cosine distance to any stored embedding,
                which makes recognition tolerant of the head angle at marking time.
  * mock      – for developing the UI without TensorFlow installed. Any valid image
                "matches" as long as the student has been enrolled.

Face *detection* runs through a chain of DeepFace detector backends (FACE_DETECTOR, then
FACE_DETECTOR_FALLBACK). Turned heads defeat the classic OpenCV Haar cascade, so the default
primary detector is YuNet, which handles yaw well and is tiny and fast.
"""
from __future__ import annotations

import io
import logging
import os
import threading
import time
import uuid

import numpy as np
from PIL import Image, ImageOps

from .config import settings

log = logging.getLogger(__name__)

Embedding = list[float]


class FaceError(Exception):
    """Raised when no face is found, the image is unusable, or the poses don't match each other."""


NO_FACE_MESSAGE = "No face detected. Make sure your face is inside the circle and well lit."


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _load_image(image_bytes: bytes) -> np.ndarray:
    """Decode JPEG/PNG bytes into an RGB numpy array, honouring EXIF rotation."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise FaceError("Could not decode image") from exc
    # Keep memory reasonable; DeepFace resizes internally anyway
    img.thumbnail((1024, 1024))
    return np.asarray(img)


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    return float(1.0 - np.dot(a, b))


def as_embeddings(stored: list | None) -> list[np.ndarray]:
    """Normalise what is stored on the student row into a list of vectors.

    Rows enrolled before multi-pose enrolment hold one flat vector; newer rows hold one
    vector per captured pose. Both are accepted.
    """
    if not stored:
        return []
    if isinstance(stored[0], (int, float)):
        return [np.asarray(stored, dtype=np.float32)]
    return [np.asarray(v, dtype=np.float32) for v in stored if v]


def match_distance(new: np.ndarray, templates: list[np.ndarray]) -> float:
    """Smallest cosine distance between a fresh embedding and any stored template."""
    compatible = [t for t in templates if t.shape == new.shape]
    if not compatible:
        raise FaceError("Stored face data is incompatible with the current model; please re-enrol.")
    return min(_cosine_distance(new, t) for t in compatible)


def check_same_person(embeddings: list[Embedding], max_distance: float | None = None) -> float:
    """Ensure every pose embedding is close enough to the first (frontal) one.

    Returns the largest distance found. Raises FaceError if any pose is too far away, which
    means a capture was unusable (face half out of frame) or a different person was in shot.
    """
    limit = settings.face_enrol_max_distance if max_distance is None else max_distance
    vectors = [np.asarray(e, dtype=np.float32) for e in embeddings]
    if len(vectors) < 2:
        return 0.0
    reference = vectors[0]
    worst = 0.0
    for i, vec in enumerate(vectors[1:], start=2):
        distance = _cosine_distance(reference, vec)
        worst = max(worst, distance)
        if distance > limit:
            log.info("enrolment rejected: image %d is %.3f from the frontal image (limit %.2f)", i, distance, limit)
            raise FaceError(
                "The captured photos don't all look like the same person. Enrol on your own, in good light, "
                "and keep your face inside the circle while you turn your head."
            )
    return worst


# ---------------------------------------------------------------------------
# DeepFace access
# ---------------------------------------------------------------------------
def _deepface():
    try:
        from deepface import DeepFace  # heavy import, done lazily
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "DeepFace is not installed. Run `pip install deepface tf-keras` or set FACE_BACKEND=mock"
        ) from exc
    return DeepFace


def detector_chain() -> list[str]:
    """Detector backends to try, in order, without duplicates."""
    names = [settings.face_detector, *settings.face_detector_fallback.split(",")]
    chain: list[str] = []
    for name in (n.strip() for n in names):
        if name and name not in chain:
            chain.append(name)
    return chain


def _represent(arr: np.ndarray, detector: str) -> list[dict]:
    return _deepface().represent(
        img_path=arr,
        model_name=settings.face_model,
        detector_backend=detector,
        enforce_detection=True,
        align=True,
    )


# ---------------------------------------------------------------------------
# Embedding extraction
# ---------------------------------------------------------------------------
def extract_embedding(image_bytes: bytes) -> Embedding:
    """Return a face embedding for the (single, largest) face in the image."""
    if settings.face_backend == "mock":
        # Deterministic pseudo-embedding so the mock backend still exercises the code path
        arr = _load_image(image_bytes)
        small = np.asarray(Image.fromarray(arr).resize((8, 8))).astype(np.float32).flatten()
        return (small / 255.0).tolist()

    arr = _load_image(image_bytes)
    last_error: Exception | None = None
    for detector in detector_chain():
        try:
            results = _represent(arr, detector)
        except ValueError as exc:
            # DeepFace raises ValueError both when no face is found and when a detector backend
            # is broken (missing weights, incompatible OpenCV, ...). Make the latter visible.
            last_error = exc
            if "could not be detected" in str(exc).lower():
                log.info("detector %s: no face found", detector)
            else:
                log.warning("detector %s failed, trying next: %s", detector, str(exc)[:200])
            continue
        if results:
            # If several faces, pick the largest bounding box
            best = max(results, key=lambda r: r["facial_area"]["w"] * r["facial_area"]["h"])
            return [float(x) for x in best["embedding"]]
    raise FaceError(NO_FACE_MESSAGE) from last_error


def enrol_embeddings(images: list[bytes]) -> list[Embedding]:
    """Embeddings for a set of enrolment photos (frontal photo first).

    Every photo must contain a face and all of them must be the same person.
    """
    if not images:
        raise FaceError("No image uploaded")
    embeddings: list[Embedding] = []
    for index, image_bytes in enumerate(images, start=1):
        try:
            embeddings.append(extract_embedding(image_bytes))
        except FaceError as exc:
            if len(images) == 1:
                raise
            raise FaceError(f"{exc} (photo {index} of {len(images)})") from exc
    if settings.face_backend != "mock":
        worst = check_same_person(embeddings)
        log.info("enrolled %d pose(s); largest distance from frontal %.3f", len(embeddings), worst)
    return embeddings


def verify(image_bytes: bytes, stored_embedding: list | None) -> tuple[bool, float]:
    """Compare a fresh photo with the stored embedding(s).

    Returns (is_match, confidence 0..1).
    """
    templates = as_embeddings(stored_embedding)
    if not templates:
        raise FaceError("You have not enrolled your face yet. Enrol from the profile screen first.")

    new_embedding = np.asarray(extract_embedding(image_bytes), dtype=np.float32)

    if settings.face_backend == "mock":
        return True, 0.99

    distance = match_distance(new_embedding, templates)
    confidence = max(0.0, min(1.0, 1.0 - distance))
    is_match = distance <= settings.face_distance_threshold
    log.info("face verify distance=%.4f threshold=%.2f templates=%d match=%s",
             distance, settings.face_distance_threshold, len(templates), is_match)
    return is_match, confidence


def find_duplicate(embeddings: list[Embedding], others: list[tuple[int, list | None]]) -> int | None:
    """Id of another account whose enrolled face matches these new enrolment embeddings, if any.

    Stops one person enrolling on two accounts (and then being marked present for both).
    """
    if settings.face_backend == "mock" or not embeddings:
        return None
    frontal = np.asarray(embeddings[0], dtype=np.float32)
    for other_id, stored in others:
        templates = [t for t in as_embeddings(stored) if t.shape == frontal.shape]
        if templates and min(_cosine_distance(frontal, t) for t in templates) <= settings.face_distance_threshold:
            return other_id
    return None


def identify(image_bytes: bytes, candidates: list[tuple[int, list | None]]) -> tuple[int | None, float, float | None]:
    """1:N search: which candidate (if any) is the person in the photo?

    `candidates` is (id, stored embeddings) for every student enrolled in the class. Returns
    (matched id or None, confidence 0..1 of the best candidate, best distance or None).
    A match needs the best distance under the threshold AND a clear margin over the runner-up,
    so two similar-looking students are never confused silently.
    """
    new_embedding = np.asarray(extract_embedding(image_bytes), dtype=np.float32)

    scored: list[tuple[float, int]] = []
    for candidate_id, stored in candidates:
        templates = [t for t in as_embeddings(stored) if t.shape == new_embedding.shape]
        if templates:
            scored.append((min(_cosine_distance(new_embedding, t) for t in templates), candidate_id))
    if not scored:
        return None, 0.0, None
    scored.sort()
    best_distance, best_id = scored[0]
    confidence = max(0.0, min(1.0, 1.0 - best_distance))

    if settings.face_backend == "mock":
        # Mock embeddings are image thumbnails: the nearest one is "the match"
        return best_id, confidence, best_distance

    runner_up = scored[1][0] if len(scored) > 1 else None
    clear_margin = runner_up is None or runner_up - best_distance >= settings.face_identify_margin
    is_match = best_distance <= settings.face_distance_threshold and clear_margin
    log.info("face identify best=%.4f runner_up=%s threshold=%.2f candidates=%d match=%s",
             best_distance, f"{runner_up:.4f}" if runner_up is not None else "-",
             settings.face_distance_threshold, len(scored), is_match)
    return (best_id if is_match else None), confidence, best_distance


def save_face_image(image_bytes: bytes, matric_no: str) -> str:
    """Persist the (frontal) enrolment photo to disk and return its path."""
    os.makedirs(settings.face_image_dir, exist_ok=True)
    safe = "".join(c for c in matric_no if c.isalnum() or c in "-_")
    path = os.path.join(settings.face_image_dir, f"{safe}_{uuid.uuid4().hex[:8]}.jpg")
    Image.fromarray(_load_image(image_bytes)).save(path, "JPEG", quality=90)
    return path


# ---------------------------------------------------------------------------
# Start-up warm-up
# ---------------------------------------------------------------------------
def warm_up() -> None:
    """Load the recognition model and detector weights in a background thread.

    The first DeepFace call otherwise happens inside the first enrolment request and can take
    well over 30 s (weights download + model build), which is longer than the phone waits.
    """
    if settings.face_backend != "deepface" or not settings.face_warm_up:
        return

    def run() -> None:
        started = time.time()
        try:
            deepface = _deepface()
            deepface.build_model(settings.face_model)
            blank = np.full((160, 160, 3), 128, dtype=np.uint8)
            for detector in detector_chain():
                try:
                    deepface.extract_faces(img_path=blank, detector_backend=detector, enforce_detection=False)
                except ValueError as exc:
                    log.warning("detector %s is not usable: %s", detector, str(exc)[:200])
            log.info("face recognition ready (%s + %s) in %.1fs",
                     settings.face_model, "/".join(detector_chain()), time.time() - started)
        except Exception:  # noqa: BLE001
            log.exception("face model warm-up failed; the first request will retry")

    threading.Thread(target=run, name="face-warm-up", daemon=True).start()
