"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Field, InlineError, Input } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { readReset, storeReset, toReset } from "@/lib/passwordReset";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Step 1 of a password reset: the lecturer's email. A code goes to it, then /reset-password takes over. */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Coming back with "Start again" keeps the address that was typed (storage is not there during server rendering)
  useEffect(() => {
    const previous = readReset();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores stored state once, after hydration
    if (previous) setEmail(previous.email);
  }, []);

  const emailError = touched && !EMAIL.test(email.trim()) ? "Enter a valid email address." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL.test(email.trim())) return;
    setError(null);
    setBusy(true);
    try {
      storeReset(toReset(await api.forgotPassword(email), email.trim()));
      router.push("/reset-password");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the email you registered with. We&apos;ll send you a 6-digit code to choose a new password.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Email" error={emailError}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} invalid={!!emailError} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ui.edu.ng" autoFocus />
          )}
        </Field>
        <InlineError message={error} />
        <Button type="submit" loading={busy} className="w-full">
          Send code
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
