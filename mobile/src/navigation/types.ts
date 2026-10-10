import type { NavigatorScreenParams } from '@react-navigation/native';

import type { SessionSummary } from '@/api/types';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

/** Student who has not enrolled their face yet: nothing else is reachable. */
export type FaceSetupStackParamList = {
  FaceIntro: undefined;
  EnrolFace: undefined;
};

export type TabParamList = {
  Home: undefined;
  Courses: undefined;
  Lecturers: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabParamList>;
  CourseDetail: { courseId: number; code: string };
  Catalog: undefined;
  EnrolFace: undefined;
};

/** Lecturer mode is attendance-taking only. */
export type LecturerStackParamList = {
  LecturerHome: undefined;
  TakeAttendance: { sessionId: number; courseCode: string; courseTitle: string; startedAt: string };
  SessionSummary: { session: SessionSummary };
};
