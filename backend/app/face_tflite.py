"""Python mirror of the phones' face pipeline (mobile/src/face/), for tools and evaluation.

The server never embeds faces at runtime any more: the phones do. This module exists so the
model can be converted, checked and evaluated on a computer with exactly the same crop and
preprocessing rules the app uses:

  1. Take the face box from the detector (ML Kit on the phone, YuNet here).
  2. Square crop: side = max(w, h) * CROP_SCALE, centred on the box, shifted (not padded) to stay
     inside the image and shrunk if the image is smaller than that.
  3. Resize to 160x160, convert RGB -> BGR, scale pixels to 0..1.
  4. Run the TFLite model and L2-normalise the 512-d output.

Keep CROP_SCALE / INPUT_SIZE / MODEL_VERSION in sync with mobile/src/face/config.ts.
"""
from __future__ import annotations

import glob
import os

import numpy as np
from PIL import Image

MODEL_VERSION = "fn512-tflite-v1"
EMBEDDING_SIZE = 512
INPUT_SIZE = 160
CROP_SCALE = 1.0

Box = tuple[float, float, float, float]  # x, y, w, h in pixels


def square_crop(image_w: int, image_h: int, box: Box) -> tuple[int, int, int]:
    """(x0, y0, side) of the square crop for a face box, kept inside the image."""
    x, y, w, h = box
    side = int(round(max(w, h) * CROP_SCALE))
    side = max(1, min(side, image_w, image_h))
    cx, cy = x + w / 2, y + h / 2
    x0 = int(round(min(max(cx - side / 2, 0), image_w - side)))
    y0 = int(round(min(max(cy - side / 2, 0), image_h - side)))
    return x0, y0, side


def preprocess_crop(rgb: np.ndarray, box: Box) -> np.ndarray:
    """160x160x3 float32 BGR tensor in 0..1 for the face at `box` in an RGB image."""
    h, w = rgb.shape[:2]
    x0, y0, side = square_crop(w, h, box)
    crop = Image.fromarray(rgb[y0:y0 + side, x0:x0 + side]).resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
    arr = np.asarray(crop, dtype=np.float32) / 255.0
    return arr[:, :, ::-1].copy()


def l2_normalise(vec: np.ndarray) -> np.ndarray:
    return vec / (np.linalg.norm(vec) + 1e-9)


class TFLiteEmbedder:
    def __init__(self, model_path: str):
        try:
            from ai_edge_litert.interpreter import Interpreter
        except ImportError:
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter  # noqa: N806
        self._interp = Interpreter(model_path=model_path)
        self._interp.allocate_tensors()
        self._in = self._interp.get_input_details()[0]["index"]
        self._out = self._interp.get_output_details()[0]["index"]

    def embed_tensor(self, tensor: np.ndarray) -> np.ndarray:
        self._interp.set_tensor(self._in, tensor[None].astype(np.float32))
        self._interp.invoke()
        return l2_normalise(self._interp.get_tensor(self._out)[0].astype(np.float32))


_yunet = None


def detect_largest_face(rgb: np.ndarray) -> Box | None:
    """Largest face box via OpenCV YuNet (stands in for ML Kit when evaluating on a computer)."""
    global _yunet
    import cv2
    if _yunet is None:
        weights = glob.glob(os.path.expanduser("~/.deepface/weights/face_detection_yunet*.onnx"))
        if not weights:
            raise RuntimeError("YuNet weights not found in ~/.deepface/weights")
        _yunet = cv2.FaceDetectorYN.create(weights[0], "", (320, 320), 0.8)
    h, w = rgb.shape[:2]
    _yunet.setInputSize((w, h))
    _, faces = _yunet.detect(rgb[:, :, ::-1].copy())
    if faces is None or len(faces) == 0:
        return None
    best = max(faces, key=lambda f: f[2] * f[3])
    return float(best[0]), float(best[1]), float(best[2]), float(best[3])
