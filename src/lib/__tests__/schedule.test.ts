/// <reference types="node" />
/* Kiểm thử logic lịch: chạy bằng `npm test` (dùng tsx, không cần thiết bị) */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, toDateKey } from '../date';
import { daysOfStockLeft, dosesForDate, isLowStock, planNotifications } from '../schedule';
import type { DoseLog, Medication } from '../types';

const NOW = new Date(2026, 9, 12, 9, 30); // Thứ Hai 12/10/2026 09:30
const TODAY = toDateKey(NOW);

let nextId = 1;
function med(p: Partial<Medication>): Medication {
  return {
    id: nextId++,
    name: 'Thuốc',
    dosage: '',
    unit: 'viên',
    doseAmount: 1,
    instructions: '',
    notes: '',
    color: '#000',
    photoUri: null,
    startDate: '2026-01-01',
    endDate: null,
    days: [],
    stock: null,
    active: true,
    archived: false,
    createdAt: '',
    times: ['08:00'],
    ...p,
  };
}

test('trạng thái cữ trong ngày: đã uống / quên / đến giờ / sắp tới', () => {
  const a = med({ name: 'A', times: ['08:00', '09:00', '12:00'] });
  const b = med({ name: 'B', times: ['07:00'] });
  const logs: DoseLog[] = [{ id: 1, medicationId: a.id, date: TODAY, time: '08:00', status: 'taken', actedAt: '' }];
  const items = dosesForDate([a, b], logs, TODAY, NOW, 60);
  const s = Object.fromEntries(items.map((i) => [`${i.medication.name}${i.time}`, i.status]));
  assert.deepEqual(s, { 'B07:00': 'missed', 'A08:00': 'taken', 'A09:00': 'due', 'A12:00': 'upcoming' });
  assert.deepEqual(
    items.map((i) => i.time),
    ['07:00', '08:00', '09:00', '12:00'],
  );
});

test('lọc theo thứ, ngày bắt đầu/kết thúc, tạm dừng', () => {
  const weekend = med({ days: [0, 6] });
  const future = med({ startDate: addDays(TODAY, 1) });
  const ended = med({ endDate: addDays(TODAY, -1) });
  const paused = med({ active: false });
  const monday = med({ days: [1] });
  const items = dosesForDate([weekend, future, ended, paused, monday], [], TODAY, NOW, 60);
  assert.deepEqual(
    items.map((i) => i.medication.id),
    [monday.id],
  );
});

test('thuốc hằng ngày cùng giờ được gộp thành 1 trigger DAILY', () => {
  const a = med({ times: ['08:00', '20:00'] });
  const b = med({ times: ['08:00'] });
  const plan = planNotifications([a, b], NOW, { budget: 56, horizonDays: 14 });
  assert.equal(plan.items.length, 2);
  const morning = plan.items.find((p) => p.time === '08:00')!;
  assert.deepEqual(morning.trigger, { kind: 'daily', hour: 8, minute: 0 });
  assert.deepEqual(morning.medIds, [a.id, b.id].sort((x, y) => x - y));
  assert.equal(plan.dropped, 0);
});

test('lịch khác nhau theo thứ → trigger WEEKLY (weekday 1 = Chủ nhật)', () => {
  const daily = med({ times: ['08:00'] });
  const mwf = med({ times: ['08:00'], days: [1, 3, 5] });
  const plan = planNotifications([daily, mwf], NOW, { budget: 56, horizonDays: 14 });
  assert.equal(plan.items.length, 7);
  const mon = plan.items.find((p) => p.trigger.kind === 'weekly' && p.trigger.weekday === 2)!;
  assert.equal(mon.medIds.length, 2);
  const sun = plan.items.find((p) => p.trigger.kind === 'weekly' && p.trigger.weekday === 1)!;
  assert.deepEqual(sun.medIds, [daily.id]);
});

test('thuốc theo đợt → trigger DATE, bỏ cữ đã qua, dừng ở ngày kết thúc', () => {
  const course = med({ times: ['08:00', '20:00'], startDate: TODAY, endDate: addDays(TODAY, 2) });
  const plan = planNotifications([course], NOW, { budget: 56, horizonDays: 14 });
  // Hôm nay chỉ còn 20:00 (08:00 đã qua) + 2 ngày x 2 cữ = 5
  assert.equal(plan.items.length, 5);
  assert.ok(plan.items.every((p) => p.trigger.kind === 'date'));
  assert.equal(plan.items[0].id, `dose|date|${TODAY}|20:00`);
  assert.equal(plan.items.at(-1)!.date, addDays(TODAY, 2));
});

test('vượt giới hạn iOS → cắt bớt và báo ngày được hẹn đến', () => {
  const course = med({ times: ['06:00', '10:00', '14:00', '18:00', '22:00'], startDate: TODAY, endDate: addDays(TODAY, 29) });
  const plan = planNotifications([course], NOW, { budget: 20, horizonDays: 14 });
  assert.equal(plan.items.length, 20);
  assert.ok(plan.dropped > 0);
  assert.ok(plan.coveredUntil !== null && plan.coveredUntil >= TODAY);
});

test('hash ổn định, đổi nội dung thì đổi hash', () => {
  const a = med({ name: 'Amlodipin', times: ['08:00'] });
  const p1 = planNotifications([a], NOW, { budget: 56, horizonDays: 14 }).items[0];
  const p2 = planNotifications([a], NOW, { budget: 56, horizonDays: 14 }).items[0];
  const p3 = planNotifications([{ ...a, doseAmount: 2 }], NOW, { budget: 56, horizonDays: 14 }).items[0];
  assert.equal(p1.hash, p2.hash);
  assert.notEqual(p1.hash, p3.hash);
});

test('tồn kho: số ngày còn lại và cảnh báo sắp hết', () => {
  const m = med({ times: ['08:00', '20:00'], doseAmount: 1, stock: 9 });
  assert.equal(daysOfStockLeft(m), 4);
  assert.equal(isLowStock(m, 5), true);
  assert.equal(isLowStock({ ...m, stock: 30 }, 5), false);
  assert.equal(daysOfStockLeft({ ...m, stock: null }), null);
});

test('thuốc mới thêm hôm nay không bị tính "quên" các cữ trước lúc thêm', () => {
  const m = med({ times: ['07:00', '12:00'], startDate: TODAY, createdAt: new Date(2026, 9, 12, 9, 0).toISOString() });
  const items = dosesForDate([m], [], TODAY, NOW, 60);
  assert.deepEqual(
    items.map((i) => i.time),
    ['12:00'],
  );
  // Ngày hôm sau vẫn đủ 2 cữ
  assert.equal(dosesForDate([m], [], addDays(TODAY, 1), NOW, 60).length, 2);
});
