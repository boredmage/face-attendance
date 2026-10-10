"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Field, InlineError, Input, Select } from "@/components/ui";
import { errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TITLES = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."];

interface Form {
  title: string;
  name: string;
  staff_id: string;
  email: string;
  department: string;
  faculty: string;
  phone: string;
  office: string;
  password: string;
  confirm: string;
}

const EMPTY: Form = {
  title: "Dr.",
  name: "",
  staff_id: "",
  email: "",
  department: "",
  faculty: "",
  phone: "",
  office: "",
  password: "",
  confirm: "",
};

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (f.name.trim().length < 3) e.name = "Enter your full name.";
  if (!f.staff_id.trim()) e.staff_id = "Enter your staff ID.";
  else if (f.staff_id.trim().length > 32) e.staff_id = "Staff ID is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (f.department.trim().length < 2) e.department = "Enter your department.";
  if (f.phone.trim() && !/^[+\d][\d\s-]{6,}$/.test(f.phone.trim())) e.phone = "Enter a valid phone number.";
  if (f.password.length < 8) e.password = "Use at least 8 characters.";
  if (f.confirm !== f.password) e.confirm = "Passwords do not match.";
  return e;
}

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = touched ? validate(form) : {};
  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validate(form)).length) return;
    setError(null);
    setBusy(true);
    const opt = (v: string) => v.trim() || null;
    try {
      await register({
        title: form.title,
        name: form.name.trim(),
        staff_id: form.staff_id.trim(),
        email: form.email.trim(),
        department: form.department.trim(),
        faculty: opt(form.faculty),
        phone: opt(form.phone),
        office: opt(form.office),
        password: form.password,
      });
      router.replace("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Create your lecturer account</h1>
      <p className="mt-1 text-sm text-slate-500">Your details are shown to students who register for your courses.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Title">
            {(id) => (
              <Select id={id} value={form.title} onChange={set("title")}>
                {TITLES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Full name" required error={errors.name}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.name} value={form.name} onChange={set("name")} placeholder="A. O. Bello" autoComplete="name" />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Staff ID" required error={errors.staff_id}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.staff_id} value={form.staff_id} onChange={set("staff_id")} placeholder="UI/CS/0101" />}
          </Field>
          <Field label="Email" required error={errors.email}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.email} type="email" value={form.email} onChange={set("email")} placeholder="you@ui.edu.ng" autoComplete="email" />}
          </Field>
          <Field label="Department" required error={errors.department}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.department} value={form.department} onChange={set("department")} placeholder="Computer Science" />}
          </Field>
          <Field label="Faculty">
            {(id) => <Input id={id} value={form.faculty} onChange={set("faculty")} placeholder="Science" />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.phone} type="tel" value={form.phone} onChange={set("phone")} placeholder="+234 803 000 0000" autoComplete="tel" />}
          </Field>
          <Field label="Office">
            {(id) => <Input id={id} value={form.office} onChange={set("office")} placeholder="CS Building, Room 204" />}
          </Field>
          <Field label="Password" required error={errors.password} hint="At least 8 characters">
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.password} type="password" value={form.password} onChange={set("password")} autoComplete="new-password" />}
          </Field>
          <Field label="Confirm password" required error={errors.confirm}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.confirm} type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />}
          </Field>
        </div>
        <InlineError message={error} />
        <Button type="submit" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
