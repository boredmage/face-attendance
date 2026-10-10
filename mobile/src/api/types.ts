/** Mirrors the Pydantic schemas in backend/app/schemas.py. Datetimes are ISO strings with a UTC offset. */

// ---------- Auth ----------
export interface Student {
  id: number;
  matric_no: string;
  full_name: string;
  email: string | null;
  department: string;
  level: string;
  face_enrolled: boolean;
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

// ---------- Lecturer side (attendance mode only) ----------
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

export interface SessionDetail {
  session: SessionSummary;
  present: PresentRow[];
  absent: { student_id: number; matric_no: string; full_name: string; face_enrolled: boolean }[];
}

export interface ScanResult {
  status: 'marked' | 'already_marked' | 'not_recognised';
  message: string;
  student: { id: number; matric_no: string; full_name: string } | null;
  confidence: number | null;
  marked_at: string | null;
  present: number;
  expected: number;
}
