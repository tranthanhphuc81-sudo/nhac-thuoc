import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { toDateKey } from './date';
import { exportBackup, importBackup, validateBackup } from './repo';

/** Xuất toàn bộ dữ liệu ra file JSON và mở hộp thoại chia sẻ (Zalo, Drive, Email…) */
export async function shareBackup(db: SQLiteDatabase): Promise<void> {
  const data = await exportBackup(db);
  const file = new File(Paths.cache, `nhac-thuoc-${toDateKey(new Date())}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Thiết bị không hỗ trợ chia sẻ file');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Lưu bản sao lưu', UTI: 'public.json' });
}

/** Chọn file sao lưu và khôi phục. Trả về false nếu người dùng hủy. */
export async function pickAndRestore(db: SQLiteDatabase): Promise<boolean> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return false;
  const text = await new File(res.assets[0].uri).text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File không đúng định dạng JSON');
  }
  if (!validateBackup(data)) throw new Error('Đây không phải file sao lưu của ứng dụng Nhắc Uống Thuốc');
  await importBackup(db, data);
  return true;
}
