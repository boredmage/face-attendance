"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ListIcon } from "@/components/icons";
import { SessionsTable } from "@/components/SessionsTable";
import { Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatTile } from "@/components/ui";
import { api } from "@/lib/api";
import { pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function SessionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SessionLogs />
    </Suspense>
  );
}

function SessionLogs() {
  const router = useRouter();
  const params = useSearchParams();
  const courseId = Number(params.get("course")) || undefined;
  const stateParam = params.get("state");
  const state = stateParam === "live" || stateParam === "ended" ? stateParam : undefined;

  const courses = useApi(api.courses, "courses");
  const { data, error, loading, reload } = useApi(
    () => api.sessions({ course_id: courseId, state }),
    `sessions-${courseId ?? "all"}-${state ?? "all"}`,
    15_000,
  );

  const setFilter = (key: "course" | "state", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(`/sessions${qs ? `?${qs}` : ""}`);
  };

  const ended = (data ?? []).filter((s) => !s.is_live);
  const present = ended.reduce((n, s) => n + s.present, 0);
  const expected = ended.reduce((n, s) => n + s.expected, 0);

  return (
    <>
      <PageHeader title="Class logs" subtitle="Every class you've taken attendance for, newest first." />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">
          <span className="mb-1 block font-medium">Course</span>
          <Select value={courseId ?? ""} onChange={(e) => setFilter("course", e.target.value)} className="w-56">
            <option value="">All courses</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm text-slate-600">
          <span className="mb-1 block font-medium">Status</span>
          <Select value={state ?? ""} onChange={(e) => setFilter("state", e.target.value)} className="w-40">
            <option value="">All classes</option>
            <option value="live">Live now</option>
            <option value="ended">Ended</option>
          </Select>
        </label>
      </div>

      {data && data.length ? (
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Classes" value={data.length} />
          <StatTile label="Live now" value={data.length - ended.length} />
          <StatTile label="Check-ins" value={present} hint="In ended classes" />
          <StatTile label="Avg attendance" value={expected ? pct(Math.round((present * 1000) / expected) / 10) : "—"} />
        </div>
      ) : null}

      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data ? (
          <div className="p-4">
            <ErrorState message={error ?? "Could not load class logs."} onRetry={reload} />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={<ListIcon width={28} height={28} />}
            title="No classes found"
            message={
              courseId || state
                ? "Try a different filter."
                : "Classes appear here once you start one from the mobile app with your lecturer account."
            }
          />
        ) : (
          <SessionsTable sessions={data} />
        )}
      </Card>
    </>
  );
}
