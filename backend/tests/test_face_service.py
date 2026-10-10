"""Unit tests for the pure parts of face_service (no TensorFlow needed)."""
import numpy as np
import pytest

from app import face_service
from app.face_service import FaceError, as_embeddings, check_same_person, detector_chain, match_distance


def _unit(*xs):
    v = np.asarray(xs, dtype=np.float32)
    return v / np.linalg.norm(v)


def test_as_embeddings_accepts_legacy_flat_vector_and_pose_list():
    assert as_embeddings(None) == []
    assert as_embeddings([]) == []
    legacy = as_embeddings([0.1, 0.2, 0.3])
    assert len(legacy) == 1 and legacy[0].shape == (3,)
    poses = as_embeddings([[0.1, 0.2, 0.3], [0.3, 0.2, 0.1]])
    assert len(poses) == 2 and all(p.shape == (3,) for p in poses)


def test_match_distance_uses_closest_pose():
    templates = [_unit(1, 0, 0), _unit(0, 1, 0)]
    # Identical to the second template -> distance ~0 even though the first is far away
    assert match_distance(_unit(0, 1, 0), templates) == pytest.approx(0.0, abs=1e-6)
    # Orthogonal to both -> distance 1
    assert match_distance(_unit(0, 0, 1), templates) == pytest.approx(1.0, abs=1e-6)


def test_match_distance_rejects_incompatible_shapes():
    with pytest.raises(FaceError):
        match_distance(_unit(1, 0), [_unit(1, 0, 0)])


def test_check_same_person_accepts_close_poses_and_rejects_strangers():
    frontal = _unit(1, 0.1, 0)
    turned = _unit(1, 0.4, 0.1)  # close to frontal
    stranger = _unit(0, 0, 1)
    assert check_same_person([frontal.tolist(), turned.tolist()], max_distance=0.55) < 0.55
    with pytest.raises(FaceError):
        check_same_person([frontal.tolist(), turned.tolist(), stranger.tolist()], max_distance=0.55)
    assert check_same_person([frontal.tolist()]) == 0.0


def test_detector_chain_dedupes_and_respects_settings(monkeypatch):
    monkeypatch.setattr(face_service.settings, "face_detector", "yunet")
    monkeypatch.setattr(face_service.settings, "face_detector_fallback", "opencv, yunet,,ssd")
    assert detector_chain() == ["yunet", "opencv", "ssd"]


@pytest.fixture
def real_backend(monkeypatch):
    """Exercise the DeepFace code paths with a fake embedding extractor."""
    monkeypatch.setattr(face_service.settings, "face_backend", "deepface")
    monkeypatch.setattr(face_service.settings, "face_distance_threshold", 0.30)
    monkeypatch.setattr(face_service.settings, "face_identify_margin", 0.05)

    def use(vector):
        monkeypatch.setattr(face_service, "extract_embedding", lambda _bytes: vector.tolist())
    return use


def test_identify_picks_closest_student(real_backend):
    real_backend(_unit(1, 0.05, 0))
    candidates = [(1, [_unit(0, 1, 0).tolist()]), (2, [_unit(1, 0, 0).tolist(), _unit(0, 0, 1).tolist()])]
    matched, confidence, distance = face_service.identify(b"img", candidates)
    assert matched == 2
    assert distance < 0.01 and confidence > 0.99


def test_identify_rejects_stranger(real_backend):
    real_backend(_unit(0, 0, 1))
    matched, _, distance = face_service.identify(b"img", [(1, [_unit(1, 0, 0).tolist()])])
    assert matched is None and distance == pytest.approx(1.0, abs=1e-6)


def test_identify_refuses_ambiguous_lookalikes(real_backend):
    # Both students are within the threshold and almost equally close: don't guess
    real_backend(_unit(1, 0, 0))
    candidates = [(1, [_unit(1, 0.10, 0).tolist()]), (2, [_unit(1, 0.12, 0).tolist()])]
    matched, _, _ = face_service.identify(b"img", candidates)
    assert matched is None


def test_identify_skips_incompatible_and_empty_candidates(real_backend):
    real_backend(_unit(1, 0, 0))
    matched, _, _ = face_service.identify(b"img", [(1, None), (2, [[0.1, 0.2]]), (3, [_unit(1, 0, 0).tolist()])])
    assert matched == 3
    assert face_service.identify(b"img", [(1, None)]) == (None, 0.0, None)


def test_find_duplicate_detects_face_on_another_account(real_backend):
    mine = [_unit(1, 0, 0).tolist(), _unit(1, 0.3, 0).tolist()]
    assert face_service.find_duplicate(mine, [(7, [_unit(1, 0.02, 0).tolist()])]) == 7
    assert face_service.find_duplicate(mine, [(7, [_unit(0, 1, 0).tolist()]), (8, None)]) is None
