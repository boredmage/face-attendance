/**
 * Auth state for both roles, persisted in expo-secure-store:
 *   - student:  the main app (courses, history, face enrolment)
 *   - lecturer: attendance-taking mode only, offline-first
 *
 * A lecturer's phone is never logged out by an expired or rejected token: classes recorded offline
 * live on the phone until they're synced. When the refresh token stops working the sync manager
 * reports `auth_needed` and the lecturer re-enters their password (`reauthLecturer`), which keeps
 * all local data. Local data is only wiped on an explicit logout, when a different lecturer signs
 * in, or when this phone was replaced by another one and has finished uploading.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { REFRESH_KEY, TOKEN_KEY, onUnauthorized } from '@/api/client';
import { lecturerApi, studentApi } from '@/api/endpoints';
import type { LecturerMe, Student, StudentRegisterIn } from '@/api/types';
import { clearAll, metaGet, metaSet } from '@/db/database';
import { loadFaceModel } from '@/face/embed';
import { registerBackgroundSync, unregisterBackgroundSync } from '@/sync/backgroundSync';
import { syncManager } from '@/sync/syncManager';

const SESSION_KEY = 'auth_session';

export type AuthSession = { role: 'student'; student: Student } | { role: 'lecturer'; lecturer: LecturerMe };

interface AuthState {
  session: AuthSession | null;
  loading: boolean; // true while restoring the session on app start
  loginStudent(matricNo: string, password: string): Promise<void>;
  registerStudent(body: StudentRegisterIn): Promise<void>;
  loginLecturer(email: string, password: string): Promise<void>;
  /** Sign the same lecturer in again after their refresh token stopped working; keeps local data. */
  reauthLecturer(password: string): Promise<void>;
  logout(): Promise<void>;
  refreshStudent(): Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function startLecturerDevice(): void {
  syncManager.start();
  void registerBackgroundSync();
  void loadFaceModel().catch((err) => console.warn('Face model failed to load', err)); // warm up before class
}

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
        if (token && raw) {
          const restored = JSON.parse(raw) as AuthSession;
          setSession(restored);
          if (restored.role === 'lecturer') startLecturerDevice();
        }
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
    syncManager.stop();
    await unregisterBackgroundSync();
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(SESSION_KEY),
    ]);
    await clearAll().catch(() => undefined);
    setSession(null);
  }, []);

  // A student whose token the server rejects is logged out (lecturer devices refresh instead)
  useEffect(() => onUnauthorized(() => void logout()), [logout]);
  // A replaced lecturer phone wipes itself once everything it recorded has been uploaded
  useEffect(() => syncManager.onReplacedAndDrained(() => void logout()), [logout]);

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

  const signInLecturer = useCallback(
    async (email: string, password: string) => {
      const res = await lecturerApi.login(email.trim(), password, {
        // A fresh device id per sign-in: the server makes it the lecturer's one active phone
        deviceId: Crypto.randomUUID(),
        label: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || null,
        appVersion: Constants.expoConfig?.version ?? null,
      });
      // Another lecturer's rosters, faces and unsynced classes must not stay on this phone
      if ((await metaGet('lecturer_id')) !== String(res.lecturer.id)) await clearAll();
      await metaSet('lecturer_id', String(res.lecturer.id));
      if (res.refresh_token) await SecureStore.setItemAsync(REFRESH_KEY, res.refresh_token);
      await save(res.access_token, { role: 'lecturer', lecturer: res.lecturer });
      syncManager.stop();
      startLecturerDevice();
    },
    [save],
  );

  const loginLecturer = signInLecturer;

  const reauthLecturer = useCallback(
    async (password: string) => {
      if (session?.role !== 'lecturer') throw new Error('Not signed in as a lecturer');
      await signInLecturer(session.lecturer.email, password);
    },
    [session, signInLecturer],
  );

  const refreshStudent = useCallback(async () => {
    const s = await studentApi.me();
    const next: AuthSession = { role: 'student', student: s };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const value = useMemo(
    () => ({ session, loading, loginStudent, registerStudent, loginLecturer, reauthLecturer, logout, refreshStudent }),
    [session, loading, loginStudent, registerStudent, loginLecturer, reauthLecturer, logout, refreshStudent],
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
