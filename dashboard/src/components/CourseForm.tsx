"use client";

import { useState } from "react";

import { api, errorText, type LecturerCourse } from "@/lib/api";

import { Button, Field, InlineError, Input, Modal, Select, Textarea } from "./ui";

interface Values {
  code: string;
  title: string;
  description: string;
  units: string;
  level: string;
  semester: string;
}

function initial(course?: LecturerCourse): Values {
  return {
    code: course?.code ?? "",
    title: course?.title ?? "",
    description: course?.description ?? "",
    units: course?.units != null ? String(course.units) : "",
    level: course?.level ?? "",
    semester: course?.semester ?? "",
  };
}

function validate(v: Values, creating: boolean): Partial<Record<keyof Values, string>> {
  const e: Partial<Record<keyof Values, string>> = {};
  const code = v.code.replace(/\s+/g, "");
  if (creating) {
    if (code.length < 3) e.code = "Enter a course code, e.g. CSC401.";
    else if (code.length > 16) e.code = "At most 16 characters.";
  }
  if (v.title.trim().length < 3) e.title = "Enter the course title.";
  if (v.units.trim()) {
    const n = Number(v.units);
    if (!Number.isInteger(n) || n < 0 || n > 12) e.units = "Units must be a whole number from 0 to 12.";
  }
  return e;
}

/** Create a course (no `course`) or edit one. The modal is remounted per open, so state starts fresh. */
export function CourseFormModal({
  open,
  course,
  onClose,
  onSaved,
}: {
  open: boolean;
  course?: LecturerCourse;
  onClose: () => void;
  onSaved: (course: LecturerCourse) => void;
}) {
  const creating = !course;
  const [values, setValues] = useState<Values>(() => initial(course));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = touched ? validate(values, creating) : {};
  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (Object.keys(validate(values, creating)).length) return;
    setBusy(true);
    setError(null);
    const body = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      units: values.units.trim() ? Number(values.units) : null,
      level: values.level || null,
      semester: values.semester || null,
    };
    try {
      const saved = creating
        ? await api.createCourse({ ...body, code: values.code.replace(/\s+/g, "").toUpperCase() })
        : await api.updateCourse(course.id, body);
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? "Create a course" : `Edit ${course.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {creating ? "Create course" : "Save changes"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Course code" required error={errors.code} hint={creating ? "Must be unique" : "Cannot be changed"}>
            {(id, d) => (
              <Input
                id={id}
                aria-describedby={d}
                invalid={!!errors.code}
                value={values.code}
                onChange={set("code")}
                placeholder="CSC401"
                disabled={!creating}
                className="uppercase"
                autoFocus={creating}
              />
            )}
          </Field>
          <Field label="Title" required error={errors.title}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.title} value={values.title} onChange={set("title")} placeholder="Algorithms and Complexity Analysis" />}
          </Field>
        </div>
        <Field label="Description">
          {(id) => <Textarea id={id} rows={3} value={values.description} onChange={set("description")} placeholder="What students will learn (shown in the app's course catalogue)" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Units" error={errors.units}>
            {(id, d) => <Input id={id} aria-describedby={d} invalid={!!errors.units} inputMode="numeric" value={values.units} onChange={set("units")} placeholder="3" />}
          </Field>
          <Field label="Level">
            {(id) => (
              <Select id={id} value={values.level} onChange={set("level")}>
                <option value="">—</option>
                {["100", "200", "300", "400", "500", "600", "700"].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Semester">
            {(id) => (
              <Select id={id} value={values.semester} onChange={set("semester")}>
                <option value="">—</option>
                <option value="First">First</option>
                <option value="Second">Second</option>
              </Select>
            )}
          </Field>
        </div>
        <InlineError message={error} />
        {/* Lets Enter submit the form */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
