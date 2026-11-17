"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  getToken,
  onUnauthorized,
  setToken,
  type LecturerMe,
  type LecturerRegister,
  type PendingVerification,
} from "./api";

/** A sign-up waiting for its emailed code: what /verify-email works on. */
export interface EmailConfirmation {
  verificationId: string;
  email: string;
  /** Minutes a code works after it is sent */
  codeMinutes: number;
  /** When another code may be requested (ms since the epoch) */
  resendAt: number;
}

interface AuthState {
  lecturer: LecturerMe | null;
  /** True until we know whether a stored token is still valid. */
  loading: boolean;
  /** The sign-up whose email still has to be confirmed, if there is one. */
  pending: EmailConfirmation | null;
  /** Resolves to where the lecturer goes next: signed in, or still owing the emailed code. */
  login(email: string, password: string): Promise<"signed-in" | "confirm-email">;
  /** Starts a sign-up: emails a code and sets `pending`. Nobody is signed in until `verifyEmail`. */
  register(body: LecturerRegister): Promise<void>;
  /** Finishes the pending sign-up with the emailed code and signs in. */
  verifyEmail(code: string): Promise<void>;
  /** Emails a new code for the pending sign-up. */
  resendCode(): Promise<void>;
  /** Drops the pending sign-up (the server says it no longer exists). */
  forgetPending(): void;
  logout(): void;
  setLecturer(l: LecturerMe): void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// Kept for the tab only, so a reload (or coming back from the mail tab) lands on the code again.
// It holds the sign-up's handle and address, never the code or the password.
const PENDING_KEY = "fa_pending_verification";

function readPending(): EmailConfirmation | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<EmailConfirmation>) : null;
    return value?.verificationId && value.email ? (value as EmailConfirmation) : null;
  } catch {
    return null;
  }
}

function storePending(value: EmailConfirmation | null) {
  try {
    if (value) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable (private mode): signing in again brings the confirmation back
  }
}

function toConfirmation(p: PendingVerification): EmailConfirmation {
  return {
    verificationId: p.verification_id,
    email: p.email,
    codeMinutes: p.code_minutes,
    resendAt: Date.now() + p.resend_in_seconds * 1000,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [lecturer, setLecturer] = useState<LecturerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPendingState] = useState<EmailConfirmation | null>(null);

  const setPending = useCallback((value: EmailConfirmation | null) => {
    storePending(value);
    setPendingState(value);
  }, []);

  // A confirmation left open in this tab (sessionStorage is not there during server rendering).
  // Runs with the effect below, so `pending` is back before `loading` turns false.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores stored state once, after hydration
    setPendingState(readPending());
  }, []);

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

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await api.login(email.trim(), password);
        setToken(res.access_token);
        setLecturer(res.lecturer);
        setPending(null);
        return "signed-in" as const;
      } catch (err) {
        // The right password for a sign-up whose email was never confirmed: finish that first
        if (err instanceof ApiError && err.verification) {
          setPending(toConfirmation(err.verification));
          return "confirm-email" as const;
        }
        throw err;
      }
    },
    [setPending],
  );

  const register = useCallback(
    async (body: LecturerRegister) => {
      setPending(toConfirmation(await api.register(body)));
    },
    [setPending],
  );

  const verifyEmail = useCallback(
    async (code: string) => {
      if (!pending) throw new Error("There is no sign-up to confirm.");
      const res = await api.verifyEmail(pending.verificationId, code);
      setToken(res.access_token);
      setLecturer(res.lecturer);
      setPending(null);
    },
    [pending, setPending],
  );

  const resendCode = useCallback(async () => {
    if (!pending) throw new Error("There is no sign-up to confirm.");
    try {
      setPending(toConfirmation(await api.resendCode(pending.verificationId)));
    } catch (err) {
      // Asked too soon: the server says how long is left, which keeps the countdown honest
      if (err instanceof ApiError && err.retryAfter !== null) {
        setPending({ ...pending, resendAt: Date.now() + err.retryAfter * 1000 });
      }
      throw err;
    }
  }, [pending, setPending]);

  const forgetPending = useCallback(() => setPending(null), [setPending]);

  const value = useMemo(
    () => ({ lecturer, loading, pending, login, register, verifyEmail, resendCode, forgetPending, logout, setLecturer }),
    [lecturer, loading, pending, login, register, verifyEmail, resendCode, forgetPending, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
