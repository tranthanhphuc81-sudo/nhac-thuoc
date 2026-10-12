import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'nhac-thuoc.db';
const DATABASE_VERSION = 1;

export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        name TEXT NOT NULL,
        dosage TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'viên',
        dose_amount REAL NOT NULL DEFAULT 1,
        instructions TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#0F766E',
        photo_uri TEXT,
        start_date TEXT NOT NULL,
        end_date TEXT,
        days TEXT NOT NULL DEFAULT '',
        stock REAL,
        active INTEGER NOT NULL DEFAULT 1,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS med_times (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
        time TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_med_times_med ON med_times(medication_id);
      CREATE TABLE IF NOT EXISTS dose_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
        acted_at TEXT NOT NULL,
        UNIQUE (medication_id, date, time)
      );
      CREATE INDEX IF NOT EXISTS idx_dose_logs_date ON dose_logs(date);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    version = 1;
  }

  // Các migration sau này: if (version === 1) { ...; version = 2; }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
