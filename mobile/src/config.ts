/**
 * App-wide configuration.
 *
 * Set API_BASE_URL to the machine running the FastAPI server.
 * On a real phone this must be your computer's LAN IP (e.g. http://172.20.10.4:8000),
 * NOT localhost. Both devices must be on the same Wi-Fi.
 */
export const API_BASE_URL = 'http://172.20.10.4:8000';

/**
 * Below this a course shows red instead of amber. The exam threshold itself (75%) comes from the
 * server per course (`required_pct`), so the app and backend can never disagree.
 */
export const ATTENDANCE_WARN = 50;

/** Shown to lecturers in the app: everything except taking attendance lives on the dashboard. */
export const DASHBOARD_URL = 'http://172.20.10.4:3000';

/** JPEG compression applied before uploading a photo. */
export const CAPTURE_MAX_WIDTH = 720;
export const CAPTURE_JPEG_QUALITY = 0.7;
