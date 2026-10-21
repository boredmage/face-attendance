"""Application settings, loaded from environment variables / .env file."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./attendance.db"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720

    # Lecturer devices: refresh tokens let an offline phone sync again weeks later
    refresh_token_days: int = 90
    # After a lecturer signs in on another phone, the old one may still push its queue this long
    sync_revoked_grace_days: int = 7
    # Days without a successful sync before the device warns, warns strongly, then blocks new classes
    sync_warn_days: int = 7
    sync_strong_warn_days: int = 14
    sync_block_days: int = 30
    # Pushed device timestamps are corrected when the phone's clock is off by more than this
    sync_clock_tolerance_seconds: int = 120

    # On-device face model (mobile/src/face/config.ts). Embeddings made by any other model are
    # ignored for matching and the student is asked to re-enrol.
    face_model_version: str = "fn512-tflite-v1"
    # Accept the old enrolment upload (photos only, embedded here with DeepFace) and /scan.
    # Turn off once every student has re-enrolled with the current app.
    face_legacy: bool = True

    # Legacy server-side recognition: "deepface" for real recognition, "mock" for UI development
    face_backend: str = "deepface"
    face_model: str = "Facenet512"
    # Primary detector, then comma-separated fallbacks tried when it finds no face.
    # Needs opencv-python 4.x: DeepFace's opencv/ssd/yunet backends all misbehave on 5.x.
    face_detector: str = "opencv"
    face_detector_fallback: str = "retinaface"
    # Matching (sent to the devices too): cosine distance to the closest stored pose must be <= this
    face_distance_threshold: float = 0.30
    # Enrolment: every pose photo must be within this distance of the frontal photo
    face_enrol_max_distance: float = 0.55
    # Identification (lecturer scanning a class): the best match must beat the runner-up by this much
    face_identify_margin: float = 0.05
    # Load model + detector weights at start-up instead of inside the first request
    face_warm_up: bool = True
    face_image_dir: str = "./face_images"

    # Classes still running this many hours after they started are ended automatically
    session_auto_end_hours: int = 4
    # Used for weekday statistics and times in CSV exports
    display_timezone: str = "Africa/Lagos"

    # Comma-separated origins allowed to call the API from a browser (the dashboard)
    cors_origins: str = "http://localhost:3000"


settings = Settings()
