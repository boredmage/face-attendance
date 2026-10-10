"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { ArrivalsChart } from "@/components/charts";
import { DownloadIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import {
  AttendanceBadge,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LiveBadge,
  PageHeader,
  PageSkeleton,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { api, errorText, type PresentRow } from "@/lib/api";
import { formatDate, formatDuration, formatTime, pct, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const METHOD: Record<string, { label: string; tone: "brand" | "neutral" | "warn" }> = {
  face: { label: "Face scan", tone: "brand" },
  manual: { label: "Manual", tone: "warn" },
  seed: { label: "Imported", tone: "neutral" },
};

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const router = useRouter();
  const { toast } = useToast();
  const [live, setLive] = useState(false);
  const { data, error, loading, reload } = useApi(
    async () => {
      const d = await api.session(sessionId);
      setLive(d.session.is_live);
      return d;
    },
    `session-${sessionId}`,
    live ? 5_000 : null,
  );
  const [confirm, setConfirm] = useState<null | "end" | "delete" | { unmark: PresentRow }>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading) return <PageSkeleton />;
  if (!data) return <ErrorState message={error ?? "Could not load this class."} onRetry={reload} />;
  const s = data.session;

  const closeConfirm = () => {
    setConfirm(null);
    setActionError(null);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirm === "delete") {
        await api.deleteSession(s.id);
        toast("Class deleted", "success");
        router.replace(`/courses/${s.course_id}`);
        return;
      }
      if (confirm === "end") {
        await api.endSession(s.id);
        toast(`${s.course_code} class ended`, "success");
      } else {
        await api.unmark(s.id, confirm.unmark.student_id);
        toast(`${confirm.unmark.full_name} marked absent`, "success");
      }
      closeConfirm();
      await reload();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const markPresent = async (studentId: number, name: string) => {
    setPending(studentId);
    try {
      await api.markPresent(s.id, studentId);
      toast(`${name} marked present`, "success");
      await reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setPending(null);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportSession(s.id);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setExporting(false);
    }
  };

  const faceScans = data.present.filter((p) => p.confidence != null);
  const avgConfidence = faceScans.length ? faceScans.reduce((n, p) => n + (p.confidence ?? 0), 0) / faceScans.length : null;
  const onTime = data.present.filter((p) => p.minutes_after_start <= 15).length;

  return (
    <>
      <PageHeader
        back={{ href: `/courses/${s.course_id}`, label: s.course_code }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.course_code} class
            {s.is_live ? <LiveBadge /> : null}
          </span>
        }
        subtitle={
          <>
            {formatDate(s.started_at)} · {formatTime(s.started_at)}
            {s.ended_at ? ` – ${formatTime(s.ended_at)}` : ` · started ${timeAgo(s.started_at)}`}
            {s.venue ? ` · ${s.venue}` : ""}
            {s.topic ? ` · ${s.topic}` : ""}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <DownloadIcon width={16} height={16} /> Export CSV
            </Button>
            {s.is_live ? (
              <Button onClick={() => setConfirm("end")}>End class</Button>
            ) : null}
            <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm("delete")}>
              Delete
            </Button>
          </>
        }
      />

      {s.is_live ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          This class is live. Students scanned on your phone appear here within a few seconds.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Present" value={`${s.present} / ${s.expected}`} />
        <StatTile label="Attendance" value={s.expected ? pct(s.attendance_pct) : "—"} />
        <StatTile label="Duration" value={s.is_live ? "In progress" : formatDuration(s.duration_minutes)} />
        <StatTile label="Within 15 min" value={data.present.length ? `${onTime}` : "—"} hint="Students marked in the first 15 minutes" />
        <StatTile label="Avg match confidence" value={avgConfidence != null ? `${Math.round(avgConfidence * 100)}%` : "—"} hint="Face scans only" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title={`Present (${data.present.length})`} subtitle="In the order they were marked" />
          {data.present.length === 0 ? (
            <EmptyState title="Nobody marked yet" message={s.is_live ? "Scan students' faces from the app on your phone." : undefined} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Time</Th>
                  <Th className="text-right">After start</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Confidence</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.present.map((p) => {
                  const m = METHOD[p.method] ?? { label: p.method, tone: "neutral" as const };
                  return (
                    <tr key={p.student_id}>
                      <Td>
                        <p className="font-medium text-slate-900">{p.full_name}</p>
                        <p className="text-xs text-slate-500">{p.matric_no}</p>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatTime(p.marked_at)}</Td>
                      <Td className="text-right tabular-nums">{p.minutes_after_start} min</Td>
                      <Td>
                        <Badge tone={m.tone}>{m.label}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{p.confidence != null ? `${Math.round(p.confidence * 100)}%` : "—"}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm({ unmark: p })}>
                          Remove
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Arrivals" subtitle="When students were marked present" />
            <div className="p-4">
              <ArrivalsChart minutes={data.present.map((p) => p.minutes_after_start)} />
            </div>
          </Card>

          <Card>
            <CardHeader title={`Absent (${data.absent.length})`} subtitle="Mark a student present if the camera couldn't" />
            {data.absent.length === 0 ? (
              <EmptyState title={s.expected ? "Everyone is here" : "No students registered"} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.absent.map((a) => (
                  <li key={a.student_id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{a.full_name}</p>
                      <p className="text-xs text-slate-500">
                        {a.matric_no}
                        {a.face_enrolled ? "" : " · face not enrolled"}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" loading={pending === a.student_id} onClick={() => markPresent(a.student_id, a.full_name)}>
                      Mark present
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Course:{" "}
        <Link href={`/courses/${s.course_id}`} className="font-medium text-brand-600 hover:underline">
          {s.course_code} · {s.course_title}
        </Link>
        {" · "}
        <AttendanceBadge value={s.attendance_pct} held={s.expected === 0 ? 0 : undefined} />
      </p>

      <ConfirmDialog
        open={confirm !== null}
        onClose={closeConfirm}
        onConfirm={runConfirm}
        busy={busy}
        error={actionError}
        danger={confirm !== "end"}
        title={confirm === "end" ? "End this class?" : confirm === "delete" ? "Delete this class?" : "Remove attendance mark?"}
        confirmLabel={confirm === "end" ? "End class" : confirm === "delete" ? "Delete class" : "Mark absent"}
        message={
          confirm === "end"
            ? "No more students can be scanned into this class. Students who weren't marked count as absent."
            : confirm === "delete"
              ? "Use this for a class started by mistake. The class and all its attendance marks will be permanently deleted."
              : confirm && typeof confirm === "object"
                ? `${confirm.unmark.full_name} (${confirm.unmark.matric_no}) will be marked absent for this class.`
                : null
        }
      />
    </>
  );
}
