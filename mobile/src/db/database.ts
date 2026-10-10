/**
 * Local SQLite store (expo-sqlite, async API).
 *
 * Caches the last-seen dashboard / courses / lecturers JSON so the student screens can still
 * show something when the phone is offline. Attendance itself is only ever taken on the
 * lecturer's device, so nothing here is queued for upload.
 */
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('attendance.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        DROP TABLE IF EXISTS pending_attendance;
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM cache;`);
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
