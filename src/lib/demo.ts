import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, combine, toDateKey } from './date';
import { getMedications, saveMedication } from './repo';
import { dosesForDate } from './schedule';
import type { MedicationInput } from './types';

/**
 * Nạp dữ liệu mẫu (chỉ dùng cho bản xem trước trên web: mở với ?demo=1).
 * Không chạy trên điện thoại.
 */
export async function seedDemo(db: SQLiteDatabase): Promise<void> {
  const existing = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM medications');
  if (existing && existing.n > 0) return;

  const today = toDateKey(new Date());
  const base: Omit<MedicationInput, 'name' | 'dosage' | 'times'> = {
    unit: 'viên',
    doseAmount: 1,
    instructions: 'Sau ăn',
    notes: '',
    color: '#0F766E',
    photoUri: null,
    startDate: addDays(today, -40),
    endDate: null,
    days: [],
    stock: null,
    active: true,
  };

  const meds: MedicationInput[] = [
    { ...base, name: 'Amlodipin', dosage: '5mg', times: ['07:00'], stock: 24, notes: 'Thuốc huyết áp, uống đều mỗi sáng' },
    { ...base, name: 'Metformin', dosage: '500mg', times: ['07:00', '19:00'], instructions: 'Trong bữa ăn', color: '#2563EB', stock: 8 },
    {
      ...base,
      name: 'Augmentin',
      dosage: '625mg',
      times: ['08:00', '20:00'],
      color: '#7C3AED',
      startDate: addDays(today, -2),
      endDate: addDays(today, 4),
      notes: 'Kháng sinh — uống đủ 7 ngày, không tự ý ngưng',
    },
    { ...base, name: 'Vitamin D3', dosage: '1000 IU', times: ['12:00'], days: [1, 3, 5], color: '#EA580C', instructions: 'Trong bữa ăn' },
    { ...base, name: 'Siro ho Prospan', dosage: '', unit: 'ml', doseAmount: 5, times: ['21:00'], color: '#DB2777', instructions: 'Trước khi ngủ' },
  ];
  for (const m of meds) await saveMedication(db, m);

  // Nhật ký 13 ngày trước: phần lớn uống đúng, thỉnh thoảng quên / bỏ qua
  const all = await getMedications(db);
  let k = 0;
  for (let i = 13; i >= 1; i--) {
    const day = addDays(today, -i);
    const items = dosesForDate(all, [], day, new Date(), 60);
    for (const it of items) {
      k++;
      if (k % 11 === 0) continue; // quên
      const status = k % 17 === 0 ? 'skipped' : 'taken';
      const acted = combine(day, it.time);
      acted.setMinutes(acted.getMinutes() + ((k * 7) % 25));
      await db.runAsync(
        'INSERT INTO dose_logs (medication_id, date, time, status, acted_at) VALUES (?, ?, ?, ?, ?)',
        it.medication.id,
        day,
        it.time,
        status,
        acted.toISOString(),
      );
    }
  }
  // Hôm nay: đã uống các thuốc 07:00
  for (const m of all.filter((x) => x.times.includes('07:00'))) {
    const acted = combine(today, '07:00');
    acted.setMinutes(6);
    await db.runAsync(
      "INSERT INTO dose_logs (medication_id, date, time, status, acted_at) VALUES (?, ?, '07:00', 'taken', ?)",
      m.id,
      today,
      acted.toISOString(),
    );
  }
}
