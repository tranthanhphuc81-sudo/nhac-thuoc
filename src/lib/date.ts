const pad = (n: number) => String(n).padStart(2, '0');

/** Ngày theo giờ địa phương dạng YYYY-MM-DD */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function diffDays(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function toTimeKey(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}

export function timeToMinutes(time: string): number {
  const { hour, minute } = parseTime(time);
  return hour * 60 + minute;
}

/** Ghép ngày + giờ thành Date theo giờ địa phương */
export function combine(dateKey: string, time: string): Date {
  const d = parseDateKey(dateKey);
  const { hour, minute } = parseTime(time);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function weekdayOf(dateKey: string): number {
  return parseDateKey(dateKey).getDay();
}

const WEEKDAY_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
export const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** Thứ tự hiển thị kiểu Việt Nam: T2 → CN */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function formatDateLong(key: string): string {
  const d = parseDateKey(key);
  return `${WEEKDAY_LONG[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateShort(key: string): string {
  const d = parseDateKey(key);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function formatDateFull(key: string): string {
  const d = parseDateKey(key);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function describeDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Hằng ngày';
  return WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_SHORT[d])
    .join(', ');
}
