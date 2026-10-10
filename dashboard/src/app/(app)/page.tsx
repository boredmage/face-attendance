"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CourseBarChart, TrendChart } from "@/components/charts";
import { CourseFormModal } from "@/components/CourseForm";
import { BookIcon, FaceIcon, PhoneIcon, PlusIcon } from "@/components/icons";
import { SessionsTable } from "@/components/SessionsTable";
import {
  AttendanceBadge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LiveBadge,
  PageHeader,
  PageSkeleton,
  PctBar,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { api, type LecturerOverview, type SessionSummary } from "@/lib/api";
import { formatTime, pct, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function OverviewPage() {
  const router = useRouter();
  const [live, setLive] = useState(false);
  // Refresh every 5 s while a class is live so the count grows as students are scanned; every 15 s
  // otherwise so a class started from the phone shows up quickly
  const { data, error, loading, reload } = useApi(
    async () => {
      const o = await api.overview();
      setLive(o.live_sessions.length > 0);
      return o;
    },
    "overview",
    live ? 5_000 : 15_000,
  );
  const [creating, setCreating] = useState(false);

  if (loading) return <PageSkeleton />;
  if (!data) return <ErrorState message={error ?? "Could not load the overview."} onRetry={reload} />;

  const name = data.lecturer.display_name;
  const createModal = creating ? (
    <CourseFormModal open onClose={() => setCreating(false)} onSaved={(c) => router.push(`/courses/${c.id}`)} />
  ) : null;

  if (data.total_courses === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${name}`} subtitle="Let's get your first class set up." />
        <Onboarding onCreate={() => setCreating(true)} />
        {createModal}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        subtitle={`${data.lecturer.department}${data.lecturer.faculty ? ` · Faculty of ${data.lecturer.faculty}` : ""}`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon width={16} height={16} /> New course
          </Button>
        }
      />
      {error ? <p className="mb-4 text-sm text-amber-700">Showing the last loaded data: {error}</p> : null}

      {data.live_sessions.map((s) => (
        <LiveClassCard key={s.id} session={s} />
      ))}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Courses" value={data.total_courses} hint={`${data.active_courses} active`} />
        <StatTile label="Students" value={data.total_students} hint={`${data.faces_enrolled} with face enrolled`} />
        <StatTile label="Classes held" value={data.total_sessions} />
        <StatTile label="Avg attendance" value={data.total_sessions ? pct(data.avg_attendance_pct) : "—"} hint="Across ended classes" />
        <StatTile label="Check-ins" value={data.total_checkins} hint="Students marked present" />
        <StatTile label="This week" value={data.sessions_this_week} hint="Classes in the last 7 days" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Attendance trend" subtitle="Share of expected students present in each of your recent classes" />
          <div className="p-4">
            <TrendChart data={data.trend} />
          </div>
        </Card>
        <Card>
          <CardHeader title="By course" subtitle="Average attendance per course" />
          <div className="p-4">
            <CourseBarChart data={data.by_course} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Students at risk"
            subtitle="Below 75% attendance: may be barred from the exam"
          />
          <AtRisk data={data} />
        </Card>
        <Card>
          <CardHeader title="By weekday" subtitle="Average attendance on each teaching day" />
          <Weekdays data={data} />
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Recent classes"
          action={
            <Link href="/sessions" className="text-sm font-medium text-brand-600 hover:underline">
              All class logs →
            </Link>
          }
        />
        {data.recent_sessions.length ? (
          <SessionsTable sessions={data.recent_sessions} />
        ) : (
          <EmptyState
            icon={<PhoneIcon width={28} height={28} />}
            title="No classes yet"
            message="Sign in to the mobile app with your lecturer account and tap Start class on a course."
          />
        )}
      </Card>
      {createModal}
    </>
  );
}

function LiveClassCard({ session: s }: { session: SessionSummary }) {
  return (
    <Link
      href={`/sessions/${s.id}`}
      className="mb-6 block rounded-xl border border-red-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-3">
        <LiveBadge />
        <p className="font-semibold text-slate-900">
          {s.course_code} · {s.course_title}
        </p>
        <p className="text-sm text-slate-500">
          Started {formatTime(s.started_at)} ({timeAgo(s.started_at)}){s.venue ? ` · ${s.venue}` : ""}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className="text-4xl font-semibold text-slate-900 tabular-nums">
            {s.present}
            <span className="text-xl font-normal text-slate-400"> / {s.expected}</span>
          </p>
          <p className="text-sm text-slate-500">students marked present so far</p>
        </div>
        <div className="min-w-[12rem] flex-1">
          <PctBar value={s.attendance_pct} />
          <p className="mt-1 text-xs text-slate-500">Updates every 5 seconds · open the class to see who is here</p>
        </div>
      </div>
    </Link>
  );
}

function AtRisk({ data }: { data: LecturerOverview }) {
  if (data.at_risk.length === 0) {
    return <EmptyState title="Nobody is below 75%" message="Every student is on track in every course." />;
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Student</Th>
          <Th>Course</Th>
          <Th className="text-right">Attended</Th>
          <Th>Attendance</Th>
        </tr>
      </thead>
      <tbody>
        {data.at_risk.map((a) => (
          <tr key={`${a.student_id}-${a.course_id}`}>
            <Td>
              <p className="font-medium text-slate-900">{a.full_name}</p>
              <p className="text-xs text-slate-500">{a.matric_no}</p>
            </Td>
            <Td>
              <Link href={`/courses/${a.course_id}`} className="font-medium text-brand-600 hover:underline">
                {a.course_code}
              </Link>
            </Td>
            <Td className="text-right tabular-nums">
              {a.classes_attended}/{a.classes_held}
            </Td>
            <Td>
              <AttendanceBadge value={a.attendance_pct} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Weekdays({ data }: { data: LecturerOverview }) {
  if (data.by_weekday.length === 0) return <EmptyState title="No classes held yet" />;
  return (
    <ul className="divide-y divide-slate-100">
      {data.by_weekday.map((w) => (
        <li key={w.weekday} className="flex items-center gap-4 px-5 py-3">
          <span className="w-10 text-sm font-medium text-slate-900">{w.weekday}</span>
          <div className="flex-1">
            <PctBar value={w.avg_attendance_pct} />
          </div>
          <span className="w-14 text-right text-sm tabular-nums text-slate-900">{pct(w.avg_attendance_pct)}</span>
          <span className="w-20 text-right text-xs text-slate-500">
            {w.sessions} class{w.sessions === 1 ? "" : "es"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Onboarding({ onCreate }: { onCreate: () => void }) {
  const steps = [
    { icon: BookIcon, title: "Create a course", text: "Add each course you teach, with its code and title." },
    { icon: FaceIcon, title: "Students join in the app", text: "Students register, enrol their face, and join your course. You're notified here." },
    { icon: PhoneIcon, title: "Start class from your phone", text: "Sign in to the app as a lecturer, tap Start class, and scan each student's face." },
  ];
  return (
    <Card>
      <div className="grid gap-6 p-6 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <div key={title} className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Step {i + 1}</p>
              <p className="font-medium text-slate-900">{title}</p>
              <p className="mt-1 text-sm text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center border-t border-slate-100 px-6 py-5">
        <Button onClick={onCreate}>
          <PlusIcon width={16} height={16} /> Create your first course
        </Button>
      </div>
    </Card>
  );
}
