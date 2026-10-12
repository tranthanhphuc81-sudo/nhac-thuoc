/**
 * Chuẩn hóa địa chỉ máy chủ người dùng nhập: bỏ khoảng trắng, thêm https:// nếu thiếu,
 * bỏ /health hoặc /scan dán thừa ở cuối, bỏ dấu / cuối.
 */
export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\s+/g, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '').replace(/\/(health|scan)$/i, '').replace(/\/+$/, '');
  return u;
}
