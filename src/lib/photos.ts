import { Directory, File, Paths } from 'expo-file-system';

/**
 * Ảnh thuốc được chép vào thư mục tài liệu của app và lưu dưới dạng đường dẫn tương đối
 * (vì trên iOS đường dẫn tuyệt đối của thư mục app có thể đổi sau mỗi lần cập nhật).
 */
const PHOTO_DIR = 'photos';

export async function savePhoto(sourceUri: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const name = `med-${Date.now()}.jpg`;
  await new File(sourceUri).copy(new File(dir, name));
  return `${PHOTO_DIR}/${name}`;
}

export function resolvePhoto(stored: string | null): string | null {
  if (!stored) return null;
  if (stored.includes('://')) return stored;
  return new File(Paths.document, stored).uri;
}

export function deletePhoto(stored: string | null): void {
  if (!stored || stored.includes('://')) return;
  try {
    const f = new File(Paths.document, stored);
    if (f.exists) f.delete();
  } catch {
    // bỏ qua: ảnh đã bị xóa
  }
}
