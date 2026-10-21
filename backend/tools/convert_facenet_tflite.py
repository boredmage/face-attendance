"""Convert DeepFace's Facenet512 weights to a TFLite model for the phones.

    python -m tools.convert_facenet_tflite [--out ../mobile/assets/models/facenet512.tflite]

The phones (student enrolment and lecturer attendance) both run this file, so every embedding
in the system comes from the same model. Input: 1x160x160x3 float32, BGR, pixels scaled to 0..1
(DeepFace's "base" normalisation). Output: 1x512 float32 (not normalised).

After converting, the script checks the TFLite output against the Keras model on random inputs
and, if present, on the enrolment photos in FACE_IMAGE_DIR.
"""
from __future__ import annotations

import argparse
import glob
import os

import numpy as np


def build_keras_model():
    from deepface import DeepFace
    return DeepFace.build_model("Facenet512").model


def convert(model, fp16: bool) -> bytes:
    import tensorflow as tf
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    if fp16:
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]
    return converter.convert()


def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(1 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="../mobile/assets/models/facenet512.tflite")
    parser.add_argument("--fp32", action="store_true", help="keep float32 weights (twice the size)")
    args = parser.parse_args()

    from app.face_tflite import TFLiteEmbedder, preprocess_crop

    model = build_keras_model()
    data = convert(model, fp16=not args.fp32)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as fh:
        fh.write(data)
    print(f"wrote {args.out} ({len(data) / 1e6:.1f} MB)")

    embedder = TFLiteEmbedder(args.out)
    rng = np.random.default_rng(0)
    worst = 0.0
    inputs = [rng.random((160, 160, 3), dtype=np.float32) for _ in range(8)]
    from app.config import settings
    from app.face_tflite import detect_largest_face
    from PIL import Image
    for path in sorted(glob.glob(os.path.join(settings.face_image_dir, "*.jpg")))[:20]:
        rgb = np.asarray(Image.open(path).convert("RGB"))
        box = detect_largest_face(rgb)
        if box is not None:
            inputs.append(preprocess_crop(rgb, box))
    for x in inputs:
        keras_vec = model(x[None], training=False).numpy()[0]
        lite_vec = embedder.embed_tensor(x)
        worst = max(worst, cosine_distance(keras_vec, lite_vec))
    print(f"checked {len(inputs)} inputs: largest Keras-vs-TFLite cosine distance {worst:.5f}")
    if worst > 0.01:
        raise SystemExit("TFLite output differs too much from Keras; try --fp32")


if __name__ == "__main__":
    main()
