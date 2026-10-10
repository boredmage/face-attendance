"""Application settings, loaded from environment variables / .env file."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./attendance.db"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720

    # "deepface" for real recognition, "mock" for UI development without models
    face_backend: str = "deepface"
    face_model: str = "Facenet512"
    # Primary detector, then comma-separated fallbacks tried when it finds no face.
    # Needs opencv-python 4.x: DeepFace's opencv/ssd/yunet backends all misbehave on 5.x.
    face_detector: str = "opencv"
    face_detector_fallback: str = "retinaface"
    # Verification: cosine distance to the closest stored pose must be <= this
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
