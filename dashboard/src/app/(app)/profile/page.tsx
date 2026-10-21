"use client";

import { useState } from "react";

import { useToast } from "@/components/Toast";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, InlineError, Input, PageHeader, Select } from "@/components/ui";
import { api, errorText, type DeviceOut, type LecturerMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";

/** Matches SYNC_WARN_DAYS on the server: the phone itself starts warning after this long. */
const SYNC_WARN_DAYS = 7;

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
        <AttendanceDevice />
      </div>
    </>
  );
}

/**
 * The phone that takes attendance. It works offline and syncs when it has internet; signing in on
 * another phone replaces it. Signing it out here stops it syncing (after it uploads what it has).
 */
function AttendanceDevice() {
  const { toast } = useToast();
  const { data, error, reload } = useApi(api.devices, "devices");
  const [confirm, setConfirm] = useState<DeviceOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const active = data?.find((d) => d.active) ?? null;

  const revoke = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await api.revokeDevice(confirm.id);
      toast("Phone signed out", "success");
      setConfirm(null);
      await reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const stale =
    active?.last_sync_at != null && now - new Date(active.last_sync_at).getTime() > SYNC_WARN_DAYS * 86_400_000;

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="Attendance phone"
        subtitle="Takes attendance offline and syncs here whenever it has internet."
      />
      <div className="p-5 text-sm">
        {error ? <InlineError message={error} /> : null}
        {data && !active ? (
          <p className="text-slate-500">No phone is signed in. Sign in as a lecturer in the mobile app to take attendance.</p>
        ) : null}
        {active ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">
                {active.label ?? "Phone"} <Badge tone="good">Active</Badge>
              </p>
              <p className="mt-1 text-slate-500">
                Last synced {active.last_sync_at ? timeAgo(active.last_sync_at) : "never"}
                {active.app_version ? ` · app ${active.app_version}` : ""}
              </p>
              {stale ? (
                <p className="mt-1 text-amber-700">
                  This phone hasn&apos;t synced for over {SYNC_WARN_DAYS} days. Attendance it took offline is not here yet.
                </p>
              ) : null}
            </div>
            <Button variant="secondary" onClick={() => setConfirm(active)}>
              Sign out this phone
            </Button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title="Sign out this phone?"
        message="It will upload any attendance it still has, then stop syncing and erase class lists and faces. Sign in again in the app to keep using it."
        confirmLabel="Sign out"
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onClose={() => setConfirm(null)}
      />
    </Card>
  );
}
