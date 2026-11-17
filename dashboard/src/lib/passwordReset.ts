/**
 * The password reset in progress in this tab, between /forgot-password and /reset-password.
 *
 * Kept in sessionStorage (like a pending sign-up, see auth.tsx) so a reload of /reset-password
 * keeps it. It holds the reset's handle and the address typed, never the code or a password.
 */
import type { PasswordResetPending } from "@/lib/api";

export interface PasswordReset {
  resetId: string;
  /** As typed on /forgot-password: the server does not say whether an account uses it */
  email: string;
  codeMinutes: number;
  /** When another code may be requested (ms since epoch) */
  resendAt: number;
}

const KEY = "fa_password_reset";
// Also held here, so moving between the two pages works where storage is unavailable (private mode)
let memory: PasswordReset | null = null;

export function readReset(): PasswordReset | null {
  if (memory) return memory;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as Partial<PasswordReset>) : null;
    return value?.resetId && value.email ? (value as PasswordReset) : null;
  } catch {
    return null;
  }
}

export function storeReset(value: PasswordReset | null) {
  memory = value;
  try {
    if (value) window.sessionStorage.setItem(KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: `memory` still carries it until the tab reloads
  }
}

export function toReset(p: PasswordResetPending, email: string): PasswordReset {
  return {
    resetId: p.reset_id,
    email,
    codeMinutes: p.code_minutes,
    resendAt: Date.now() + p.resend_in_seconds * 1000,
  };
}
