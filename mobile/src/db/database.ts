/**
 * Local SQLite store (expo-sqlite, async API), encrypted with SQLCipher.
 *
 * Holds biometric data on lecturer phones (students' face embeddings), so the file is encrypted
 * with a random key kept in the secure enclave / keystore via expo-secure-store.
 *
 * Tables:
 *   cache         last-seen JSON for the student screens (works offline)
 *   meta          lecturer device state: sync cursor, device id, last sync, matching settings
 *   courses, students, enrollments
 *                 the lecturer's rosters and face embeddings, mirrored from the server
 *   sessions, marks
 *                 classes taken on this phone (the source of truth until synced)
 *   outbox        every local change as an operation for /lecturer/sync/push, in order
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'attendance-v2.db';
const LEGACY_DB_NAME = 'attendance.db'; // unencrypted cache from before the offline-first redesign
const KEY_NAME = 'db_key';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    is_active INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY NOT NULL,
    matric_no TEXT NOT NULL,
    full_name TEXT NOT NULL,
    face_model TEXT,
    face BLOB,                    -- poses x 512 float32, L2-normalised
    needs_update INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    course_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (course_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    uuid TEXT PRIMARY KEY NOT NULL,
    course_id INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    venue TEXT,
    topic TEXT
  );
  CREATE TABLE IF NOT EXISTS marks (
    session_uuid TEXT NOT NULL REFERENCES sessions(uuid) ON DELETE CASCADE,
    student_id INTEGER NOT NULL,
    marked_at TEXT NOT NULL,
    method TEXT NOT NULL,
    confidence REAL,
    PRIMARY KEY (session_uuid, student_id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'pending',   -- pending | rejected (sent ops are deleted)
    reason TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_outbox_state ON outbox(state, seq);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function databaseKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_NAME, key);
  }
  return key;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await SQLite.deleteDatabaseAsync(LEGACY_DB_NAME).catch(() => undefined);
      const key = await databaseKey();
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      // Must run before anything else touches the file; the key is hex, so it can't break the quoting
      await db.execAsync(`PRAGMA key = "x'${key}'";`);
      await db.execAsync(SCHEMA);
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Wipe everything (logout). */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    DELETE FROM cache; DELETE FROM meta; DELETE FROM marks; DELETE FROM sessions;
    DELETE FROM enrollments; DELETE FROM students; DELETE FROM courses; DELETE FROM outbox;
  `);
}

// ---------- generic JSON cache ----------

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?, ?, ?)`,
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM cache WHERE key = ?`, key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

// ---------- meta ----------

export async function metaGet(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key))?.value ?? null;
}

export async function metaSet(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  if (value === null) await db.runAsync(`DELETE FROM meta WHERE key = ?`, key);
  else await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, key, value);
}
