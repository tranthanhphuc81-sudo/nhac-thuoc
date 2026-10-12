/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestBody, callClaude, normalizeResult, parseAnthropicResponse, RX_SCHEMA, RxError, type RxResult } from '../rx/extract';
import { draftToInput, toDrafts } from '../rx/map';

const sample: RxResult = {
  is_prescription: true,
  issue_date: '2026-10-10',
  warnings: ['Chữ ký bác sĩ che một phần thuốc số 3'],
  medications: [
    {
      name: 'Augmentin',
      strength: '625mg',
      dose_amount: 1,
      unit: 'viên',
      times_per_day: 2,
      time_slots: ['sang', 'toi'],
      instructions: 'Sau ăn',
      duration_days: 7,
      total_quantity: 14,
      as_needed: false,
      note: '',
      confidence: 'high',
    },
    {
      name: 'Paracetamol',
      strength: '500mg',
      dose_amount: 1,
      unit: 'viên',
      times_per_day: 0,
      time_slots: [],
      instructions: '',
      duration_days: 0,
      total_quantity: 10,
      as_needed: true,
      note: 'Khi sốt trên 38,5°C, cách nhau ít nhất 4 giờ',
      confidence: 'high',
    },
    {
      name: 'Metformin',
      strength: '500mg',
      dose_amount: 0,
      unit: 'viên',
      times_per_day: 2,
      time_slots: [],
      instructions: 'Trong bữa ăn',
      duration_days: 0,
      total_quantity: 60,
      as_needed: false,
      note: '',
      confidence: 'low',
    },
  ],
};

test('schema hợp lệ với giới hạn structured outputs: mọi object đều additionalProperties=false và required đủ', () => {
  const check = (s: Record<string, unknown>) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      const props = Object.keys(s.properties as object);
      assert.deepEqual([...(s.required as string[])].sort(), props.sort());
      for (const p of Object.values(s.properties as Record<string, Record<string, unknown>>)) check(p);
    }
    if (s.type === 'array') check(s.items as Record<string, unknown>);
    assert.ok(!Array.isArray(s.type), 'không dùng type array');
  };
  check(RX_SCHEMA as unknown as Record<string, unknown>);
  const body = buildRequestBody({ base64: 'AAA', mediaType: 'image/jpeg' });
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.output_config.format.type, 'json_schema');
});

test('chuẩn hóa: enum khác hoa/thường, giá trị rác, thuốc không tên bị bỏ', () => {
  const r = normalizeResult({
    is_prescription: true,
    issue_date: '10/10/2026',
    warnings: ['', 'ok'],
    medications: [
      { name: '  Amlodipin ', unit: 'VIÊN', instructions: 'sau ăn', time_slots: ['Sang', 'xx'], confidence: 'HIGH', dose_amount: -1 },
      { name: '', unit: 'ml' },
    ],
  });
  assert.equal(r.issue_date, '');
  assert.deepEqual(r.warnings, ['ok']);
  assert.equal(r.medications.length, 1);
  const m = r.medications[0];
  assert.equal(m.name, 'Amlodipin');
  assert.equal(m.unit, 'viên');
  assert.equal(m.instructions, 'Sau ăn');
  assert.deepEqual(m.time_slots, ['sang']);
  assert.equal(m.confidence, 'high');
  assert.equal(m.dose_amount, 0);
});

test('đọc phản hồi Messages API, xử lý refusal / max_tokens', () => {
  const ok = parseAnthropicResponse({ content: [{ type: 'text', text: JSON.stringify(sample) }], stop_reason: 'end_turn' });
  assert.equal(ok.medications.length, 3);
  assert.throws(() => parseAnthropicResponse({ stop_reason: 'refusal', content: [] }), (e: RxError) => e.code === 'refused');
  assert.throws(() => parseAnthropicResponse({ stop_reason: 'max_tokens', content: [] }), RxError);
  assert.throws(() => parseAnthropicResponse({ content: [{ type: 'text', text: 'không phải JSON' }] }), RxError);
});

test('bản nháp: giờ theo buổi, thuốc khi cần không nhắc, tự suy số ngày từ tổng số lượng', () => {
  const [aug, para, met] = toDrafts(sample);

  assert.deepEqual(aug.times, ['07:00', '21:00']);
  assert.equal(aug.courseDays, 7);
  assert.equal(aug.stock, 14);
  assert.equal(aug.include, true);
  assert.equal(aug.flags.length, 0);

  assert.equal(para.include, false);
  assert.ok(para.flags.some((f) => f.includes('khi cần')));

  assert.deepEqual(met.times, ['07:00', '17:00']);
  assert.equal(met.doseAmount, 1);
  assert.equal(met.courseDays, 30); // 60 viên / (2 lần x 1 viên)
  assert.ok(met.flags.length >= 3);

  const input = draftToInput(aug, '2026-10-12', '#000');
  assert.equal(input.endDate, '2026-10-18');
  assert.equal(input.name, 'Augmentin');
  assert.equal(draftToInput({ ...aug, courseDays: 0 }, '2026-10-12', '#000').endDate, null);
});

test('callClaude: gửi đúng header và xử lý mã lỗi', async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const okFetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(sample) }], usage: { input_tokens: 3900, output_tokens: 600 } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
  const out = await callClaude({ base64: 'AAA', mediaType: 'image/jpeg' }, 'sk-test', { fetchImpl: okFetch });
  assert.equal(out.result.medications.length, 3);
  assert.equal(out.usage.input_tokens, 3900);
  const headers = captured!.init.headers as Record<string, string>;
  assert.equal(headers['x-api-key'], 'sk-test');
  assert.equal(headers['anthropic-version'], '2023-06-01');

  const badKey = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(callClaude({ base64: 'A', mediaType: 'image/jpeg' }, 'x', { fetchImpl: badKey }), (e: RxError) => e.code === 'unauthorized');
  const down = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;
  await assert.rejects(callClaude({ base64: 'A', mediaType: 'image/jpeg' }, 'x', { fetchImpl: down }), (e: RxError) => e.code === 'network');
});
