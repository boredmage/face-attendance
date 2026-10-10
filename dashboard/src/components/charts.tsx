"use client";

/**
 * Charts (Recharts), following the dataviz method: one validated series hue, 2px lines,
 * bars ≤ 24px with 4px rounded data-ends, recessive hairline grid, hover tooltips, and a
 * thin 75% reference line (the exam-eligibility threshold) instead of a second axis.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CourseBreakdown, TrendPoint } from "@/lib/api";
import { formatDate, pct } from "@/lib/format";

const SERIES = "#2a78d6"; // reference palette slot 1 (validated light-mode blue)
const THRESHOLD = "#94a3b8";
const SURFACE = "#ffffff";

function TooltipBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">{children}</div>;
}

// ---------- Attendance trend ----------
export function TrendChart({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  if (data.length === 0) {
    return <ChartEmpty height={height} message="The trend appears after your first class ends." />;
  }
  return (
    <figure>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} minTickGap={24} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={48} />
            <ReferenceLine y={75} stroke={THRESHOLD} strokeWidth={1} label={{ value: "75%", position: "insideTopRight", fill: "#64748b", fontSize: 11 }} />
            <Tooltip
              cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as TrendPoint | undefined;
                if (!active || !p) return null;
                return (
                  <TooltipBox>
                    <p className="font-semibold text-slate-900">{p.label}</p>
                    <p className="text-slate-500">{formatDate(p.started_at)}</p>
                    <p className="mt-1 text-slate-800">
                      {pct(p.attendance_pct)} · {p.present} of {p.expected} present
                    </p>
                  </TooltipBox>
                );
              }}
            />
            <Line
              type="linear"
              dataKey="attendance_pct"
              stroke={SERIES}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
              activeDot={{ r: 6, fill: SERIES, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">Attendance percentage for each class, oldest to newest.</figcaption>
    </figure>
  );
}

// ---------- Average attendance by course ----------
export function CourseBarChart({ data }: { data: CourseBreakdown[] }) {
  if (data.length === 0) return <ChartEmpty height={200} message="Create a course to see its attendance here." />;
  const height = Math.max(160, data.length * 44 + 40);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="code" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} width={64} />
          <ReferenceLine x={75} stroke={THRESHOLD} strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "#f1f5f9" }}
            content={({ active, payload }) => {
              const c = payload?.[0]?.payload as CourseBreakdown | undefined;
              if (!active || !c) return null;
              return (
                <TooltipBox>
                  <p className="font-semibold text-slate-900">
                    {c.code} · {c.title}
                  </p>
                  <p className="mt-1 text-slate-800">
                    {c.sessions ? `${pct(c.avg_attendance_pct)} average` : "No classes held yet"}
                  </p>
                  <p className="text-slate-500">
                    {c.students} students · {c.sessions} classes
                  </p>
                </TooltipBox>
              );
            }}
          />
          <Bar
            dataKey="avg_attendance_pct"
            fill={SERIES}
            barSize={20}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            label={{ position: "right", fill: "#334155", fontSize: 12, formatter: (v: unknown) => pct(Number(v)) }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Arrival times ----------
const BUCKETS = [
  { label: "0–5", max: 5 },
  { label: "5–10", max: 10 },
  { label: "10–15", max: 15 },
  { label: "15–20", max: 20 },
  { label: "20–30", max: 30 },
  { label: "30–45", max: 45 },
  { label: "45+", max: Infinity },
];

export function ArrivalsChart({ minutes }: { minutes: number[] }) {
  if (minutes.length === 0) return <ChartEmpty height={200} message="Nobody has been marked present yet." />;
  const data = BUCKETS.map((b, i) => {
    const min = i === 0 ? -Infinity : BUCKETS[i - 1].max;
    return { label: b.label, count: minutes.filter((m) => m >= min && m < b.max).length };
  });
  return (
    <figure>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 8, bottom: 4, left: -16 }} barCategoryGap={4}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as { label: string; count: number } | undefined;
                if (!active || !d) return null;
                return (
                  <TooltipBox>
                    <p className="font-semibold text-slate-900">{d.label} min after start</p>
                    <p className="text-slate-800">
                      {d.count} student{d.count === 1 ? "" : "s"}
                    </p>
                  </TooltipBox>
                );
              }}
            />
            <Bar dataKey="count" fill={SERIES} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: "top", fill: "#334155", fontSize: 12, formatter: (v: unknown) => (Number(v) ? String(v) : "") }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-xs text-slate-500">Minutes after the class started when each student was marked.</figcaption>
    </figure>
  );
}

function ChartEmpty({ height, message }: { height: number; message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500" style={{ height }}>
      {message}
    </div>
  );
}
