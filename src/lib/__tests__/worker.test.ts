/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handle, parseCodes, type Env } from '../../../server/src/index';

const claudeOk = (async () =>
  new Response(
    JSON.stringify({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ is_prescription: true, issue_date: '', warnings: [], medications: [{ name: 'Amlodipin', unit: 'viên', confidence: 'high' }] }),
        },
      ],
      usage: { input_tokens: 4000, output_tokens: 500 },
    }),
  )) as unknown as typeof fetch;

function memoryKV() {
  const store = new Map<string, string>();
  return { store, get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) };
}

const scanReq = (token: string, body: unknown = { image: 'AAAA', mediaType: 'image/jpeg' }) =>
  new Request('https://x.workers.dev/scan', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('parseCodes đọc "tên=mã"', () => {
  const m = parseCodes('Me=me-1, Tuan=tuan-2,solo');
  assert.equal(m.get('me-1'), 'Me');
  assert.equal(m.get('tuan-2'), 'Tuan');
  assert.equal(m.get('solo'), 'solo');
});

test('Worker: kiểm tra mã truy cập, đọc đơn, đếm lượt và chặn khi vượt giới hạn', async () => {
  const kv = memoryKV();
  const env: Env = { ANTHROPIC_API_KEY: 'sk', ACCESS_CODES: 'Me=me-1', DAILY_LIMIT: '2', USAGE: kv };

  const health = await handle(new Request('https://x.workers.dev/health'), env, claudeOk);
  assert.equal(health.status, 200);

  assert.equal((await handle(scanReq('sai-ma'), env, claudeOk)).status, 401);
  assert.equal((await handle(scanReq('me-1', { image: 'AAA', mediaType: 'image/gif' }), env, claudeOk)).status, 400);

  const r1 = await handle(scanReq('me-1'), env, claudeOk);
  assert.equal(r1.status, 200);
  const b1 = (await r1.json()) as { result: { medications: { name: string }[] }; remaining: number };
  assert.equal(b1.result.medications[0].name, 'Amlodipin');
  assert.equal(b1.remaining, 1);

  assert.equal((await handle(scanReq('me-1'), env, claudeOk)).status, 200);
  const r3 = await handle(scanReq('me-1'), env, claudeOk);
  assert.equal(r3.status, 429);
  assert.equal([...kv.store.values()][0], '2');
});

test('Worker: không lộ lỗi API key của server cho app', async () => {
  const bad = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
  const r = await handle(scanReq('me-1'), { ANTHROPIC_API_KEY: 'sk', ACCESS_CODES: 'me-1' }, bad);
  assert.equal(r.status, 502);
  const b = (await r.json()) as { error: { message: string } };
  assert.match(b.error.message, /Máy chủ/);
});
