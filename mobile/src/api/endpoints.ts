/**
 * Typed wrappers around every backend endpoint the app uses.
 *
 * `studentApi` backs the student screens; `lecturerApi` covers only what the lecturer's
 * attendance-taking mode needs (everything else for lecturers lives on the web dashboard).
 */
import { FACE_REQUEST_TIMEOUT_MS, api } from './client';
import type {
  CatalogCourse,
  CourseDetail,
  CourseSummary,
  FaceEnrolResult,
  JoinResult,
  Lecturer,
  LecturerCourse,
  LecturerMe,
  LecturerToken,
  ScanResult,
  SessionDetail,
  SessionSummary,
  Student,
  StudentDashboard,
  StudentRegisterIn,
  StudentToken,
} from './types';

function imagePart(uri: string, name = 'photo.jpg') {
  // React Native's FormData accepts { uri, name, type } objects for file uploads
  return { uri, name, type: 'image/jpeg' } as unknown as Blob;
}

export const studentApi = {
  async register(body: StudentRegisterIn): Promise<StudentToken> {
    return (await api.post<StudentToken>('/auth/student/register', body)).data;
  },
  async login(matricNo: string, password: string): Promise<StudentToken> {
    return (await api.post<StudentToken>('/auth/student/login', { matric_no: matricNo, password })).data;
  },
  async me(): Promise<Student> {
    return (await api.get<Student>('/auth/student/me')).data;
  },
  async dashboard(): Promise<StudentDashboard> {
    return (await api.get<StudentDashboard>('/student/dashboard')).data;
  },
  async courses(): Promise<CourseSummary[]> {
    return (await api.get<CourseSummary[]>('/student/courses')).data;
  },
  async catalog(q?: string): Promise<CatalogCourse[]> {
    return (await api.get<CatalogCourse[]>('/student/catalog', { params: q ? { q } : undefined })).data;
  },
  async join(courseId: number): Promise<JoinResult> {
    return (await api.post<JoinResult>(`/student/courses/${courseId}/join`)).data;
  },
  async courseDetail(courseId: number): Promise<CourseDetail> {
    return (await api.get<CourseDetail>(`/student/courses/${courseId}`)).data;
  },
  async lecturers(): Promise<Lecturer[]> {
    return (await api.get<Lecturer[]>('/student/lecturers')).data;
  },
  /** Frontal photo first, then the turned-head poses. The server stores one embedding per photo. */
  async enrolFace(imageUris: string[]): Promise<FaceEnrolResult> {
    const form = new FormData();
    imageUris.forEach((uri, i) => form.append('images', imagePart(uri, `pose${i}.jpg`)));
    const r = await api.post<FaceEnrolResult>('/student/enrol-face', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: FACE_REQUEST_TIMEOUT_MS,
    });
    return r.data;
  },
};

export const lecturerApi = {
  async login(email: string, password: string): Promise<LecturerToken> {
    return (await api.post<LecturerToken>('/auth/lecturer/login', { email, password })).data;
  },
  async me(): Promise<LecturerMe> {
    return (await api.get<LecturerMe>('/auth/lecturer/me')).data;
  },
  async courses(): Promise<LecturerCourse[]> {
    return (await api.get<LecturerCourse[]>('/lecturer/courses')).data;
  },
  async startSession(courseId: number, venue?: string, topic?: string): Promise<SessionSummary> {
    const body = { venue: venue?.trim() || null, topic: topic?.trim() || null };
    return (await api.post<SessionSummary>(`/lecturer/courses/${courseId}/sessions`, body)).data;
  },
  async sessionDetail(sessionId: number): Promise<SessionDetail> {
    return (await api.get<SessionDetail>(`/lecturer/sessions/${sessionId}`)).data;
  },
  async endSession(sessionId: number): Promise<SessionSummary> {
    return (await api.post<SessionSummary>(`/lecturer/sessions/${sessionId}/end`)).data;
  },
  /** One photo of a student in front of the lecturer's phone -> identify among the class and mark present. */
  async scan(sessionId: number, imageUri: string): Promise<ScanResult> {
    const form = new FormData();
    form.append('image', imagePart(imageUri, 'scan.jpg'));
    const r = await api.post<ScanResult>(`/lecturer/sessions/${sessionId}/scan`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: FACE_REQUEST_TIMEOUT_MS,
    });
    return r.data;
  },
};
