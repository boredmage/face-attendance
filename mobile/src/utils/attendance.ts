import { ATTENDANCE_WARN } from '@/config';

export type Tone = 'success' | 'warning' | 'danger';

/** Colour tone for one course's attendance: green when eligible for the exam, amber when close, red otherwise. */
export function attendanceTone(pct: number, held: number, requiredPct = 75): Tone {
  if (!held || pct >= requiredPct) return 'success';
  if (pct >= ATTENDANCE_WARN) return 'warning';
  return 'danger';
}

/** One-line explanation of where the student stands for a course's exam. */
export function standingText(c: {
  classes_held: number;
  eligible: boolean;
  classes_to_qualify: number;
  can_miss: number;
  required_pct: number;
}): string {
  if (!c.classes_held) return 'No classes held yet.';
  if (!c.eligible) {
    const n = c.classes_to_qualify;
    return `Below ${c.required_pct}%. Attend the next ${n} class${n === 1 ? '' : 'es'} in a row to qualify.`;
  }
  if (c.can_miss === 0) return `Exactly at the limit — missing the next class drops you below ${c.required_pct}%.`;
  return `You can miss ${c.can_miss} more class${c.can_miss === 1 ? '' : 'es'} in a row and still qualify.`;
}

/** ISO timestamp -> "09:05" in the phone's local time */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** ISO timestamp -> "Sun, 6 Sep 2026" in the phone's local time */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Milliseconds -> "1:05:09" or "5:09" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
