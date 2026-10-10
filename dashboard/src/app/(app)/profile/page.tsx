"use client";

import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Button, Card, CardHeader, Field, InlineError, Input, PageHeader, Select } from "@/components/ui";
import { api, errorText, type LecturerMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TITLES = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."];

export default function ProfilePage() {
  const { lecturer } = useAuth();
  // The (app) layout only renders pages once the lecturer is loaded
  if (!lecturer) return null;
  return <ProfileForm key={lecturer.id} lecturer={lecturer} />;
}

function ProfileForm({ lecturer }: { lecturer: LecturerMe }) {
  const { setLecturer } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: lecturer.title ?? "",
    name: lecturer.name,
    department: lecturer.department,
    faculty: lecturer.faculty ?? "",
    phone: lecturer.phone ?? "",
    office: lecturer.office ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const nameError = form.name.trim().length < 3 ? "Enter your full name." : null;
  const deptError = form.department.trim().length < 2 ? "Enter your department." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameError || deptError) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateMe({
        title: form.title || null,
        name: form.name.trim(),
        department: form.department.trim(),
        faculty: form.faculty.trim() || null,
        phone: form.phone.trim() || null,
        office: form.office.trim() || null,
      });
      setLecturer(updated);
      toast("Profile saved", "success");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Profile" subtitle="Students see your name, department, office and contact details in the app." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your details" />
          <form onSubmit={submit} className="space-y-5 p-5" noValidate>
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label="Title">
                {(id) => (
                  <Select id={id} value={form.title} onChange={set("title")}>
                    <option value="">—</option>
                    {TITLES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Full name" required error={nameError}>
                {(id, d) => <Input id={id} aria-describedby={d} invalid={!!nameError} value={form.name} onChange={set("name")} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" required error={deptError}>
                {(id, d) => <Input id={id} aria-describedby={d} invalid={!!deptError} value={form.department} onChange={set("department")} />}
              </Field>
              <Field label="Faculty">{(id) => <Input id={id} value={form.faculty} onChange={set("faculty")} />}</Field>
              <Field label="Phone">{(id) => <Input id={id} type="tel" value={form.phone} onChange={set("phone")} />}</Field>
              <Field label="Office">{(id) => <Input id={id} value={form.office} onChange={set("office")} />}</Field>
            </div>
            <InlineError message={error} />
            <div className="flex justify-end">
              <Button type="submit" loading={busy} disabled={!!nameError || !!deptError}>
                Save changes
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          <CardHeader title="Account" />
          <dl className="space-y-4 p-5 text-sm">
            <div>
              <dt className="text-slate-500">Email (sign-in)</dt>
              <dd className="font-medium text-slate-900">{lecturer.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Staff ID</dt>
              <dd className="font-medium text-slate-900">{lecturer.staff_id ?? "—"}</dd>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Use this same email and password in the mobile app&apos;s Lecturer sign-in to take attendance.
            </p>
          </dl>
        </Card>
      </div>
    </>
  );
}
