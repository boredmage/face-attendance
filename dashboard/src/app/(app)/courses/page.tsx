"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CourseFormModal } from "@/components/CourseForm";
import { BookIcon, PlusIcon } from "@/components/icons";
import { AttendanceBadge, Badge, Button, Card, EmptyState, ErrorState, LiveBadge, PageHeader, PctBar, Skeleton } from "@/components/ui";
import { api, type LecturerCourse } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function CoursesPage() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi(api.courses, "courses", 30_000);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const courses = (data ?? []).filter((c) => showArchived || c.is_active);
  const archivedCount = (data ?? []).filter((c) => !c.is_active).length;

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="Courses you create appear in the student app's catalogue, where students can join them."
        actions={
          <>
            {archivedCount > 0 ? (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                />
                Show archived ({archivedCount})
              </label>
            ) : null}
            <Button onClick={() => setCreating(true)}>
              <PlusIcon width={16} height={16} /> New course
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : !data ? (
        <ErrorState message={error ?? "Could not load courses."} onRetry={reload} />
      ) : courses.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookIcon width={28} height={28} />}
            title={data.length ? "No active courses" : "No courses yet"}
            message="Create a course so students can find and join it in the mobile app."
            action={
              <Button onClick={() => setCreating(true)}>
                <PlusIcon width={16} height={16} /> Create a course
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      )}

      {creating ? (
        <CourseFormModal open onClose={() => setCreating(false)} onSaved={(c) => router.push(`/courses/${c.id}`)} />
      ) : null}
    </>
  );
}

function CourseCard({ course: c }: { course: LecturerCourse }) {
  return (
    <Link
      href={`/courses/${c.id}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-600">{c.code}</p>
          <p className="mt-0.5 line-clamp-2 font-medium text-slate-900 group-hover:text-brand-700">{c.title}</p>
        </div>
        {c.live_session_id ? <LiveBadge /> : !c.is_active ? <Badge>Archived</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {[c.level && `${c.level} level`, c.units != null && `${c.units} units`, c.semester && `${c.semester} semester`]
          .filter(Boolean)
          .join(" · ") || " "}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 py-2">
          <dt className="text-xs text-slate-500">Students</dt>
          <dd className="text-lg font-semibold text-slate-900">{c.students}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 py-2">
          <dt className="text-xs text-slate-500">Classes</dt>
          <dd className="text-lg font-semibold text-slate-900">{c.sessions}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 py-2">
          <dt className="text-xs text-slate-500">At risk</dt>
          <dd className="text-lg font-semibold text-slate-900">{c.at_risk}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Average attendance</span>
          <AttendanceBadge value={c.avg_attendance_pct} held={c.sessions} />
        </div>
        {c.sessions ? <PctBar value={c.avg_attendance_pct} /> : null}
      </div>
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
        {c.students ? `${c.faces_enrolled} of ${c.students} faces enrolled` : "No students yet"}
        {c.last_session_at ? ` · last class ${formatShortDate(c.last_session_at)}` : ""}
      </p>
    </Link>
  );
}
