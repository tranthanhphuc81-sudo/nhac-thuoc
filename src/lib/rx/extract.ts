/**
 * Đọc đơn thuốc bằng Claude: prompt, JSON schema và xử lý phản hồi.
 * File thuần TypeScript (không phụ thuộc React Native) — dùng chung cho app và Cloudflare Worker.
 */

export const DEFAULT_MODEL = 'claude-haiku-5-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export const RX_UNITS = ['viên', 'ml', 'gói', 'giọt', 'ống', 'muỗng', 'nhát xịt', 'miếng dán', 'khác'] as const;
export const RX_SLOTS = ['sang', 'trua', 'chieu', 'toi'] as const;
export const RX_INSTRUCTIONS = ['', 'Trước ăn', 'Sau ăn', 'Trong bữa ăn', 'Lúc đói', 'Trước khi ngủ'] as const;
export const RX_CONFIDENCE = ['high', 'medium', 'low'] as const;

export type RxSlot = (typeof RX_SLOTS)[number];

export type RxMedication = {
  name: string;
  strength: string;
  dose_amount: number;
  unit: (typeof RX_UNITS)[number];
  times_per_day: number;
  time_slots: RxSlot[];
  instructions: (typeof RX_INSTRUCTIONS)[number];
  duration_days: number;
  total_quantity: number;
  as_needed: boolean;
  note: string;
  confidence: (typeof RX_CONFIDENCE)[number];
};

export type RxResult = {
  is_prescription: boolean;
  issue_date: string;
  medications: RxMedication[];
  warnings: string[];
};

/** Mọi trường đều bắt buộc; "không rõ" dùng 0 / "" để tránh giới hạn kiểu nullable của structured outputs */
export const RX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_prescription', 'issue_date', 'medications', 'warnings'],
  properties: {
    is_prescription: { type: 'boolean', description: 'true nếu ảnh là đơn thuốc / toa thuốc / phiếu hướng dẫn dùng thuốc' },
    issue_date: { type: 'string', description: 'Ngày kê đơn dạng YYYY-MM-DD, "" nếu không có' },
    medications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'strength',
          'dose_amount',
          'unit',
          'times_per_day',
          'time_slots',
          'instructions',
          'duration_days',
          'total_quantity',
          'as_needed',
          'note',
          'confidence',
        ],
        properties: {
          name: { type: 'string', description: 'Tên thuốc (biệt dược hoặc hoạt chất), không kèm hàm lượng' },
          strength: { type: 'string', description: 'Hàm lượng, ví dụ "500mg", "5mg/5ml"; "" nếu không có' },
          dose_amount: { type: 'number', description: 'Số lượng mỗi lần dùng, ví dụ 1, 0.5, 2, 5 (ml); 0 nếu không rõ' },
          unit: { type: 'string', enum: [...RX_UNITS] },
          times_per_day: { type: 'integer', description: 'Số lần dùng mỗi ngày; 0 nếu không rõ' },
          time_slots: { type: 'array', items: { type: 'string', enum: [...RX_SLOTS] } },
          instructions: { type: 'string', enum: [...RX_INSTRUCTIONS] },
          duration_days: { type: 'integer', description: 'Số ngày dùng nếu đơn ghi rõ; 0 nếu không ghi' },
          total_quantity: { type: 'number', description: 'Tổng số lượng được kê/cấp (theo đơn vị unit); 0 nếu không có' },
          as_needed: { type: 'boolean', description: 'true nếu chỉ dùng khi cần (khi sốt, khi đau...)' },
          note: { type: 'string', description: 'Lời dặn riêng cho thuốc này, ngắn gọn tiếng Việt; "" nếu không có' },
          confidence: { type: 'string', enum: [...RX_CONFIDENCE] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const RX_PROMPT = `Bạn đọc ảnh đơn thuốc Việt Nam (đơn in từ bệnh viện/phòng khám, đơn thuốc điện tử, hoặc đơn viết tay) và trích xuất danh sách thuốc để nhập vào ứng dụng nhắc uống thuốc.

Quy tắc:
- Chỉ ghi những gì THẬT SỰ có trên ảnh. Không đoán liều, không bịa thuốc. Chỗ không đọc được thì để 0 hoặc "" và hạ confidence.
- Tên thuốc giữ nguyên chính tả trên đơn (sửa lỗi dấu tiếng Việt hiển nhiên thì được). Hàm lượng tách sang "strength".
- "Ngày uống 2 lần, mỗi lần 1 viên" → times_per_day=2, dose_amount=1.
- "Sáng 1 viên, chiều 1 viên" → time_slots=["sang","chieu"], dose_amount=1, times_per_day=2. Nếu liều sáng/chiều khác nhau, dùng liều lớn nhất và ghi rõ trong note.
- Trưa = "trua", tối hoặc trước khi ngủ = "toi". Nếu đơn không nêu buổi thì để time_slots rỗng.
- "Uống sau ăn", "sau bữa ăn" → "Sau ăn"; "trước ăn 30 phút" → "Trước ăn"; "lúc đói" → "Lúc đói"; uống trước khi đi ngủ → "Trước khi ngủ".
- "x 7 ngày", "dùng 10 ngày" → duration_days. "SL: 20 viên", "Số lượng 20" → total_quantity.
- Siro/dung dịch theo ml thì unit="ml"; nhỏ mắt/mũi → "giọt"; thuốc xịt → "nhát xịt"; cốm/bột → "gói".
- Thuốc "khi cần", "khi sốt trên 38.5°C", "khi đau" → as_needed=true.
- confidence: "high" khi chữ rõ ràng; "medium" khi phải suy luận một phần; "low" khi đọc không chắc.
- Bỏ qua chẩn đoán, thông tin bệnh nhân, bác sĩ, giá tiền. Không đưa chúng vào note.
- warnings: ghi ngắn gọn bằng tiếng Việt những điểm người dùng cần kiểm tra lại (ví dụ "Không đọc rõ liều của thuốc thứ 3", "Ảnh bị mờ ở cuối trang").
- Nếu ảnh không phải đơn thuốc: is_prescription=false, medications=[], kèm một warning giải thích.`;

export type RxImage = { base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' };

export function buildRequestBody(image: RxImage, model: string = DEFAULT_MODEL) {
  return {
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: RX_PROMPT },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: RX_SCHEMA } },
  };
}

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const IMG_PLACEHOLDER = '__RX_IMAGE_BASE64__';

/**
 * Tạo JSON gửi Claude mà không JSON.stringify chuỗi ảnh vài MB (tốn ~7–10 ms CPU,
 * sát giới hạn 10 ms của gói Cloudflare Workers miễn phí). Base64 không chứa ký tự
 * cần escape nên ghép thẳng vào chuỗi là an toàn — sau khi đã kiểm tra ký tự.
 */
export function serializeRequestBody(image: RxImage, model: string = DEFAULT_MODEL): string {
  if (!BASE64_RE.test(image.base64)) throw new RxError('Dữ liệu ảnh không hợp lệ.', 'bad_image');
  const template = JSON.stringify(buildRequestBody({ ...image, base64: IMG_PLACEHOLDER }, model));
  const at = template.indexOf(IMG_PLACEHOLDER);
  return template.slice(0, at) + image.base64 + template.slice(at + IMG_PLACEHOLDER.length);
}

export class RxError extends Error {
  constructor(
    message: string,
    public readonly code: 'unauthorized' | 'rate_limited' | 'too_large' | 'bad_image' | 'refused' | 'upstream' | 'network' | 'invalid',
  ) {
    super(message);
  }
}

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
};

/** Lấy JSON kết quả từ phản hồi Messages API và chuẩn hóa giá trị */
export function parseAnthropicResponse(body: AnthropicResponse): RxResult {
  if (body.stop_reason === 'refusal') throw new RxError('AI từ chối đọc ảnh này.', 'refused');
  if (body.stop_reason === 'max_tokens') throw new RxError('Đơn quá dài, AI chưa đọc hết. Hãy chụp từng phần.', 'invalid');
  const text = body.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new RxError('AI không trả về kết quả.', 'invalid');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RxError('Kết quả từ AI không đúng định dạng.', 'invalid');
  }
  return normalizeResult(raw);
}

const lower = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Chuẩn hóa (kể cả khi enum bị khác hoa/thường) để app không phải tin tuyệt đối vào AI */
export function normalizeResult(raw: unknown): RxResult {
  const r = (raw ?? {}) as Partial<Record<keyof RxResult, unknown>>;
  const meds = Array.isArray(r.medications) ? r.medications : [];
  return {
    is_prescription: r.is_prescription !== false,
    issue_date: typeof r.issue_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.issue_date) ? r.issue_date : '',
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string' && !!w.trim()) : [],
    medications: meds
      .map((m): RxMedication => {
        const x = (m ?? {}) as Record<string, unknown>;
        const unit = RX_UNITS.find((u) => u === lower(x.unit)) ?? 'viên';
        const instr = RX_INSTRUCTIONS.find((i) => i.toLowerCase() === lower(x.instructions)) ?? '';
        const slots = Array.isArray(x.time_slots)
          ? RX_SLOTS.filter((s) => (x.time_slots as unknown[]).some((t) => lower(t) === s))
          : [];
        const conf = RX_CONFIDENCE.find((c) => c === lower(x.confidence)) ?? 'low';
        return {
          name: typeof x.name === 'string' ? x.name.trim() : '',
          strength: typeof x.strength === 'string' ? x.strength.trim() : '',
          dose_amount: num(x.dose_amount),
          unit,
          times_per_day: Math.round(num(x.times_per_day)),
          time_slots: slots,
          instructions: instr,
          duration_days: Math.round(num(x.duration_days)),
          total_quantity: num(x.total_quantity),
          as_needed: x.as_needed === true,
          note: typeof x.note === 'string' ? x.note.trim() : '',
          confidence: conf,
        };
      })
      .filter((m) => m.name.length > 0),
  };
}

/** Gọi thẳng Claude API (dùng trong Worker, hoặc trong app ở chế độ "API key riêng") */
export async function callClaude(
  image: RxImage,
  apiKey: string,
  opts: { model?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ result: RxResult; usage: { input_tokens: number; output_tokens: number } }> {
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: serializeRequestBody(image, opts.model),
    });
  } catch {
    throw new RxError('Không kết nối được tới dịch vụ AI. Kiểm tra mạng.', 'network');
  }
  const body = (await res.json().catch(() => ({}))) as AnthropicResponse;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new RxError('API key không hợp lệ.', 'unauthorized');
    if (res.status === 429) throw new RxError('Dịch vụ AI đang quá tải, thử lại sau ít phút.', 'rate_limited');
    if (res.status === 413) throw new RxError('Ảnh quá lớn.', 'too_large');
    if (res.status === 400 && /image/i.test(body.error?.message ?? '')) throw new RxError('Ảnh không hợp lệ.', 'bad_image');
    throw new RxError(`Lỗi dịch vụ AI (${res.status}).`, 'upstream');
  }
  return {
    result: parseAnthropicResponse(body),
    usage: { input_tokens: body.usage?.input_tokens ?? 0, output_tokens: body.usage?.output_tokens ?? 0 },
  };
}
