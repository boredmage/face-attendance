import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  /** `notice`: a success message to show above the form (after a password reset) */
  Login: { notice?: string } | undefined;
  Register: undefined;
  /** Enter the code emailed for a sign-up (the fields of the server's PendingVerification). */
  VerifyEmail: { verificationId: string; email: string; resendInSeconds: number; codeMinutes: number };
  /** Ask for a password reset code, for the account kind of the Login tab that was open. */
  ForgotPassword: { role: 'student' | 'lecturer'; identifier?: string };
  /** Enter the emailed reset code and a new password (the fields of the server's PasswordResetPending). */
  ResetPassword: {
    role: 'student' | 'lecturer';
    /** As typed on ForgotPassword: the server does not say whether an account matched it */
    identifier: string;
    resetId: string;
    resendInSeconds: number;
    codeMinutes: number;
  };
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
