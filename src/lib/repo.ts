import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { toDateKey } from './date';
import { DEFAULT_SETTINGS, type DoseLog, type DoseLogStatus, type Medication, type MedicationInput, type Settings } from './types';

/** Giao dịch độc quyền trên thiết bị; trên web (chỉ để xem trước) dùng giao dịch thường */
async function inTransaction(db: SQLiteDatabase, fn: (tx: SQLiteDatabase) => Promise<void>): Promise<void> {
  if (Platform.OS === 'web') {
    await db.withTransactionAsync(() => fn(db));
    return;
  }
  await db.withExclusiveTransactionAsync((tx) => fn(tx));
}

type MedRow = {
  id: number;
  name: string;
  dosage: string;
  unit: string;
  dose_amount: number;
  instructions: string;
  notes: string;
  color: string;
  photo_uri: string | null;
  start_date: string;
  end_date: string | null;
  days: string;
  stock: number | null;
  active: number;
  archived: number;
  created_at: string;
};

type LogRow = {
  id: number;
  medication_id: number;
  date: string;
  time: string;
  status: DoseLogStatus;
  acted_at: string;
};

function rowToMed(r: MedRow, times: string[]): Medication {
  return {
    id: r.id,
    name: r.name,
    dosage: r.dosage,
    unit: r.unit,
    doseAmount: r.dose_amount,
    instructions: r.instructions,
    notes: r.notes,
    color: r.color,
    photoUri: r.photo_uri,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days ? r.days.split('').map(Number) : [],
    stock: r.stock,
    active: r.active === 1,
    archived: r.archived === 1,
    createdAt: r.created_at,
    times: [...times].sort(),
  };
}

function rowToLog(r: LogRow): DoseLog {
  return { id: r.id, medicationId: r.medication_id, date: r.date, time: r.time, status: r.status, actedAt: r.acted_at };
}

/** Lấy tất cả thuốc (mặc định bỏ qua thuốc đã xóa) */
export async function getMedications(db: SQLiteDatabase, includeArchived = false): Promise<Medication[]> {
  const rows = await db.getAllAsync<MedRow>(
    `SELECT * FROM medications ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY active DESC, name COLLATE NOCASE`,
  );
  const timeRows = await db.getAllAsync<{ medication_id: number; time: string }>('SELECT medication_id, time FROM med_times');
  const timesByMed = new Map<number, string[]>();
  for (const t of timeRows) {
    const list = timesByMed.get(t.medication_id) ?? [];
    list.push(t.time);
    timesByMed.set(t.medication_id, list);
  }
  return rows.map((r) => rowToMed(r, timesByMed.get(r.id) ?? []));
}

export async function getMedication(db: SQLiteDatabase, id: number): Promise<Medication | null> {
  const row = await db.getFirstAsync<MedRow>('SELECT * FROM medications WHERE id = ?', id);
  if (!row) return null;
  const times = await db.getAllAsync<{ time: string }>('SELECT time FROM med_times WHERE medication_id = ?', id);
  return rowToMed(
    row,
    times.map((t) => t.time),
  );
}

export async function saveMedication(db: SQLiteDatabase, input: MedicationInput, id?: number): Promise<number> {
  const days = input.days.length === 7 ? '' : [...input.days].sort().join('');
  const times = [...new Set(input.times)].sort();
  let medId = id ?? 0;
  await inTransaction(db, async (tx) => {
    const params = [
      input.name.trim(),
      input.dosage.trim(),
      input.unit,
      input.doseAmount,
      input.instructions,
      input.notes.trim(),
      input.color,
      input.photoUri,
      input.startDate,
      input.endDate,
      days,
      input.stock,
      input.active ? 1 : 0,
    ];
    if (id) {
      await tx.runAsync(
        `UPDATE medications SET name=?, dosage=?, unit=?, dose_amount=?, instructions=?, notes=?, color=?, photo_uri=?,
         start_date=?, end_date=?, days=?, stock=?, active=? WHERE id=?`,
        ...params,
        id,
      );
      await tx.runAsync('DELETE FROM med_times WHERE medication_id = ?', id);
    } else {
      const res = await tx.runAsync(
        `INSERT INTO medications (name, dosage, unit, dose_amount, instructions, notes, color, photo_uri,
         start_date, end_date, days, stock, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ...params,
        new Date().toISOString(),
      );
      medId = res.lastInsertRowId;
    }
    for (const t of times) {
      await tx.runAsync('INSERT INTO med_times (medication_id, time) VALUES (?, ?)', medId, t);
    }
  });
  return medId;
}

export async function setMedicationActive(db: SQLiteDatabase, id: number, active: boolean): Promise<void> {
  await db.runAsync('UPDATE medications SET active = ? WHERE id = ?', active ? 1 : 0, id);
}

/** Xóa mềm: giữ lại lịch sử uống thuốc */
export async function archiveMedication(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE medications SET archived = 1, active = 0 WHERE id = ?', id);
}

export async function getLogsBetween(db: SQLiteDatabase, from: string, to: string): Promise<DoseLog[]> {
  const rows = await db.getAllAsync<LogRow>('SELECT * FROM dose_logs WHERE date >= ? AND date <= ?', from, to);
  return rows.map(rowToLog);
}

export type LogResult = {
  /** Thuốc vừa chạm ngưỡng sắp hết sau lần ghi nhận này */
  stockChanged: { medicationId: number; stock: number }[];
};

/**
 * Ghi nhận trạng thái một cữ. Tự động trừ/cộng tồn kho khi chuyển qua lại trạng thái "đã uống".
 * status = null → hoàn tác (xóa log).
 */
export async function setDoseStatus(
  db: SQLiteDatabase,
  entries: { medicationId: number; date: string; time: string }[],
  status: DoseLogStatus | null,
): Promise<LogResult> {
  const stockChanged: LogResult['stockChanged'] = [];
  await inTransaction(db, async (tx) => {
    for (const e of entries) {
      const prev = await tx.getFirstAsync<{ status: DoseLogStatus }>(
        'SELECT status FROM dose_logs WHERE medication_id = ? AND date = ? AND time = ?',
        e.medicationId,
        e.date,
        e.time,
      );
      const prevStatus = prev?.status ?? null;
      if (prevStatus === status) continue;

      if (status === null) {
        await tx.runAsync('DELETE FROM dose_logs WHERE medication_id = ? AND date = ? AND time = ?', e.medicationId, e.date, e.time);
      } else {
        await tx.runAsync(
          `INSERT INTO dose_logs (medication_id, date, time, status, acted_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(medication_id, date, time) DO UPDATE SET status = excluded.status, acted_at = excluded.acted_at`,
          e.medicationId,
          e.date,
          e.time,
          status,
          new Date().toISOString(),
        );
      }

      const delta = (status === 'taken' ? -1 : 0) + (prevStatus === 'taken' ? 1 : 0);
      if (delta !== 0) {
        const med = await tx.getFirstAsync<{ stock: number | null; dose_amount: number }>(
          'SELECT stock, dose_amount FROM medications WHERE id = ?',
          e.medicationId,
        );
        if (med && med.stock !== null) {
          const next = Math.max(0, med.stock + delta * med.dose_amount);
          await tx.runAsync('UPDATE medications SET stock = ? WHERE id = ?', next, e.medicationId);
          stockChanged.push({ medicationId: e.medicationId, stock: next });
        }
      }
    }
  });
  return { stockChanged };
}

// ---------------------------------------------------------------------------
// Cài đặt (key/value)
// ---------------------------------------------------------------------------

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function loadSettings(db: SQLiteDatabase): Promise<Settings> {
  const raw = await getSetting(db, 'app_settings');
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(db: SQLiteDatabase, s: Settings): Promise<void> {
  await setSetting(db, 'app_settings', JSON.stringify(s));
}

// ---------------------------------------------------------------------------
// Sao lưu / khôi phục
// ---------------------------------------------------------------------------

export type BackupFile = {
  app: 'nhac-thuoc';
  version: 1;
  exportedAt: string;
  medications: MedRow[];
  medTimes: { medication_id: number; time: string }[];
  doseLogs: LogRow[];
  settings: { key: string; value: string }[];
};

export async function exportBackup(db: SQLiteDatabase): Promise<BackupFile> {
  return {
    app: 'nhac-thuoc',
    version: 1,
    exportedAt: new Date().toISOString(),
    medications: await db.getAllAsync<MedRow>('SELECT * FROM medications'),
    medTimes: await db.getAllAsync('SELECT medication_id, time FROM med_times'),
    doseLogs: await db.getAllAsync<LogRow>('SELECT * FROM dose_logs'),
    // Không xuất cấu hình quét đơn (có thể chứa API key / mã truy cập)
    settings: await db.getAllAsync("SELECT key, value FROM settings WHERE key NOT IN ('rx_config', 'last_response_key')"),
  };
}

export function validateBackup(data: unknown): data is BackupFile {
  const d = data as Partial<BackupFile> | null;
  return (
    !!d &&
    d.app === 'nhac-thuoc' &&
    Array.isArray(d.medications) &&
    Array.isArray(d.medTimes) &&
    Array.isArray(d.doseLogs) &&
    Array.isArray(d.settings)
  );
}

/** Thay toàn bộ dữ liệu bằng bản sao lưu. Ảnh thuốc không nằm trong bản sao lưu. */
export async function importBackup(db: SQLiteDatabase, data: BackupFile): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.execAsync('DELETE FROM dose_logs; DELETE FROM med_times; DELETE FROM medications;');
    await tx.runAsync("DELETE FROM settings WHERE key <> 'rx_config'");
    for (const m of data.medications) {
      await tx.runAsync(
        `INSERT INTO medications (id, name, dosage, unit, dose_amount, instructions, notes, color, photo_uri,
         start_date, end_date, days, stock, active, archived, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.id,
        m.name,
        m.dosage ?? '',
        m.unit ?? 'viên',
        m.dose_amount ?? 1,
        m.instructions ?? '',
        m.notes ?? '',
        m.color ?? '#0F766E',
        null,
        m.start_date ?? toDateKey(new Date()),
        m.end_date ?? null,
        m.days ?? '',
        m.stock ?? null,
        m.active ?? 1,
        m.archived ?? 0,
        m.created_at ?? new Date().toISOString(),
      );
    }
    for (const t of data.medTimes) {
      await tx.runAsync('INSERT INTO med_times (medication_id, time) VALUES (?, ?)', t.medication_id, t.time);
    }
    for (const l of data.doseLogs) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO dose_logs (medication_id, date, time, status, acted_at) VALUES (?, ?, ?, ?, ?)',
        l.medication_id,
        l.date,
        l.time,
        l.status,
        l.acted_at,
      );
    }
    for (const s of data.settings) {
      if (s.key === 'rx_config') continue;
      await tx.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', s.key, s.value);
    }
  });
}
