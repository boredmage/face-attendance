/**
 * Typed client for the FastAPI backend. Types mirror backend/app/schemas.py.
 *
 * The JWT lives in localStorage; every request sends it as a bearer token. A 401 from the API
 * clears it and notifies listeners (the AuthProvider), which sends the user back to /login.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "fa_lecturer_token";

// ---------- Types ----------
export interface LecturerMe {
  id: number;
  title: string | null;
  name: string;
  display_name: string;
  staff_id: string | null;
  email: string;
  department: string;
  faculty: string | null;
  phone: string | null;
  office: string | null;
}

export interface LecturerToken {
  access_token: string;
  token_type: string;
  role: "lecturer";
  lecturer: LecturerMe;
}

export interface LecturerRegister {
  title?: string | null;
  name: string;
  staff_id?: string | null;
  email: string;
  department: string;
  faculty?: string | null;
  phone?: string | null;
  office?: string | null;
  password: string;
}

export type LecturerUpdate = Partial<Pick<LecturerMe, "title" | "name" | "department" | "faculty" | "phone" | "office">>;

export interface LecturerCourse {
  id: number;
  code: string;
  title: string;
  description: string | null;
  units: number | null;
  level: string | null;
  semester: string | null;
  is_active: boolean;
  created_at: string;
  students: number;
  faces_enrolled: number;
  sessions: number;
  avg_attendance_pct: number;
  at_risk: number;
  live_session_id: number | null;
  last_session_at: string | null;
}

export interface CourseCreate {
  code: string;
  title: string;
  description?: string | null;
  units?: number | null;
  level?: string | null;
  semester?: string | null;
}

export type CourseUpdate = Partial<Omit<CourseCreate, "code">> & { is_active?: boolean };

export interface CourseStudentRow {
  student_id: number;
  matric_no: string;
  full_name: string;
  department: string;
  level: string;
  face_enrolled: boolean;
  joined_at: string;
  classes_held: number;
  classes_attended: number;
  attendance_pct: number;
  at_risk: boolean;
}

export interface SessionSummary {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  venue: string | null;
  topic: string | null;
  is_live: boolean;
  present: number;
  expected: number;
  attendance_pct: number;
  /** Recorded on the lecturer's phone and uploaded later; null = created through the online API */
  synced_at: string | null;
  /** The phone's clock was wrong by this many seconds and its times were corrected */
  clock_offset_seconds: number | null;
}

/** A lecturer's attendance phone (one is active at a time). */
export interface DeviceOut {
  id: string;
  label: string | null;
  app_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  active: boolean;
  revoked_at: string | null;
}

export interface TrendPoint {
  session_id: number;
  label: string;
  started_at: string;
  course_code: string;
  present: number;
  expected: number;
  attendance_pct: number;
}

export interface LecturerCourseDetail {
  course: LecturerCourse;
  students: CourseStudentRow[];
  sessions: SessionSummary[];
  trend: TrendPoint[];
}

export interface PresentRow {
  student_id: number;
  matric_no: string;
  full_name: string;
  marked_at: string;
  minutes_after_start: number;
  method: string;
  confidence: number | null;
}

export interface AbsentRow {
  student_id: number;
  matric_no: string;
  full_name: string;
  face_enrolled: boolean;
}

export interface SessionDetail {
  session: SessionSummary;
  present: PresentRow[];
  absent: AbsentRow[];
}

export interface CourseBreakdown {
  course_id: number;
  code: string;
  title: string;
  students: number;
  sessions: number;
  avg_attendance_pct: number;
}

export interface AtRiskStudent {
  student_id: number;
  matric_no: string;
  full_name: string;
  course_id: number;
  course_code: string;
  classes_held: number;
  classes_attended: number;
  attendance_pct: number;
}

export interface WeekdayStat {
  weekday: string;
  sessions: number;
  avg_attendance_pct: number;
}

export interface LecturerOverview {
  lecturer: LecturerMe;
  total_courses: number;
  active_courses: number;
  total_students: number;
  total_enrolments: number;
  faces_enrolled: number;
  total_sessions: number;
  sessions_this_week: number;
  avg_attendance_pct: number;
  total_checkins: number;
  live_sessions: SessionSummary[];
  trend: TrendPoint[];
  by_course: CourseBreakdown[];
  by_weekday: WeekdayStat[];
  at_risk: AtRiskStudent[];
  recent_sessions: SessionSummary[];
  unread_notifications: number;
}

export interface NotificationOut {
  id: number;
  kind: string;
  message: string;
  course_id: number | null;
  course_code: string | null;
  student_id: number | null;
  student_name: string | null;
  student_matric: string | null;
  created_at: string;
  read: boolean;
}

export interface NotificationList {
  unread: number;
  items: NotificationOut[];
}

// ---------- Token storage ----------
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode); the session just won't survive a reload
  }
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(cb: () => void): () => void {
  unauthorizedListeners.add(cb);
  return () => unauthorizedListeners.delete(cb);
}

// ---------- Errors ----------
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function detailMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string; loc?: unknown[] };
    const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null;
    if (first.msg) return field && typeof field === "string" ? `${field}: ${first.msg}` : first.msg;
  }
  return `Request failed (${status})`;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Cannot reach the server. Check that the API is running.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

// ---------- Fetch wrapper ----------
async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // A bad password on the login form is also a 401; only an existing session should log out
    if (res.status === 401 && token) unauthorizedListeners.forEach((cb) => cb());
    throw new ApiError(detailMessage(body, res.status), res.status);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Download a CSV (or any file) from an authenticated endpoint. */
async function download(path: string, fallbackName: string) {
  const res = await raw(path);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<LecturerToken>("/auth/lecturer/login", json("POST", { email, password })),
  register: (body: LecturerRegister) => request<LecturerToken>("/auth/lecturer/register", json("POST", body)),
  me: () => request<LecturerMe>("/auth/lecturer/me"),
  updateMe: (body: LecturerUpdate) => request<LecturerMe>("/auth/lecturer/me", json("PATCH", body)),

  // overview
  overview: () => request<LecturerOverview>("/lecturer/overview"),

  // courses
  courses: () => request<LecturerCourse[]>("/lecturer/courses"),
  createCourse: (body: CourseCreate) => request<LecturerCourse>("/lecturer/courses", json("POST", body)),
  course: (id: number) => request<LecturerCourseDetail>(`/lecturer/courses/${id}`),
  updateCourse: (id: number, body: CourseUpdate) =>
    request<LecturerCourse>(`/lecturer/courses/${id}`, json("PATCH", body)),
  deleteCourse: (id: number) => request<void>(`/lecturer/courses/${id}`, { method: "DELETE" }),
  removeStudent: (courseId: number, studentId: number) =>
    request<void>(`/lecturer/courses/${courseId}/students/${studentId}`, { method: "DELETE" }),
  exportCourse: (id: number, code: string) =>
    download(`/lecturer/courses/${id}/export.csv`, `${code}_attendance_register.csv`),

  // sessions
  sessions: (params: { course_id?: number; state?: "live" | "ended" } = {}) => {
    const q = new URLSearchParams();
    if (params.course_id) q.set("course_id", String(params.course_id));
    if (params.state) q.set("state", params.state);
    const qs = q.toString();
    return request<SessionSummary[]>(`/lecturer/sessions${qs ? `?${qs}` : ""}`);
  },
  session: (id: number) => request<SessionDetail>(`/lecturer/sessions/${id}`),
  endSession: (id: number) => request<SessionSummary>(`/lecturer/sessions/${id}/end`, { method: "POST" }),
  deleteSession: (id: number) => request<void>(`/lecturer/sessions/${id}`, { method: "DELETE" }),
  markPresent: (sessionId: number, studentId: number) =>
    request<SessionSummary>(`/lecturer/sessions/${sessionId}/attendance/${studentId}`, { method: "PUT" }),
  unmark: (sessionId: number, studentId: number) =>
    request<SessionSummary>(`/lecturer/sessions/${sessionId}/attendance/${studentId}`, { method: "DELETE" }),
  exportSession: (id: number) => download(`/lecturer/sessions/${id}/export.csv`, `session_${id}.csv`),

  // attendance phones
  devices: () => request<DeviceOut[]>("/lecturer/devices"),
  revokeDevice: (id: string) => request<DeviceOut>(`/lecturer/devices/${id}/revoke`, { method: "POST" }),

  // notifications
  notifications: (limit = 50) => request<NotificationList>(`/lecturer/notifications?limit=${limit}`),
  readAll: () => request<NotificationList>("/lecturer/notifications/read-all", { method: "POST" }),
  readOne: (id: number) => request<NotificationOut>(`/lecturer/notifications/${id}/read`, { method: "POST" }),
};
