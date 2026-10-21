/**
 * On-device face recognition settings. Keep in sync with backend/app/face_tflite.py (the Python
 * mirror used for evaluation) and FACE_MODEL_VERSION in backend/app/config.py.
 *
 * The model file assets/models/facenet512.tflite is generated, not committed:
 *   cd backend && python -m tools.convert_facenet_tflite
 */
export const MODEL_VERSION = 'fn512-tflite-v1';
export const EMBEDDING_SIZE = 512;
/** Model input: 160x160 BGR, pixels scaled to 0..1 (DeepFace's Facenet512 preprocessing). */
export const INPUT_SIZE = 160;
/** Square crop side = max(face width, face height) * CROP_SCALE. */
export const CROP_SCALE = 1.0;

/** Used until the first sync delivers the server's values (which win, so they can be tuned centrally). */
export const DEFAULT_MATCHING = { threshold: 0.3, margin: 0.05 };
