/** Chuyển kết quả AI thành bản nháp thuốc để người dùng kiểm tra trước khi lưu (thuần TS, có test) */
import { addDays } from '../date';
import type { MedicationInput } from '../types';
import type { RxMedication, RxResult, RxSlot } from './extract';

export const SLOT_TIMES: Record<RxSlot, string> = { sang: '07:00', trua: '12:00', chieu: '17:00', toi: '21:00' };
export const SLOT_LABELS: Record<RxSlot, string> = { sang: 'Sáng', trua: 'Trưa', chieu: 'Chiều', toi: 'Tối' };

const DEFAULT_SLOTS: Record<number, RxSlot[]> = {
  1: ['sang'],
  2: ['sang', 'chieu'],
  3: ['sang', 'trua', 'chieu'],
  4: ['sang', 'trua', 'chieu', 'toi'],
};

export type RxDraft = {
  key: string;
  include: boolean;
  name: string;
  dosage: string;
  doseAmount: number;
  unit: string;
  instructions: string;
  times: string[];
  /** 0 = dùng lâu dài */
  courseDays: number;
  stock: number | null;
  note: string;
  confidence: RxMedication['confidence'];
  asNeeded: boolean;
  /** Những điểm cần người dùng kiểm tra lại */
  flags: string[];
};

export function toDrafts(result: RxResult): RxDraft[] {
  return result.medications.map((m, i) => {
    const flags: string[] = [];
    let slots = m.time_slots;
    if (slots.length === 0) {
      const n = Math.min(4, Math.max(0, m.times_per_day));
      if (n > 0) {
        slots = DEFAULT_SLOTS[n];
        flags.push('Đơn không ghi buổi uống — đã tự chọn giờ, hãy kiểm tra');
      } else {
        slots = ['sang'];
        flags.push('Không rõ số lần uống mỗi ngày');
      }
    } else if (m.times_per_day > slots.length) {
      flags.push(`Đơn ghi ${m.times_per_day} lần/ngày nhưng chỉ nêu ${slots.length} buổi`);
    }

    let doseAmount = m.dose_amount;
    if (doseAmount <= 0) {
      doseAmount = 1;
      flags.push('Không rõ liều mỗi lần — tạm để 1');
    }

    const perDay = slots.length * doseAmount;
    let courseDays = m.duration_days;
    if (courseDays <= 0 && m.total_quantity > 0 && perDay > 0) {
      courseDays = Math.max(1, Math.floor(m.total_quantity / perDay));
      flags.push(`Số ngày được tính từ tổng số lượng (${m.total_quantity} ${m.unit})`);
    }

    if (m.confidence === 'low') flags.push('AI đọc không chắc chắn');
    if (m.as_needed) flags.push('Thuốc dùng khi cần — mặc định không nhắc theo giờ');

    return {
      key: `${i}-${m.name}`,
      include: !m.as_needed,
      name: m.name,
      dosage: m.strength,
      doseAmount,
      unit: m.unit === 'khác' ? 'viên' : m.unit,
      instructions: m.instructions,
      times: [...new Set(slots.map((s) => SLOT_TIMES[s]))].sort(),
      courseDays,
      stock: m.total_quantity > 0 ? m.total_quantity : null,
      note: m.note,
      confidence: m.confidence,
      asNeeded: m.as_needed,
      flags,
    };
  });
}

/** Ngày bắt đầu mặc định: hôm nay (đơn mới) — nếu đơn kê từ trước thì vẫn tính từ hôm nay cho an toàn */
export function draftToInput(d: RxDraft, startDate: string, color: string): MedicationInput {
  return {
    name: d.name.trim(),
    dosage: d.dosage.trim(),
    unit: d.unit,
    doseAmount: d.doseAmount,
    instructions: d.instructions,
    notes: d.note.trim(),
    color,
    photoUri: null,
    startDate,
    endDate: d.courseDays > 0 ? addDays(startDate, d.courseDays - 1) : null,
    days: [],
    stock: d.stock,
    active: true,
    times: d.times,
  };
}

/** Ước tính chi phí một lần quét (USD) theo giá Claude Haiku 5.5 */
export function estimateCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens * 0.1 + usage.output_tokens * 0.5) / 1_000_000;
}
