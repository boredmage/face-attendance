/** Mirrors the Pydantic schemas in backend/app/schemas.py. Datetimes are ISO strings with a UTC offset. */
import type { PullPayload } from '@/db/lecturerStore';

// ---------- Auth ----------
export interface Student {
  id: number;
  matric_no: string;
  full_name: string;
  email: string | null;
  department: string;
  level: string;
  face_enrolled: boolean;
  /** Enrolled with an older face model: lecturers' phones can't recognise them until they re-scan */
  face_needs_update?: boolean;
}

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

export interface StudentToken {
  access_token: string;
  token_type: string;
  role: 'student';
  student: Student;
}

export interface LecturerToken {
  access_token: string;
  token_type: string;
  role: 'lecturer';
  lecturer: LecturerMe;
  /** Present when the login named a device_id (the attendance app always does) */
  refresh_token: string | null;
}

export interface StudentRegisterIn {
  matric_no: string;
  full_name: string;
  email?: string | null;
  department: string;
  level: string;
  password: string;
}

// ---------- Student side ----------
export interface LiveClass {
  session_id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  lecturer_name: string;
  venue: string | null;
  started_at: string;
  attended: boolean;
}

export interface RecentAttendance {
  session_id: number;
  course_code: string;
  course_title: string;
  started_at: string;
  attended: boolean;
  marked_at: string | null;
}

/**
 * Where a student stands for one course's exam. Eligibility is always per course: a good
 * average elsewhere never makes up for a course below the threshold.
 */
export interface ExamStanding {
  required_pct: number; // 75
  eligible: boolean;
  classes_to_qualify: number; // classes in a row to attend to get back above required_pct (0 if eligible)
  can_miss: number; // classes in a row that can be missed while staying eligible (0 if not eligible)
}

export interface StudentDashboard {
  student: Student;
  total_courses: number;
  courses: CourseSummary[];
  live_classes: LiveClass[];
  recent: RecentAttendance[];
}

export interface CourseSummary extends ExamStanding {
  id: number;
  code: string;
  title: string;
  lecturer_name: string;
  classes_held: number;
  classes_attended: number;
  attendance_pct: number;
}

export interface CatalogCourse {
  id: number;
  code: string;
  title: string;
  description: string | null;
  units: number | null;
  level: string | null;
  semester: string | null;
  lecturer_name: string;
  department: string;
  students: number;
  joined: boolean;
}

export interface JoinResult {
  message: string;
  course: CourseSummary;
}

export interface StudentSessionEntry {
  session_id: number;
  started_at: string;
  ended_at: string | null; // null while the class is in progress
  venue: string | null;
  topic: string | null;
  attended: boolean;
  marked_at: string | null;
}

export interface CourseDetail extends ExamStanding {
  id: number;
  code: string;
  title: string;
  description: string | null;
  lecturer_name: string;
  lecturer_department: string;
  joined_at: string;
  classes_held: number;
  classes_attended: number;
  attendance_pct: number;
  at_risk: boolean;
  sessions: StudentSessionEntry[];
}

export interface Lecturer {
  id: number;
  name: string;
  department: string;
  courses: string[];
  email: string | null;
  phone: string | null;
  office: string | null;
}

export interface FaceEnrolResult {
  message: string;
  embedding_length: number;
  images_used: number;
}

// ---------- Lecturer device sync (see backend/app/routers/sync.py) ----------
export interface SyncPullResult extends PullPayload {
  server_time: string;
  cursor: string;
  matching: { model_version: string; threshold: number; margin: number };
  offline_policy: OfflinePolicy;
}

export interface OfflinePolicy {
  warn_days: number;
  strong_warn_days: number;
  block_days: number;
}

export interface SyncOpResult {
  op_id: string;
  status: 'applied' | 'rejected';
  reason: string | null;
}

export interface SyncPushResult {
  server_time: string;
  clock_offset_seconds: number;
  results: SyncOpResult[];
}
