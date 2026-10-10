"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, getToken, onUnauthorized, setToken, type LecturerMe, type LecturerRegister } from "./api";

interface AuthState {
  lecturer: LecturerMe | null;
  /** True until we know whether a stored token is still valid. */
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(body: LecturerRegister): Promise<void>;
  logout(): void;
  setLecturer(l: LecturerMe): void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [lecturer, setLecturer] = useState<LecturerMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resolves the initial "unknown" auth state once
      setLoading(false);
      return;
    }
    api
      .me()
      .then((me) => !cancelled && setLecturer(me))
      .catch(() => {
        if (!cancelled) setToken(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setLecturer(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => onUnauthorized(logout), [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim(), password);
    setToken(res.access_token);
    setLecturer(res.lecturer);
  }, []);

  const register = useCallback(async (body: LecturerRegister) => {
    const res = await api.register(body);
    setToken(res.access_token);
    setLecturer(res.lecturer);
  }, []);

  const value = useMemo(
    () => ({ lecturer, loading, login, register, logout, setLecturer }),
    [lecturer, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
