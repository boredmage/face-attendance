"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, InlineError, Input } from "@/components/ui";
import { errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Lecturer sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Use the email and password you registered with.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Email">
          {(id) => (
            <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ui.edu.ng" autoFocus />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <InlineError message={error} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        New lecturer?{" "}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
      <p className="mt-8 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs text-slate-500">
        Students use the mobile app, not this dashboard.
      </p>
    </div>
  );
}
