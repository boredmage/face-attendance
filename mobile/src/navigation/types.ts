import type { NavigatorScreenParams } from '@react-navigation/native';

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

/** Lecturer mode is attendance-taking only, and works offline: sessions are identified by their local uuid. */
export type LecturerStackParamList = {
  LecturerHome: undefined;
  TakeAttendance: { sessionUuid: string };
  SessionSummary: { sessionUuid: string };
};
