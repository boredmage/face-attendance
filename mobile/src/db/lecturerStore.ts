/**
 * The lecturer device's local data: what the attendance screens read and write.
 *
 * Works with no network at all. Every change (start/end a class, mark/unmark a student) is written
 * together with an outbox operation in one transaction; src/sync/syncManager.ts sends the outbox
 * to the server and applies the server's changes back with `applyPull`.
 */
import * as Crypto from 'expo-crypto';

import { EMBEDDING_SIZE, MODEL_VERSION } from '@/face/config';
import { FaceIndex, decodeEmbeddings } from '@/face/matcher';

import { getDb } from './database';

/** Classes still running this long after they started are ended automatically (same as the server). */
export const SESSION_AUTO_END_HOURS = 4;
const KEEP_ENDED_SESSIONS_MS = 2 * 24 * 3600_000;

export type OpType = 'session.start' | 'session.end' | 'attendance.mark' | 'attendance.unmark';

export interface LocalCourse {
  id: number;
  code: string;
  title: string;
  students: number;
  facesReady: number;
  needsUpdate: number;
  liveSessionUuid: string | null;
}

export interface LocalSession {
  uuid: string;
  course_id: number;
  course_code: string;
  course_title: string;
  started_at: string;
  ended_at: string | null;
  venue: string | null;
  topic: string | null;
}

export interface RosterStudent {
  id: number;
  matric_no: string;
  full_name: string;
  hasFace: boolean;
  marked: boolean;
}

export interface PresentStudent {
  student_id: number;
  matric_no: string;
  full_name: string;
  marked_at: string;
  method: 'face' | 'manual';
}

export interface SessionCounts {
  present: number;
  expected: number;
}

export interface OutboxOp {
  seq: number;
  op_id: string;
  type: OpType;
  payload: Record<string, unknown>;
  attempts: number;
}

const nowIso = () => new Date().toISOString();

async function enqueue(type: OpType, payload: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO outbox (op_id, type, payload, created_at) VALUES (?, ?, ?, ?)`,
    Crypto.randomUUID(),
    type,
    JSON.stringify(payload),
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listCourses(): Promise<LocalCourse[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    code: string;
    title: string;
    students: number;
    faces_ready: number;
    needs_update: number;
    live: string | null;
  }>(
    `SELECT c.id, c.code, c.title,
            COUNT(e.student_id) AS students,
            COALESCE(SUM(CASE WHEN s.face IS NOT NULL AND s.face_model = ? THEN 1 ELSE 0 END), 0) AS faces_ready,
            COALESCE(SUM(CASE WHEN s.needs_update = 1 THEN 1 ELSE 0 END), 0) AS needs_update,
            (SELECT uuid FROM sessions WHERE course_id = c.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) AS live
     FROM courses c
     LEFT JOIN enrollments e ON e.course_id = c.id
     LEFT JOIN students s ON s.id = e.student_id
     WHERE c.is_active = 1
     GROUP BY c.id
     ORDER BY c.code`,
    MODEL_VERSION,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    students: r.students,
    facesReady: r.faces_ready,
    needsUpdate: r.needs_update,
    liveSessionUuid: r.live,
  }));
}

export async function hasAnyData(): Promise<boolean> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM courses`))!.n > 0;
}

export async function getSession(uuid: string): Promise<LocalSession | null> {
  const db = await getDb();
  return db.getFirstAsync<LocalSession>(
    `SELECT s.uuid, s.course_id, c.code AS course_code, c.title AS course_title, s.started_at, s.ended_at, s.venue, s.topic
     FROM sessions s JOIN courses c ON c.id = s.course_id WHERE s.uuid = ?`,
    uuid,
  );
}

export async function liveSession(): Promise<LocalSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ uuid: string }>(
    `SELECT uuid FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
  );
  return row ? getSession(row.uuid) : null;
}

/** Present / expected, with the server's rule: expected = every student enrolled in the course. */
export async function sessionCounts(uuid: string): Promise<SessionCounts> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ present: number; expected: number }>(
    `SELECT
       (SELECT COUNT(*) FROM marks m JOIN enrollments e ON e.student_id = m.student_id AND e.course_id = s.course_id
        WHERE m.session_uuid = s.uuid) AS present,
       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id) AS expected
     FROM sessions s WHERE s.uuid = ?`,
    uuid,
  );
  return row ?? { present: 0, expected: 0 };
}

export async function presentStudents(uuid: string): Promise<PresentStudent[]> {
  const db = await getDb();
  return db.getAllAsync<PresentStudent>(
    `SELECT m.student_id, st.matric_no, st.full_name, m.marked_at, m.method
     FROM marks m JOIN students st ON st.id = m.student_id
     WHERE m.session_uuid = ? ORDER BY m.marked_at DESC`,
    uuid,
  );
}

/** Students of the session's course, for the manual "mark by matric number" fallback. */
export async function roster(uuid: string, query: string): Promise<RosterStudent[]> {
  const db = await getDb();
  const q = `%${query.trim().toUpperCase()}%`;
  const rows = await db.getAllAsync<{ id: number; matric_no: string; full_name: string; has_face: number; marked: number }>(
    `SELECT st.id, st.matric_no, st.full_name,
            (st.face IS NOT NULL AND st.face_model = ?) AS has_face,
            EXISTS (SELECT 1 FROM marks m WHERE m.session_uuid = s.uuid AND m.student_id = st.id) AS marked
     FROM sessions s
     JOIN enrollments e ON e.course_id = s.course_id
     JOIN students st ON st.id = e.student_id
     WHERE s.uuid = ? AND (UPPER(st.matric_no) LIKE ? OR UPPER(st.full_name) LIKE ?)
     ORDER BY st.matric_no LIMIT 50`,
    MODEL_VERSION,
    uuid,
    q,
    q,
  );
  return rows.map((r) => ({ id: r.id, matric_no: r.matric_no, full_name: r.full_name, hasFace: !!r.has_face, marked: !!r.marked }));
}

export async function student(id: number): Promise<{ id: number; matric_no: string; full_name: string } | null> {
  const db = await getDb();
  return db.getFirstAsync(`SELECT id, matric_no, full_name FROM students WHERE id = ?`, id);
}

/** Every recognisable face in a course, packed for 1:N search. */
export async function faceIndex(courseId: number): Promise<FaceIndex> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; face: Uint8Array }>(
    `SELECT st.id, st.face FROM enrollments e JOIN students st ON st.id = e.student_id
     WHERE e.course_id = ? AND st.face IS NOT NULL AND st.face_model = ?`,
    courseId,
    MODEL_VERSION,
  );
  return new FaceIndex(
    rows.map((r) => {
      const buf = new ArrayBuffer(r.face.byteLength);
      new Uint8Array(buf).set(r.face);
      return { studentId: r.id, poses: new Float32Array(buf) };
    }),
  );
}

// ---------------------------------------------------------------------------
// Writes (each one also queues an outbox operation)
// ---------------------------------------------------------------------------
export class LocalError extends Error {}

export async function startSession(courseId: number, venue?: string, topic?: string): Promise<string> {
  const db = await getDb();
  const running = await liveSession();
  if (running) throw new LocalError(`${running.course_code} is still in progress. End it before starting another class.`);
  const uuid = Crypto.randomUUID();
  const startedAt = nowIso();
  const v = venue?.trim() || null;
  const t = topic?.trim() || null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sessions (uuid, course_id, started_at, venue, topic) VALUES (?, ?, ?, ?, ?)`,
      uuid,
      courseId,
      startedAt,
      v,
      t,
    );
    await enqueue('session.start', { uuid, course_id: courseId, started_at: startedAt, venue: v, topic: t });
  });
  return uuid;
}

export async function endSession(uuid: string, endedAt: string = nowIso()): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(`UPDATE sessions SET ended_at = ? WHERE uuid = ? AND ended_at IS NULL`, endedAt, uuid);
    if (r.changes) await enqueue('session.end', { uuid, ended_at: endedAt });
  });
}

/** End classes left running for longer than SESSION_AUTO_END_HOURS (at start + that many hours). */
export async function autoEndStaleSessions(): Promise<void> {
  const db = await getDb();
  const limitMs = SESSION_AUTO_END_HOURS * 3600_000;
  const open = await db.getAllAsync<{ uuid: string; started_at: string }>(`SELECT uuid, started_at FROM sessions WHERE ended_at IS NULL`);
  for (const s of open) {
    const started = new Date(s.started_at).getTime();
    if (Date.now() - started > limitMs) await endSession(s.uuid, new Date(started + limitMs).toISOString());
  }
}

export async function markPresent(
  sessionUuid: string,
  studentId: number,
  method: 'face' | 'manual',
  confidence: number | null,
): Promise<'marked' | 'already_marked'> {
  const db = await getDb();
  let result: 'marked' | 'already_marked' = 'already_marked';
  const markedAt = nowIso();
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT OR IGNORE INTO marks (session_uuid, student_id, marked_at, method, confidence) VALUES (?, ?, ?, ?, ?)`,
      sessionUuid,
      studentId,
      markedAt,
      method,
      confidence,
    );
    if (r.changes) {
      result = 'marked';
      await enqueue('attendance.mark', {
        session_uuid: sessionUuid,
        student_id: studentId,
        marked_at: markedAt,
        method,
        confidence: confidence == null ? null : Math.round(confidence * 10_000) / 10_000,
      });
    }
  });
  return result;
}

export async function unmark(sessionUuid: string, studentId: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(`DELETE FROM marks WHERE session_uuid = ? AND student_id = ?`, sessionUuid, studentId);
    if (r.changes) await enqueue('attendance.unmark', { session_uuid: sessionUuid, student_id: studentId });
  });
}

// ---------------------------------------------------------------------------
// Outbox (used by the sync manager)
// ---------------------------------------------------------------------------
export async function pendingOps(limit: number): Promise<OutboxOp[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ seq: number; op_id: string; type: OpType; payload: string; attempts: number }>(
    `SELECT seq, op_id, type, payload, attempts FROM outbox WHERE state = 'pending' ORDER BY seq LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

export async function outboxCounts(): Promise<{ pending: number; rejected: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ pending: number; rejected: number }>(
    `SELECT COALESCE(SUM(state = 'pending'), 0) AS pending, COALESCE(SUM(state = 'rejected'), 0) AS rejected FROM outbox`,
  );
  return row ?? { pending: 0, rejected: 0 };
}

export async function rejectedOps(): Promise<{ op_id: string; type: OpType; reason: string | null; created_at: string }[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT op_id, type, reason, created_at FROM outbox WHERE state = 'rejected' ORDER BY seq DESC LIMIT 50`);
}

export async function dismissRejected(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE state = 'rejected'`);
}

export async function settleOps(results: { op_id: string; status: 'applied' | 'rejected'; reason?: string | null }[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of results) {
      if (r.status === 'applied') await db.runAsync(`DELETE FROM outbox WHERE op_id = ?`, r.op_id);
      else await db.runAsync(`UPDATE outbox SET state = 'rejected', reason = ? WHERE op_id = ?`, r.reason ?? null, r.op_id);
    }
  });
}

export async function bumpAttempts(opIds: string[]): Promise<void> {
  if (!opIds.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE op_id IN (${opIds.map(() => '?').join(',')})`, ...opIds);
}

// ---------------------------------------------------------------------------
// Applying the server's changes
// ---------------------------------------------------------------------------
export interface PullPayload {
  full: boolean;
  courses: { id: number; code: string; title: string; is_active: boolean }[];
  students: {
    id: number;
    matric_no: string;
    full_name: string;
    face: { model: string; poses: number; data: string } | null;
    needs_update: boolean;
  }[];
  enrollments: { course_id: number; student_id: number; joined_at: string }[];
  sessions: { uuid: string; course_id: number; started_at: string; ended_at: string | null; venue: string | null; topic: string | null }[];
  marks: { session_uuid: string; student_id: number; marked_at: string; method: string }[];
  deleted: { courses: number[]; enrollments: [number, number][]; sessions: string[]; marks: [string, number][] };
}

export interface PullOutcome {
  /** Live classes on this phone that were ended or deleted on the dashboard */
  endedElsewhere: string[];
}

export async function applyPull(p: PullPayload): Promise<PullOutcome> {
  const db = await getDb();
  const endedElsewhere: string[] = [];
  await db.withTransactionAsync(async () => {
    if (p.full) {
      // A full snapshot replaces the mirrored rosters. Local sessions/marks are kept: they may not
      // be synced yet.
      await db.execAsync(`DELETE FROM enrollments; DELETE FROM students; DELETE FROM courses;`);
    }
    for (const c of p.courses) {
      await db.runAsync(
        `INSERT OR REPLACE INTO courses (id, code, title, is_active) VALUES (?, ?, ?, ?)`,
        c.id,
        c.code,
        c.title,
        c.is_active ? 1 : 0,
      );
    }
    for (const s of p.students) {
      let blob: Uint8Array | null = null;
      if (s.face && s.face.model === MODEL_VERSION) {
        const vec = decodeEmbeddings(s.face.data);
        if (vec.length === s.face.poses * EMBEDDING_SIZE) blob = new Uint8Array(vec.buffer);
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO students (id, matric_no, full_name, face_model, face, needs_update) VALUES (?, ?, ?, ?, ?, ?)`,
        s.id,
        s.matric_no,
        s.full_name,
        blob ? MODEL_VERSION : null,
        blob,
        s.needs_update || (s.face != null && !blob) ? 1 : 0,
      );
    }
    for (const e of p.enrollments) {
      await db.runAsync(
        `INSERT OR REPLACE INTO enrollments (course_id, student_id, joined_at) VALUES (?, ?, ?)`,
        e.course_id,
        e.student_id,
        e.joined_at,
      );
    }
    for (const [courseId, studentId] of p.deleted.enrollments) {
      await db.runAsync(`DELETE FROM enrollments WHERE course_id = ? AND student_id = ?`, courseId, studentId);
    }
    for (const id of p.deleted.courses) {
      await db.runAsync(`DELETE FROM enrollments WHERE course_id = ?`, id);
      await db.runAsync(`DELETE FROM courses WHERE id = ?`, id);
    }
    // Students no longer in any of this lecturer's courses: drop their face data from the phone
    await db.runAsync(`DELETE FROM students WHERE id NOT IN (SELECT student_id FROM enrollments)`);

    for (const s of p.sessions) {
      const local = await db.getFirstAsync<{ ended_at: string | null }>(`SELECT ended_at FROM sessions WHERE uuid = ?`, s.uuid);
      if (!local) {
        await db.runAsync(
          `INSERT INTO sessions (uuid, course_id, started_at, ended_at, venue, topic) VALUES (?, ?, ?, ?, ?, ?)`,
          s.uuid,
          s.course_id,
          s.started_at,
          s.ended_at,
          s.venue,
          s.topic,
        );
      } else if (local.ended_at === null && s.ended_at !== null) {
        // Ended on the dashboard. The phone doesn't queue its own end for it.
        await db.runAsync(`UPDATE sessions SET ended_at = ? WHERE uuid = ?`, s.ended_at, s.uuid);
        endedElsewhere.push(s.uuid);
      }
    }
    for (const m of p.marks) {
      await db.runAsync(
        `INSERT OR IGNORE INTO marks (session_uuid, student_id, marked_at, method, confidence)
         SELECT ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM sessions WHERE uuid = ?)`,
        m.session_uuid,
        m.student_id,
        m.marked_at,
        m.method === 'face' ? 'face' : 'manual',
        m.session_uuid,
      );
    }
    for (const [uuid, studentId] of p.deleted.marks) {
      await db.runAsync(`DELETE FROM marks WHERE session_uuid = ? AND student_id = ?`, uuid, studentId);
    }
    for (const uuid of p.deleted.sessions) {
      const local = await db.getFirstAsync<{ ended_at: string | null }>(`SELECT ended_at FROM sessions WHERE uuid = ?`, uuid);
      if (local?.ended_at === null) endedElsewhere.push(uuid);
      await db.runAsync(`DELETE FROM sessions WHERE uuid = ?`, uuid);
      // Anything still queued for it would only be rejected
      await db.runAsync(`DELETE FROM outbox WHERE state = 'pending' AND json_extract(payload, '$.session_uuid') = ?`, uuid);
    }
    // Keep the phone small: forget classes that ended a while ago and have nothing left to send
    await db.runAsync(
      `DELETE FROM sessions WHERE ended_at IS NOT NULL AND ended_at < ?
         AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.state = 'pending'
                         AND (json_extract(o.payload, '$.uuid') = sessions.uuid
                              OR json_extract(o.payload, '$.session_uuid') = sessions.uuid))`,
      new Date(Date.now() - KEEP_ENDED_SESSIONS_MS).toISOString(),
    );
  });
  return { endedElsewhere };
}
