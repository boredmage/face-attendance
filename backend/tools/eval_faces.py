"""Pick the match threshold for the on-device model (Phase 0 of docs/offline-first-plan.md).

    python -m tools.eval_faces PHOTO_DIR [--model ../mobile/assets/models/facenet512.tflite]

PHOTO_DIR holds one folder per person, ideally photos taken with the S23 in lecture-hall light:

    PHOTO_DIR/
      ayo/enrol_frontal.jpg  enrol_left.jpg ... attend_1.jpg attend_2.jpg ...
      bola/...

Files whose name starts with "enrol" become that person's templates (like enrolment poses);
every other photo is an attendance shot. Each attendance shot is matched against everyone's
templates with the same threshold + margin rule as the app, and the script prints genuine and
impostor distance distributions, false accept / reject rates per threshold, and a suggestion.
"""
from __future__ import annotations

import argparse
import os

import numpy as np
from PIL import Image, ImageOps

from app.face_tflite import TFLiteEmbedder, detect_largest_face, preprocess_crop

IMAGE_EXTS = (".jpg", ".jpeg", ".png")


def load_rgb(path: str) -> np.ndarray:
    return np.asarray(ImageOps.exif_transpose(Image.open(path)).convert("RGB"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("photo_dir")
    parser.add_argument("--model", default="../mobile/assets/models/facenet512.tflite")
    parser.add_argument("--margin", type=float, default=0.05)
    args = parser.parse_args()

    embedder = TFLiteEmbedder(args.model)
    templates: dict[str, list[np.ndarray]] = {}
    probes: list[tuple[str, str, np.ndarray]] = []
    for person in sorted(os.listdir(args.photo_dir)):
        folder = os.path.join(args.photo_dir, person)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.lower().endswith(IMAGE_EXTS):
                continue
            rgb = load_rgb(os.path.join(folder, name))
            box = detect_largest_face(rgb)
            if box is None:
                print(f"  no face: {person}/{name}")
                continue
            vec = embedder.embed_tensor(preprocess_crop(rgb, box))
            if name.lower().startswith("enrol"):
                templates.setdefault(person, []).append(vec)
            else:
                probes.append((person, name, vec))

    if len(templates) < 2 or not probes:
        raise SystemExit("Need at least two people with enrol* photos and some attendance photos")

    genuine, impostor, results = [], [], []
    for person, name, vec in probes:
        per_person = sorted((min(1 - float(np.dot(vec, t)) for t in ts), p) for p, ts in templates.items())
        for d, p in per_person:
            (genuine if p == person else impostor).append(d)
        results.append((person, per_person))

    g, i = np.array(genuine), np.array(impostor)
    print(f"\n{len(templates)} people, {len(probes)} attendance photos")
    print(f"genuine  distance: min {g.min():.3f}  median {np.median(g):.3f}  max {g.max():.3f}")
    print(f"impostor distance: min {i.min():.3f}  median {np.median(i):.3f}  max {i.max():.3f}")
    print(f"\n{'threshold':>9}  {'false accept':>12}  {'false reject':>12}   (margin {args.margin})")
    best = None
    for threshold in np.arange(0.20, 0.61, 0.025):
        fa = fr = 0
        for person, ranked in results:
            (d1, p1), runner = ranked[0], (ranked[1][0] if len(ranked) > 1 else None)
            accepted = d1 <= threshold and (runner is None or runner - d1 >= args.margin)
            if accepted and p1 != person:
                fa += 1
            elif not accepted or p1 != person:
                fr += 1
        n = len(results)
        print(f"{threshold:9.3f}  {fa / n:12.1%}  {fr / n:12.1%}")
        if fa == 0:
            best = threshold
    if best is not None:
        print(f"\nSuggested FACE_DISTANCE_THRESHOLD: {best:.3f} (largest with no false accepts)")


if __name__ == "__main__":
    main()
