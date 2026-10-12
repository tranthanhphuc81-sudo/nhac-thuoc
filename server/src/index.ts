/**
 * Cloudflare Worker trung gian cho tính năng "Quét đơn thuốc".
 * - Giữ API key Claude ở phía server (không nằm trong app).
 * - Mỗi người dùng có một mã truy cập riêng; có giới hạn lượt quét mỗi ngày.
 * - Không lưu ảnh: ảnh chỉ được chuyển tiếp tới Claude rồi bỏ.
 */
import { callClaude, DEFAULT_MODEL, RxError, type RxImage } from '../../src/lib/rx/extract';

/** Kiểu tối thiểu của Workers KV, để khỏi phụ thuộc gói @cloudflare/workers-types */
type KV = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

export type Env = {
  /** Secret: API key Claude (wrangler secret put ANTHROPIC_API_KEY) */
  ANTHROPIC_API_KEY: string;
  /** Secret: danh sách "tên=mã" cách nhau dấu phẩy, ví dụ "Me=me-7Kq2,Tuan=tuan-p9Xz" */
  ACCESS_CODES: string;
  /** Tùy chọn: số lượt quét tối đa mỗi mã mỗi ngày (mặc định 20) */
  DAILY_LIMIT?: string;
  /** Tùy chọn: đổi model, mặc định claude-haiku-5-5 */
  MODEL?: string;
  /** Tùy chọn: KV để đếm lượt; không gắn thì không giới hạn */
  USAGE?: KV;
};

const MAX_BASE64 = 7_000_000; // ~5 MB ảnh gốc
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

export function parseCodes(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>(); // mã -> tên
  for (const part of (raw ?? '').split(',')) {
    const [name, code] = part.includes('=') ? part.split('=', 2) : [part, part];
    if (code?.trim()) map.set(code.trim(), (name || code).trim());
  }
  return map;
}

function vnDate(now: Date): string {
  // Tính ngày theo giờ Việt Nam (UTC+7) để reset lượt lúc 0h
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return json({ ok: true, service: 'nhac-thuoc-scan', model: env.MODEL || DEFAULT_MODEL });
  }
  if (url.pathname !== '/scan') return fail(404, 'not_found', 'Không tìm thấy');
  if (req.method !== 'POST') return fail(405, 'method', 'Chỉ hỗ trợ POST');

  const codes = parseCodes(env.ACCESS_CODES);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const who = codes.get(token);
  if (!token || !who) return fail(401, 'unauthorized', 'Mã truy cập không đúng');
  if (!env.ANTHROPIC_API_KEY) return fail(500, 'config', 'Máy chủ chưa cấu hình API key');

  let payload: { image?: unknown; mediaType?: unknown };
  try {
    payload = await req.json();
  } catch {
    return fail(400, 'bad_request', 'Dữ liệu gửi lên không hợp lệ');
  }
  const base64 = typeof payload.image === 'string' ? payload.image : '';
  const mediaType = MEDIA_TYPES.find((m) => m === payload.mediaType);
  if (!base64 || !mediaType) return fail(400, 'bad_image', 'Thiếu ảnh hoặc định dạng ảnh không hỗ trợ');
  if (base64.length > MAX_BASE64) return fail(413, 'too_large', 'Ảnh quá lớn');

  const limit = Math.max(1, parseInt(env.DAILY_LIMIT ?? '20', 10) || 20);
  const usageKey = `${vnDate(now)}:${token}`;
  let used = 0;
  if (env.USAGE) {
    used = parseInt((await env.USAGE.get(usageKey)) ?? '0', 10) || 0;
    if (used >= limit) return fail(429, 'rate_limited', `Đã hết ${limit} lượt quét hôm nay, mai thử lại nhé`);
  }

  try {
    const image: RxImage = { base64, mediaType };
    const { result, usage } = await callClaude(image, env.ANTHROPIC_API_KEY, { model: env.MODEL || DEFAULT_MODEL, fetchImpl });
    if (env.USAGE) await env.USAGE.put(usageKey, String(used + 1), { expirationTtl: 3 * 86400 });
    console.log(JSON.stringify({ event: 'scan', who, meds: result.medications.length, ...usage }));
    return json({ result, usage, remaining: env.USAGE ? limit - used - 1 : null });
  } catch (e) {
    if (e instanceof RxError) {
      const status = e.code === 'unauthorized' ? 502 : e.code === 'rate_limited' ? 503 : e.code === 'refused' ? 422 : 502;
      // Lỗi API key phía server: không để lộ chi tiết cho app
      const message = e.code === 'unauthorized' ? 'Máy chủ cấu hình sai API key' : e.message;
      return fail(status, e.code, message);
    }
    return fail(500, 'internal', 'Lỗi máy chủ');
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
