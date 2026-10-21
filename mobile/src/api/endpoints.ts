/**
 * Typed wrappers around every backend endpoint the app uses.
 *
 * `studentApi` backs the student screens; `lecturerApi` covers only what the lecturer's
 * attendance phone needs: signing in and syncing (everything else lives on the web dashboard).
 */
import { MODEL_VERSION } from '@/face/config';

import { FACE_REQUEST_TIMEOUT_MS, api } from './client';
import type {
  CatalogCourse,
  CourseDetail,
  CourseSummary,
  FaceEnrolResult,
  JoinResult,
  Lecturer,
  LecturerToken,
  Student,
  StudentDashboard,
  StudentRegisterIn,
  StudentToken,
  SyncPullResult,
  SyncPushResult,
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
  /**
   * Frontal photo first, then the turned-head poses, each with the embedding the phone computed
   * for it (src/face/embed.ts). The server checks and stores the embeddings and keeps the photos.
   */
  async enrolFace(poses: { uri: string; embedding: Float32Array }[]): Promise<FaceEnrolResult> {
    const form = new FormData();
    poses.forEach((p, i) => form.append('images', imagePart(p.uri, `pose${i}.jpg`)));
    form.append('embeddings', JSON.stringify(poses.map((p) => Array.from(p.embedding))));
    form.append('model_version', MODEL_VERSION);
    const r = await api.post<FaceEnrolResult>('/student/enrol-face', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: FACE_REQUEST_TIMEOUT_MS,
    });
    return r.data;
  },
};

export interface DeviceInfo {
  deviceId: string;
  label: string | null;
  appVersion: string | null;
}

/** The lecturer's attendance phone: sign in, then everything else goes through sync. */
export const lecturerApi = {
  async login(email: string, password: string, device: DeviceInfo): Promise<LecturerToken> {
    const body = {
      email,
      password,
      device_id: device.deviceId,
      device_label: device.label,
      app_version: device.appVersion,
    };
    return (await api.post<LecturerToken>('/auth/lecturer/login', body)).data;
  },
  async pull(since: string | null): Promise<SyncPullResult> {
    const r = await api.get<SyncPullResult>('/lecturer/sync/pull', { params: since ? { since } : undefined, timeout: 60000 });
    return r.data;
  },
  async push(ops: { op_id: string; type: string; payload: Record<string, unknown> }[]): Promise<SyncPushResult> {
    const r = await api.post<SyncPushResult>('/lecturer/sync/push', { device_time: new Date().toISOString(), ops }, { timeout: 30000 });
    return r.data;
  },
};
