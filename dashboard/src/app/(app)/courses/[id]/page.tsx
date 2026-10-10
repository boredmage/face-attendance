"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { TrendChart } from "@/components/charts";
import { CourseFormModal } from "@/components/CourseForm";
import { ArrowUpDownIcon, DownloadIcon, FaceIcon, PhoneIcon } from "@/components/icons";
import { SessionsTable } from "@/components/SessionsTable";
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
  Input,
  LiveBadge,
  PageHeader,
  PageSkeleton,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { api, errorText, type CourseStudentRow } from "@/lib/api";
import { formatShortDate, pct } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type SortKey = "matric" | "name" | "pct";

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const courseId = Number(id);
  const router = useRouter();
  const { toast } = useToast();
  const [live, setLive] = useState(false);
  const { data, error, loading, reload } = useApi(
    async () => {
      const d = await api.course(courseId);
      setLive(d.course.live_session_id != null);
      return d;
    },
    `course-${courseId}`,
    live ? 5_000 : 30_000,
  );

  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "archive" | { remove: CourseStudentRow }>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "matric", dir: 1 });
  const [query, setQuery] = useState("");

  const students = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data?.students ?? []).filter(
      (s) => !q || s.full_name.toLowerCase().includes(q) || s.matric_no.toLowerCase().includes(q),
    );
    const value = (s: CourseStudentRow) =>
      sort.key === "pct" ? (s.classes_held ? s.attendance_pct : 101) : sort.key === "name" ? s.full_name : s.matric_no;
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [data, query, sort]);

  if (loading) return <PageSkeleton />;
  if (!data) return <ErrorState message={error ?? "Could not load this course."} onRetry={reload} />;
  const { course } = data;

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
        await api.deleteCourse(course.id);
        toast(`${course.code} deleted`, "success");
        router.replace("/courses");
        return;
      }
      if (confirm === "archive") {
        await api.updateCourse(course.id, { is_active: !course.is_active });
        toast(course.is_active ? `${course.code} archived` : `${course.code} restored`, "success");
      } else {
        await api.removeStudent(course.id, confirm.remove.student_id);
        toast(`${confirm.remove.full_name} removed from ${course.code}`, "success");
      }
      closeConfirm();
      await reload();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.exportCourse(course.id, course.code);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setExporting(false);
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <>
      <PageHeader
        back={{ href: "/courses", label: "Courses" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {course.code}
            <span className="font-normal text-slate-500">{course.title}</span>
            {course.live_session_id ? <LiveBadge /> : null}
            {!course.is_active ? <Badge>Archived</Badge> : null}
          </span>
        }
        subtitle={
          [course.level && `${course.level} level`, course.units != null && `${course.units} units`, course.semester && `${course.semester} semester`]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              <DownloadIcon width={16} height={16} /> Export register (CSV)
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setConfirm("archive")}>
              {course.is_active ? "Archive" : "Unarchive"}
            </Button>
            <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm("delete")}>
              Delete
            </Button>
          </>
        }
      />

      {course.description ? <p className="-mt-3 mb-6 max-w-3xl text-sm text-slate-600">{course.description}</p> : null}

      {course.live_session_id ? (
        <Link
          href={`/sessions/${course.live_session_id}`}
          className="mb-6 flex items-center gap-3 rounded-xl border border-red-200 bg-white px-5 py-4 text-sm shadow-sm hover:shadow-md"
        >
          <LiveBadge />
          <span className="font-medium text-slate-900">A class is in progress.</span>
          <span className="text-slate-500">
            {data.sessions[0]?.is_live ? `${data.sessions[0].present} of ${data.sessions[0].expected} present so far.` : ""} Open live view →
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Students" value={course.students} />
        <StatTile label="Faces enrolled" value={`${course.faces_enrolled}/${course.students}`} hint="Needed to be scanned" />
        <StatTile label="Classes held" value={course.sessions} />
        <StatTile label="Avg attendance" value={course.sessions ? pct(course.avg_attendance_pct) : "—"} />
        <StatTile label="At risk (<75%)" value={course.at_risk} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Attendance per class" subtitle="Share of registered students present at each class" />
        <div className="p-4">
          <TrendChart data={data.trend} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={`Registered students (${data.students.length})`}
          subtitle="Students join from the mobile app's course catalogue"
          action={
            data.students.length ? (
              <Input
                type="search"
                placeholder="Search name or matric no."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-64 max-w-full"
                aria-label="Search students"
              />
            ) : null
          }
        />
        {data.students.length === 0 ? (
          <EmptyState
            icon={<FaceIcon width={28} height={28} />}
            title="No students yet"
            message={`Students find ${course.code} in the app's course catalogue after registering and enrolling their face. You'll get a notification when someone joins.`}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <SortTh label="Matric no." dir={sort.dir} active={sort.key === "matric"} onClick={() => toggleSort("matric")} />
                <SortTh label="Name" dir={sort.dir} active={sort.key === "name"} onClick={() => toggleSort("name")} />
                <Th>Face</Th>
                <Th>Joined</Th>
                <Th className="text-right">Attended</Th>
                <SortTh label="Attendance" dir={sort.dir} active={sort.key === "pct"} onClick={() => toggleSort("pct")} />
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.student_id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap tabular-nums">{s.matric_no}</Td>
                  <Td>
                    <p className="font-medium text-slate-900">{s.full_name}</p>
                    <p className="text-xs text-slate-500">
                      {s.department} · {s.level} level
                    </p>
                  </Td>
                  <Td>{s.face_enrolled ? <Badge tone="good">Enrolled</Badge> : <Badge tone="warn">Not enrolled</Badge>}</Td>
                  <Td className="whitespace-nowrap">{formatShortDate(s.joined_at)}</Td>
                  <Td className="text-right tabular-nums">
                    {s.classes_attended}/{s.classes_held}
                  </Td>
                  <Td>
                    <AttendanceBadge value={s.attendance_pct} held={s.classes_held} />
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm({ remove: s })}>
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
              {students.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="py-8 text-center text-slate-500">
                    No student matches “{query}”.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title={`Classes (${data.sessions.length})`} subtitle="Click a class to see who was present" />
        {data.sessions.length ? (
          <SessionsTable sessions={data.sessions} showCourse={false} />
        ) : (
          <EmptyState
            icon={<PhoneIcon width={28} height={28} />}
            title="No classes yet"
            message={`Sign in to the mobile app with your lecturer account and tap Start class on ${course.code}.`}
          />
        )}
      </Card>

      {editing ? (
        <CourseFormModal
          open
          course={course}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("Course updated", "success");
            void reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        onClose={closeConfirm}
        onConfirm={runConfirm}
        busy={busy}
        error={actionError}
        danger={confirm === "delete" || (typeof confirm === "object" && confirm !== null)}
        title={
          confirm === "delete"
            ? `Delete ${course.code}?`
            : confirm === "archive"
              ? course.is_active
                ? `Archive ${course.code}?`
                : `Restore ${course.code}?`
              : "Remove student?"
        }
        confirmLabel={confirm === "delete" ? "Delete course" : confirm === "archive" ? (course.is_active ? "Archive" : "Restore") : "Remove"}
        message={
          confirm === "delete" ? (
            course.sessions || data.sessions.length ? (
              "This course already has classes, so it can't be deleted. Archive it instead to keep its attendance records."
            ) : (
              "The course and its student registrations will be permanently deleted."
            )
          ) : confirm === "archive" ? (
            course.is_active ? (
              "Archived courses disappear from the student app's catalogue and can't start new classes. All records are kept."
            ) : (
              "The course will appear in the student catalogue again."
            )
          ) : confirm && typeof confirm === "object" ? (
            <>
              <strong>{confirm.remove.full_name}</strong> ({confirm.remove.matric_no}) will be removed from {course.code}, along
              with their attendance record in this course.
            </>
          ) : null
        }
      />
    </>
  );
}

function SortTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <Th aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 uppercase ${active ? "text-slate-900" : ""}`}>
        {label}
        <ArrowUpDownIcon width={12} height={12} />
      </button>
    </Th>
  );
}
