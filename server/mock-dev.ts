/**
 * Máy chủ giả lập để thử giao diện quét đơn khi chưa có API key:
 * chạy đúng code Worker thật, chỉ thay phần gọi Claude bằng kết quả mẫu.
 *   npx tsx server/mock-dev.ts   →  http://localhost:8799  (mã truy cập: demo)
 */
import { createServer } from 'node:http';

import { handle, type Env } from './src/index';

const SAMPLE = {
  is_prescription: true,
  issue_date: '2026-10-10',
  warnings: ['Thuốc số 2 ghi "ngậm dưới lưỡi" — kiểm tra lại cách dùng', 'Paracetamol chỉ dùng khi sốt'],
  medications: [
    { name: 'Augmentin', strength: '625mg', dose_amount: 1, unit: 'viên', times_per_day: 2, time_slots: ['sang', 'toi'], instructions: 'Sau ăn', duration_days: 7, total_quantity: 14, as_needed: false, note: '', confidence: 'high' },
    { name: 'Alphachymotrypsin', strength: '4200 IU', dose_amount: 2, unit: 'viên', times_per_day: 3, time_slots: [], instructions: '', duration_days: 0, total_quantity: 30, as_needed: false, note: 'Ngậm dưới lưỡi', confidence: 'medium' },
    { name: 'Esomeprazol', strength: '20mg', dose_amount: 1, unit: 'viên', times_per_day: 1, time_slots: ['sang'], instructions: 'Trước ăn', duration_days: 0, total_quantity: 7, as_needed: false, note: 'Trước ăn 30 phút', confidence: 'high' },
    { name: 'Paracetamol', strength: '500mg', dose_amount: 1, unit: 'viên', times_per_day: 0, time_slots: [], instructions: '', duration_days: 0, total_quantity: 10, as_needed: true, note: 'Khi sốt trên 38,5°C, cách nhau ít nhất 4 giờ', confidence: 'high' },
  ],
};

const fakeClaude = (async () => {
  await new Promise((r) => setTimeout(r, 1500));
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(SAMPLE) }], stop_reason: 'end_turn', usage: { input_tokens: 3920, output_tokens: 610 } }));
}) as unknown as typeof fetch;

const store = new Map<string, string>();
const env: Env = {
  ANTHROPIC_API_KEY: 'mock',
  ACCESS_CODES: 'Demo=demo',
  DAILY_LIMIT: '20',
  USAGE: { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) },
};

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(`http://localhost:8799${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
  });
  const out = await handle(request, env, fakeClaude);
  res.writeHead(out.status, { ...Object.fromEntries(out.headers), ...cors });
  res.end(await out.text());
}).listen(8799, () => console.log('Mock scan server: http://localhost:8799 (mã: demo)'));
