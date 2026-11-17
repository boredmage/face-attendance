"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/Toast";
import { Button, Field, InlineError, Input, Spinner } from "@/components/ui";
import { api, ApiError, errorText } from "@/lib/api";
import { readReset, storeReset, toReset, type PasswordReset } from "@/lib/passwordReset";

const CODE = /^\d{6}$/;
/** What is kept of what was typed or pasted: its first 6 digits (so pasting the email's whole line works) */
const digits = (text: string) => text.replace(/\D/g, "").slice(0, 6);

interface Errors {
  code?: string;
  password?: string;
  confirm?: string;
}

function validate(code: string, password: string, confirm: string): Errors {
  const e: Errors = {};
  if (!CODE.test(code)) e.code = "Enter the 6-digit code from the email.";
  if (password.length < 8) e.password = "Use at least 8 characters.";
  if (confirm !== password) e.confirm = "Passwords do not match.";
  return e;
}

/** Step 2 of a password reset: the emailed code and the new password. Signing in follows. */
export default function ResetPasswordPage() {
  const { toast } = useToast();
  const router = useRouter();
  // null until read from storage after mount (it is not there during server rendering)
  const [reset, setReset] = useState<PasswordReset | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // The clock the resend wait is counted against. Render never reads the time itself: the interval moves it.
  const [now, setNow] = useState(() => Date.now());
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Nothing to reset here (opened directly, or the tab was reloaded without storage): ask for a code first
  useEffect(() => {
    const current = readReset();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores stored state once, after hydration
    if (current) setReset(current);
    else router.replace("/forgot-password");
  }, [router]);

  if (!reset) {
    return (
      <div className="flex items-center justify-center text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const errors = touched ? validate(code, password, confirm) : {};
  /** Seconds until another code may be requested; 0 = now */
  const wait = Math.max(0, Math.ceil((reset.resendAt - now) / 1000));

  const keep = (next: PasswordReset) => {
    storeReset(next);
    setReset(next);
  };

  /** What a failed request leaves on the page */
  const failed = (err: unknown) => {
    if (err instanceof ApiError && err.status === 410) {
      // The reset ran out (or was used): the way on is to ask for a new code
      toast(errorText(err), "error");
      storeReset(null);
      router.replace("/forgot-password");
    } else if (!(err instanceof ApiError && err.retryAfter !== null)) {
      // (asked for a code too soon: the button counts the wait down itself, so no message)
      setError(errorText(err));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validate(code, password, confirm)).length) return;
    setError(null);
    setBusy(true);
    try {
      await api.resetPassword(reset.resetId, code, password);
      storeReset(null);
      toast("Password changed. Sign in with your new password.", "success");
      router.replace("/login");
    } catch (err) {
      failed(err);
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResending(true);
    try {
      keep(toReset(await api.resendResetCode(reset.resetId), reset.email));
      toast("New code sent", "success");
      // The old code no longer applies, and neither does what was said about it
      setCode("");
      setTouched(false);
      // The button just pressed is now waiting: put the keyboard back where the new code goes
      form.current?.querySelector("input")?.focus();
    } catch (err) {
      if (err instanceof ApiError && err.retryAfter !== null) keep({ ...reset, resendAt: Date.now() + err.retryAfter * 1000 });
      failed(err);
    } finally {
      // The wait has just moved (also when asked too soon): count it from this moment, not from the last tick
      setNow(Date.now());
      setResending(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Choose a new password</h1>
      <p className="mt-1 wrap-anywhere text-sm text-slate-500">
        If a lecturer account uses {reset.email}, we sent a 6-digit code to it. Enter the code and your new password.
      </p>
      <form ref={form} onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Reset code" required error={errors.code} hint={`The code works for ${reset.codeMinutes} minute${reset.codeMinutes === 1 ? "" : "s"}.`}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} invalid={!!errors.code} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits(e.target.value))} />
          )}
        </Field>
        <Field label="New password" required error={errors.password} hint="At least 8 characters">
          {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </Field>
        <Field label="Confirm new password" required error={errors.confirm}>
          {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.confirm} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
        </Field>
        <InlineError message={error} />
        <Button type="submit" loading={busy} disabled={resending} className="w-full">
          Set new password
        </Button>
        <Button type="button" variant="secondary" loading={resending} disabled={busy || wait > 0} onClick={resend} className="w-full">
          {wait > 0 ? `Send a new code in ${wait} second${wait === 1 ? "" : "s"}` : "Send a new code"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Wrong email address?{" "}
        <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
          Start again
        </Link>
      </p>
    </div>
  );
}
