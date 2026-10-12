import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '../repo';
import { callClaude, RxError, type RxImage, type RxResult } from './extract';
import { normalizeServerUrl } from './url';

export { normalizeServerUrl };

export type RxMode = 'off' | 'server' | 'apikey';

export type RxConfig = {
  mode: RxMode;
  /** Địa chỉ Cloudflare Worker, ví dụ https://nhac-thuoc-scan.ten-ban.workers.dev */
  serverUrl: string;
  accessCode: string;
  /** Chỉ dùng ở chế độ "apikey" (dùng riêng một máy) */
  apiKey: string;
  /** Người dùng đã đồng ý gửi ảnh đơn thuốc tới dịch vụ AI */
  consent: boolean;
};

export const DEFAULT_RX_CONFIG: RxConfig = { mode: 'off', serverUrl: '', accessCode: '', apiKey: '', consent: false };

export async function loadRxConfig(db: SQLiteDatabase): Promise<RxConfig> {
  const raw = await getSetting(db, 'rx_config');
  if (!raw) return DEFAULT_RX_CONFIG;
  try {
    return { ...DEFAULT_RX_CONFIG, ...(JSON.parse(raw) as Partial<RxConfig>) };
  } catch {
    return DEFAULT_RX_CONFIG;
  }
}

export async function saveRxConfig(db: SQLiteDatabase, cfg: RxConfig): Promise<void> {
  await setSetting(db, 'rx_config', JSON.stringify(cfg));
}

export function isRxReady(cfg: RxConfig): boolean {
  if (cfg.mode === 'server') return normalizeServerUrl(cfg.serverUrl).length > 8 && cfg.accessCode.trim().length > 0;
  if (cfg.mode === 'apikey') return cfg.apiKey.trim().length > 20;
  return false;
}

const MAX_EDGE = 2000;

/** Thu nhỏ ảnh (cạnh dài ≤ 2000px, JPEG) để đọc rõ chữ mà vẫn nhanh và rẻ */
export async function prepareImage(uri: string, width: number, height: number): Promise<RxImage> {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_EDGE) {
    ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
  if (!out.base64) throw new RxError('Không xử lý được ảnh.', 'bad_image');
  return { base64: out.base64, mediaType: 'image/jpeg' };
}

const baseUrl = (u: string) => normalizeServerUrl(u);

export type ScanOutput = { result: RxResult; usage: { input_tokens: number; output_tokens: number }; remaining: number | null };

export async function scanPrescription(cfg: RxConfig, image: RxImage, timeoutMs = 90_000): Promise<ScanOutput> {
  if (cfg.mode === 'apikey') {
    const out = await callClaude(image, cfg.apiKey.trim());
    return { ...out, remaining: null };
  }
  if (cfg.mode !== 'server') throw new RxError('Chưa bật tính năng quét đơn trong Cài đặt.', 'invalid');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${baseUrl(cfg.serverUrl)}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.accessCode.trim()}` },
      body: JSON.stringify({ image: image.base64, mediaType: image.mediaType }),
      signal: controller.signal,
    });
  } catch {
    throw new RxError('Không kết nối được máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ.', 'network');
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<ScanOutput> & { error?: { code?: string; message?: string } };
  if (!res.ok || !body.result) {
    const msg = body.error?.message ?? `Máy chủ trả lỗi ${res.status}`;
    if (res.status === 401) throw new RxError('Mã truy cập không đúng. Kiểm tra lại trong Cài đặt.', 'unauthorized');
    if (res.status === 429) throw new RxError(msg, 'rate_limited');
    if (res.status === 413) throw new RxError('Ảnh quá lớn.', 'too_large');
    throw new RxError(msg, 'upstream');
  }
  return { result: body.result, usage: body.usage ?? { input_tokens: 0, output_tokens: 0 }, remaining: body.remaining ?? null };
}

/** Kiểm tra máy chủ có chạy không (không tốn lượt quét). Báo lỗi cụ thể để dễ xử lý. */
export async function checkServer(cfg: RxConfig): Promise<string> {
  if (!normalizeServerUrl(cfg.serverUrl)) throw new Error('Chưa nhập địa chỉ máy chủ. Dán địa chỉ mà lệnh "npx wrangler deploy" in ra, dạng https://nhac-thuoc-scan.<tên>.workers.dev');
  const url = `${baseUrl(cfg.serverUrl)}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch {
    throw new Error(
      `Không mở được ${url}\n\n• Kiểm tra điện thoại có mạng (thử tắt Wi-Fi, dùng 4G).\n• Mở đúng địa chỉ này bằng Chrome trên điện thoại xem có hiện {"ok":true...} không.\n• Một số mạng/DNS chặn tên miền workers.dev — nếu Chrome cũng không mở được, xem hướng dẫn gắn tên miền riêng.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new Error(`Máy chủ trả 404 tại ${url}.\nĐịa chỉ sai hoặc Worker chưa được deploy (chạy lại: npx wrangler deploy).`);
  if (!res.ok) throw new Error(`Máy chủ trả lỗi ${res.status} tại ${url}.`);
  const body = (await res.json().catch(() => ({}))) as { service?: string; model?: string };
  if (body.service !== 'nhac-thuoc-scan') throw new Error(`${url} trả về nội dung lạ — đây không phải máy chủ quét đơn của app.`);
  return body.model ?? '';
}
