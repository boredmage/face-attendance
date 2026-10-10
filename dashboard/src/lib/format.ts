/** Date/number formatting. API timestamps carry an offset, so `new Date()` yields local time. */

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  return `${formatShortDate(iso)}, ${formatTime(iso)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatShortDate(iso);
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function pct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export type AttendanceLevel = "good" | "warn" | "bad";

/** Same thresholds as the mobile app: ≥75 good, 50–74 warning, <50 at serious risk. */
export function attendanceLevel(value: number): AttendanceLevel {
  if (value >= 75) return "good";
  if (value >= 50) return "warn";
  return "bad";
}
