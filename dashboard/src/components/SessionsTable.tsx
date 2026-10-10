"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { SessionSummary } from "@/lib/api";
import { formatDate, formatDuration, formatTime } from "@/lib/format";

import { AttendanceBadge, LiveBadge, Table, Td, Th } from "./ui";

/** Class logs table. Rows open the session page. */
export function SessionsTable({ sessions, showCourse = true }: { sessions: SessionSummary[]; showCourse?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          {showCourse ? <Th>Course</Th> : null}
          <Th>Time</Th>
          <Th>Duration</Th>
          <Th>Venue / topic</Th>
          <Th className="text-right">Present</Th>
          <Th>Attendance</Th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr
            key={s.id}
            onClick={() => router.push(`/sessions/${s.id}`)}
            className="cursor-pointer hover:bg-slate-50"
          >
            <Td className="whitespace-nowrap">
              <Link href={`/sessions/${s.id}`} className="font-medium text-slate-900 hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                {formatDate(s.started_at)}
              </Link>
            </Td>
            {showCourse ? (
              <Td>
                <span className="font-medium text-brand-600">{s.course_code}</span>
              </Td>
            ) : null}
            <Td className="whitespace-nowrap tabular-nums">
              {formatTime(s.started_at)}
              {s.ended_at ? ` – ${formatTime(s.ended_at)}` : ""}
            </Td>
            <Td className="whitespace-nowrap">{s.is_live ? <LiveBadge /> : formatDuration(s.duration_minutes)}</Td>
            <Td className="max-w-[16rem] truncate text-slate-500">{[s.venue, s.topic].filter(Boolean).join(" · ") || "—"}</Td>
            <Td className="text-right tabular-nums">
              {s.present}/{s.expected}
            </Td>
            <Td>
              <AttendanceBadge value={s.attendance_pct} held={s.expected === 0 ? 0 : undefined} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
