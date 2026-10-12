/**
 * Logic thuần (không phụ thuộc Expo) để:
 *  - tính các cữ uống trong một ngày
 *  - lập kế hoạch thông báo cục bộ, tôn trọng giới hạn số thông báo chờ của hệ điều hành
 */
import { addDays, combine, toDateKey, weekdayOf } from './date';
import type { DoseItem, DoseLog, Medication } from './types';

export function isMedOnDate(med: Medication, dateKey: string): boolean {
  if (!med.active || med.archived) return false;
  if (dateKey < med.startDate) return false;
  if (med.endDate && dateKey > med.endDate) return false;
  if (med.days.length === 0 || med.days.length === 7) return true;
  return med.days.includes(weekdayOf(dateKey));
}

/** Một thuốc dùng lâu dài, đã bắt đầu → có thể dùng trigger lặp lại */
function isRepeating(med: Medication, today: string): boolean {
  return med.endDate === null && med.startDate <= today;
}

export function dosesForDate(
  meds: Medication[],
  logs: DoseLog[],
  dateKey: string,
  now: Date,
  missedAfterMinutes: number,
): DoseItem[] {
  const logMap = new Map(logs.filter((l) => l.date === dateKey).map((l) => [`${l.medicationId}|${l.time}`, l]));
  const items: DoseItem[] = [];
  for (const med of meds) {
    if (!isMedOnDate(med, dateKey)) continue;
    const createdMs = med.createdAt ? Date.parse(med.createdAt) : NaN;
    for (const time of med.times) {
      const log = logMap.get(`${med.id}|${time}`) ?? null;
      // Thuốc mới thêm hôm nay: không tính các cữ đã qua trước lúc thêm (tránh báo "quên" oan)
      if (!log && dateKey === med.startDate && Number.isFinite(createdMs) && combine(dateKey, time).getTime() < createdMs) continue;
      let status: DoseItem['status'];
      if (log) status = log.status;
      else {
        const at = combine(dateKey, time).getTime();
        const t = now.getTime();
        if (t < at) status = 'upcoming';
        else if (t < at + missedAfterMinutes * 60_000) status = 'due';
        else status = 'missed';
      }
      items.push({ medication: med, date: dateKey, time, status, log });
    }
  }
  // Ghi nhận cả các log của thuốc đã bị sửa giờ/xóa giờ để lịch sử không mất dữ liệu
  for (const log of logMap.values()) {
    if (items.some((i) => i.medication.id === log.medicationId && i.time === log.time)) continue;
    const med = meds.find((m) => m.id === log.medicationId);
    if (med) items.push({ medication: med, date: dateKey, time: log.time, status: log.status, log });
  }
  items.sort((a, b) => (a.time === b.time ? a.medication.name.localeCompare(b.medication.name, 'vi') : a.time < b.time ? -1 : 1));
  return items;
}

export function groupByTime(items: DoseItem[]): { time: string; items: DoseItem[] }[] {
  const groups: { time: string; items: DoseItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.time === it.time) last.items.push(it);
    else groups.push({ time: it.time, items: [it] });
  }
  return groups;
}

export function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (n === 0.5) return '½';
  if (n === 0.25) return '¼';
  if (n === 1.5) return '1½';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

export function describeDose(med: Medication): string {
  const parts = [`${formatAmount(med.doseAmount)} ${med.unit}`];
  if (med.instructions) parts.push(med.instructions.toLowerCase());
  return parts.join(' · ');
}

export function medLine(med: Medication): string {
  return `${med.name}${med.dosage ? ` ${med.dosage}` : ''} — ${describeDose(med)}`;
}

/** Số cữ trung bình mỗi ngày */
export function dosesPerDay(med: Medication): number {
  const daysFactor = med.days.length === 0 || med.days.length === 7 ? 1 : med.days.length / 7;
  return med.times.length * daysFactor;
}

/** Số ngày còn đủ thuốc, null nếu không theo dõi tồn kho */
export function daysOfStockLeft(med: Medication): number | null {
  if (med.stock === null) return null;
  const perDay = dosesPerDay(med) * med.doseAmount;
  if (perDay <= 0) return null;
  return Math.floor(med.stock / perDay);
}

export function isLowStock(med: Medication, lowStockDays: number): boolean {
  const left = daysOfStockLeft(med);
  return left !== null && med.active && !med.archived && left <= lowStockDays;
}

// ---------------------------------------------------------------------------
// Lập kế hoạch thông báo
// ---------------------------------------------------------------------------

export type PlannedTrigger =
  | { kind: 'daily'; hour: number; minute: number }
  /** weekday: 1 = Chủ nhật ... 7 = Thứ Bảy (quy ước của expo-notifications) */
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'date'; timestamp: number };

export type PlannedNotification = {
  /** Định danh ổn định, dùng để so khớp với thông báo đã hẹn */
  id: string;
  trigger: PlannedTrigger;
  time: string;
  /** Chỉ có với trigger 'date' */
  date: string | null;
  medIds: number[];
  title: string;
  body: string;
  /** Mã băm nội dung: đổi nội dung → hẹn lại */
  hash: string;
};

export type PlanResult = {
  items: PlannedNotification[];
  /** Số thông báo không hẹn được do vượt giới hạn */
  dropped: number;
  /** Ngày cuối cùng được hẹn đầy đủ (null nếu không bị cắt) */
  coveredUntil: string | null;
};

export type PlanOptions = {
  /** Tổng số thông báo tối đa được hẹn (iOS ≈ 64) */
  budget: number;
  /** Số ngày tối đa nhìn trước cho thông báo một lần */
  horizonDays: number;
};

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function buildContent(time: string, meds: Medication[]): { title: string; body: string } {
  const sorted = [...meds].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const title = sorted.length === 1 ? `💊 ${time} · Đến giờ uống ${sorted[0].name}` : `💊 ${time} · Đến giờ uống ${sorted.length} loại thuốc`;
  const body = sorted.map((m) => (sorted.length === 1 ? describeDoseFull(m) : `• ${medLine(m)}`)).join('\n');
  return { title, body };
}

function describeDoseFull(med: Medication): string {
  const s = `${med.dosage ? `${med.dosage} — ` : ''}${describeDose(med)}`;
  return med.notes ? `${s}\n${med.notes}` : s;
}

function makeItem(id: string, trigger: PlannedTrigger, time: string, date: string | null, meds: Medication[]): PlannedNotification {
  const { title, body } = buildContent(time, meds);
  const medIds = meds.map((m) => m.id).sort((a, b) => a - b);
  const hash = hashString(JSON.stringify([trigger, title, body, medIds]));
  return { id, trigger, time, date, medIds, title, body, hash };
}

export function planNotifications(meds: Medication[], now: Date, opts: PlanOptions): PlanResult {
  const today = toDateKey(now);
  const usable = meds.filter((m) => m.active && !m.archived && m.times.length > 0 && (!m.endDate || m.endDate >= today));

  // 1) Thuốc dùng lâu dài: gom theo giờ → theo từng thứ trong tuần
  const repeating = usable.filter((m) => isRepeating(m, today));
  const slotMap = new Map<string, Map<number, Medication[]>>(); // time -> weekday(0-6) -> meds
  for (const med of repeating) {
    const weekdays = med.days.length === 0 || med.days.length === 7 ? [0, 1, 2, 3, 4, 5, 6] : med.days;
    for (const time of med.times) {
      let byDay = slotMap.get(time);
      if (!byDay) slotMap.set(time, (byDay = new Map()));
      for (const wd of weekdays) {
        const list = byDay.get(wd) ?? [];
        list.push(med);
        byDay.set(wd, list);
      }
    }
  }

  const repeatingItems: PlannedNotification[] = [];
  for (const [time, byDay] of [...slotMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const { hour, minute } = parseHM(time);
    const sig = (wd: number) => (byDay.get(wd) ?? []).map((m) => m.id).sort((a, b) => a - b).join(',');
    const allSame = byDay.size === 7 && [0, 1, 2, 3, 4, 5, 6].every((wd) => sig(wd) === sig(0));
    if (allSame) {
      repeatingItems.push(makeItem(`dose|daily|${time}`, { kind: 'daily', hour, minute }, time, null, byDay.get(0)!));
    } else {
      for (const wd of [...byDay.keys()].sort()) {
        repeatingItems.push(
          makeItem(`dose|weekly|${wd}|${time}`, { kind: 'weekly', weekday: wd + 1, hour, minute }, time, null, byDay.get(wd)!),
        );
      }
    }
  }

  // 2) Thuốc theo đợt (có ngày kết thúc) hoặc chưa đến ngày bắt đầu: hẹn từng lần
  const oneOff = usable.filter((m) => !isRepeating(m, today));
  const dated: PlannedNotification[] = [];
  const nowMs = now.getTime();
  for (let i = 0; i <= opts.horizonDays; i++) {
    const day = addDays(today, i);
    const byTime = new Map<string, Medication[]>();
    for (const med of oneOff) {
      if (!isMedOnDate(med, day)) continue;
      for (const time of med.times) {
        if (combine(day, time).getTime() <= nowMs) continue;
        const list = byTime.get(time) ?? [];
        list.push(med);
        byTime.set(time, list);
      }
    }
    for (const [time, list] of [...byTime.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      dated.push(makeItem(`dose|date|${day}|${time}`, { kind: 'date', timestamp: combine(day, time).getTime() }, time, day, list));
    }
  }

  const remaining = Math.max(0, opts.budget - repeatingItems.length);
  const kept = dated.slice(0, remaining);
  const dropped = dated.length - kept.length + Math.max(0, repeatingItems.length - opts.budget);
  let coveredUntil: string | null = null;
  if (dropped > 0) {
    const firstDropped = dated[kept.length];
    coveredUntil = firstDropped ? addDays(firstDropped.date!, -1) : today;
  }
  return { items: [...repeatingItems.slice(0, opts.budget), ...kept], dropped, coveredUntil };
}

function parseHM(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

/** Tỉ lệ tuân thủ (đã uống / tổng cữ đã qua) */
export function adherence(items: DoseItem[]): { taken: number; total: number; percent: number | null } {
  const counted = items.filter((i) => i.status !== 'upcoming' && i.status !== 'due');
  const taken = counted.filter((i) => i.status === 'taken').length;
  return { taken, total: counted.length, percent: counted.length ? Math.round((taken * 100) / counted.length) : null };
}
