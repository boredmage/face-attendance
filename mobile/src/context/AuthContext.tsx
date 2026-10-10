/**
 * Auth state for both roles, persisted in expo-secure-store:
 *   - student:  the main app (courses, history, face enrolment)
 *   - lecturer: attendance-taking mode only
 */
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { TOKEN_KEY, onUnauthorized } from '@/api/client';
import { lecturerApi, studentApi } from '@/api/endpoints';
import type { LecturerMe, Student, StudentRegisterIn } from '@/api/types';
import { clearAll } from '@/db/database';

const SESSION_KEY = 'auth_session';

export type AuthSession = { role: 'student'; student: Student } | { role: 'lecturer'; lecturer: LecturerMe };

interface AuthState {
  session: AuthSession | null;
  loading: boolean; // true while restoring the session on app start
  loginStudent(matricNo: string, password: string): Promise<void>;
  registerStudent(body: StudentRegisterIn): Promise<void>;
  loginLecturer(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshStudent(): Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore a previous session
  useEffect(() => {
    (async () => {
      try {
        const [token, raw] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(SESSION_KEY),
        ]);
        if (token && raw) setSession(JSON.parse(raw) as AuthSession);
      } catch {
        // Corrupt or pre-v2 data: start signed out
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = useCallback(async (token: string, next: AuthSession) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const logout = useCallback(async () => {
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(SESSION_KEY)]);
    await clearAll().catch(() => undefined);
    setSession(null);
  }, []);

  // If the server says our token is invalid/expired, log out automatically
  useEffect(() => onUnauthorized(() => void logout()), [logout]);

  const loginStudent = useCallback(
    async (matricNo: string, password: string) => {
      const res = await studentApi.login(matricNo.trim(), password);
      await save(res.access_token, { role: 'student', student: res.student });
    },
    [save],
  );

  const registerStudent = useCallback(
    async (body: StudentRegisterIn) => {
      const res = await studentApi.register(body);
      await save(res.access_token, { role: 'student', student: res.student });
    },
    [save],
  );

  const loginLecturer = useCallback(
    async (email: string, password: string) => {
      const res = await lecturerApi.login(email.trim(), password);
      await save(res.access_token, { role: 'lecturer', lecturer: res.lecturer });
    },
    [save],
  );

  const refreshStudent = useCallback(async () => {
    const s = await studentApi.me();
    const next: AuthSession = { role: 'student', student: s };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({ session, loading, loginStudent, registerStudent, loginLecturer, logout, refreshStudent }),
    [session, loading, loginStudent, registerStudent, loginLecturer, logout, refreshStudent],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in student (only call from student screens). */
export function useStudent(): Student {
  const { session } = useAuth();
  if (session?.role !== 'student') throw new Error('useStudent used outside the student app');
  return session.student;
}

/** The signed-in lecturer (only call from lecturer-mode screens). */
export function useLecturer(): LecturerMe {
  const { session } = useAuth();
  if (session?.role !== 'lecturer') throw new Error('useLecturer used outside lecturer mode');
  return session.lecturer;
}
