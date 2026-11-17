"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/Toast";
import { Button, Field, InlineError, Input, Spinner } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const CODE = /^\d{6}$/;
/** What is kept of what was typed or pasted: its first 6 digits (so pasting the email's whole line works) */
const digits = (text: string) => text.replace(/\D/g, "").slice(0, 6);

export default function VerifyEmailPage() {
  const { pending, loading, lecturer, verifyEmail, resendCode, forgetPending } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // The clock the resend wait is counted against. Render never reads the time itself: the interval moves it.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Set when the server says the sign-up no longer exists: the way on is to register again
  const gone = useRef(false);
  const form = useRef<HTMLFormElement>(null);

  // Nothing to confirm here (opened directly, or in another tab): signing in brings an unconfirmed sign-up back
  useEffect(() => {
    if (!loading && !pending && !lecturer) router.replace(gone.current ? "/register" : "/login");
  }, [loading, pending, lecturer, router]);

  if (loading || !pending) {
    return (
      <div className="flex items-center justify-center text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const codeError = touched && !CODE.test(code) ? "Enter the 6-digit code from the email." : null;
  /** Seconds until another code may be requested; 0 = now */
  const wait = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));

  /** What a failed request leaves on the page */
  const failed = (err: unknown) => {
    if (err instanceof ApiError && err.status === 410) {
      // The sign-up expired, or a newer one took its place: nothing is left to confirm here
      gone.current = true;
      toast(errorText(err), "error");
      forgetPending();
    } else if (!(err instanceof ApiError && err.retryAfter !== null)) {
      // (asked for a code too soon: the button counts the wait down itself, so no message)
      setError(errorText(err));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!CODE.test(code)) return;
    setError(null);
    setBusy(true);
    try {
      await verifyEmail(code);
      router.replace("/");
    } catch (err) {
      failed(err);
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResending(true);
    try {
      await resendCode();
      toast("New code sent", "success");
      // The old code no longer applies, and neither does what was said about it
      setCode("");
      setTouched(false);
      // The button just pressed is now waiting: put the keyboard back where the new code goes
      form.current?.querySelector("input")?.focus();
    } catch (err) {
      failed(err);
    } finally {
      // The wait has just moved (also when asked too soon): count it from this moment, not from the last tick
      setNow(Date.now());
      setResending(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Confirm your email</h1>
      <p className="mt-1 wrap-anywhere text-sm text-slate-500">
        We sent a 6-digit code to {pending.email}. Enter it to finish creating your account.
      </p>
      <form ref={form} onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Confirmation code" error={codeError} hint={`The code works for ${pending.codeMinutes} minute${pending.codeMinutes === 1 ? "" : "s"}.`}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} invalid={!!codeError} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(digits(e.target.value))} />
          )}
        </Field>
        <InlineError message={error} />
        <Button type="submit" loading={busy} disabled={resending} className="w-full">
          Confirm email
        </Button>
        <Button type="button" variant="secondary" loading={resending} disabled={busy || wait > 0} onClick={resend} className="w-full">
          {wait > 0 ? `Send a new code in ${wait} second${wait === 1 ? "" : "s"}` : "Send a new code"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Wrong email address?{" "}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Change your email
        </Link>
      </p>
    </div>
  );
}
