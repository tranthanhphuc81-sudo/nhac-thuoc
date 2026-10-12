import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { toDateKey } from './date';
import { getMedication, getMedications, getSetting, loadSettings, setDoseStatus, setSetting } from './repo';
import { daysOfStockLeft, isLowStock, medLine, planNotifications, type PlannedNotification } from './schedule';
import type { DoseLogStatus } from './types';

export const CHANNEL_ID = 'medication-reminders';
export const STOCK_CHANNEL_ID = 'stock-alerts';
export const CATEGORY_ID = 'dose_reminder';

export const ACTION_TAKE = 'TAKE';
export const ACTION_SNOOZE = 'SNOOZE';
export const ACTION_SKIP = 'SKIP';

/** iOS giới hạn 64 thông báo chờ cho mỗi app; chừa chỗ cho "nhắc lại" và cảnh báo hết thuốc */
const IOS_BUDGET = 56;
/** Android không giới hạn cứng nhưng nhiều hãng giới hạn ~500 alarm/app */
const ANDROID_BUDGET = 300;
const HORIZON_DAYS = Platform.OS === 'ios' ? 14 : 45;
/** Bản web chỉ dùng để xem trước giao diện: không có thông báo hẹn giờ */
const IS_WEB = Platform.OS === 'web';

export type DoseNotificationData = {
  kind: 'dose' | 'snooze';
  time: string;
  /** Ngày của cữ thuốc. Với trigger lặp lại thì null → lấy theo ngày nhận thông báo */
  date: string | null;
  medIds: number[];
  hash?: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

let setupDone = false;

/** Tạo kênh thông báo (Android) và nhóm nút hành động. Gọi trước khi xin quyền. */
export async function setupNotifications(): Promise<void> {
  if (setupDone || IS_WEB) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Nhắc uống thuốc',
      description: 'Thông báo đúng giờ uống thuốc',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 250, 400, 250, 400],
      enableVibrate: true,
      lightColor: '#0F766E',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
    });
    await Notifications.setNotificationChannelAsync(STOCK_CHANNEL_ID, {
      name: 'Cảnh báo sắp hết thuốc',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    { identifier: ACTION_TAKE, buttonTitle: '✅ Đã uống', options: { opensAppToForeground: true } },
    { identifier: ACTION_SNOOZE, buttonTitle: '⏰ Nhắc lại sau', options: { opensAppToForeground: true } },
    { identifier: ACTION_SKIP, buttonTitle: 'Bỏ qua', options: { opensAppToForeground: true, isDestructive: true } },
  ]);
  setupDone = true;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  if (IS_WEB) return 'granted';
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  if (IS_WEB) return 'granted';
  await setupNotifications();
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

function toTrigger(p: PlannedNotification): Notifications.SchedulableNotificationTriggerInput {
  const t = p.trigger;
  const channelId = CHANNEL_ID;
  switch (t.kind) {
    case 'daily':
      return { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: t.hour, minute: t.minute, channelId };
    case 'weekly':
      return { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: t.weekday, hour: t.hour, minute: t.minute, channelId };
    case 'date':
      return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: t.timestamp, channelId };
  }
}

export type SyncResult = { scheduled: number; dropped: number; coveredUntil: string | null };

let syncing: Promise<SyncResult> | null = null;

/**
 * Đồng bộ thông báo đã hẹn với dữ liệu thuốc.
 * Chỉ hủy/hẹn lại những thông báo thay đổi, giữ nguyên các lần "nhắc lại" đang chờ.
 */
export function syncNotifications(db: SQLiteDatabase): Promise<SyncResult> {
  if (!syncing) {
    syncing = doSync(db).finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

async function doSync(db: SQLiteDatabase): Promise<SyncResult> {
  if (IS_WEB) return { scheduled: 0, dropped: 0, coveredUntil: null };
  await setupNotifications();
  const meds = await getMedications(db);
  const plan = planNotifications(meds, new Date(), {
    budget: Platform.OS === 'ios' ? IOS_BUDGET : ANDROID_BUDGET,
    horizonDays: HORIZON_DAYS,
  });

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const existing = new Map<string, string | undefined>();
  for (const req of scheduled) {
    const data = req.content.data as Partial<DoseNotificationData> | undefined;
    if (data?.kind === 'dose') existing.set(req.identifier, data.hash);
  }
  const wanted = new Map(plan.items.map((p) => [p.id, p]));

  for (const [id, hash] of existing) {
    const want = wanted.get(id);
    if (!want || want.hash !== hash) await Notifications.cancelScheduledNotificationAsync(id);
  }
  for (const p of plan.items) {
    if (existing.get(p.id) === p.hash) continue;
    const data: DoseNotificationData = { kind: 'dose', time: p.time, date: p.date, medIds: p.medIds, hash: p.hash };
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: {
          title: p.title,
          body: p.body,
          data,
          sound: 'default',
          categoryIdentifier: CATEGORY_ID,
          priority: Notifications.AndroidNotificationPriority.MAX,
          autoDismiss: true,
        },
        trigger: toTrigger(p),
      });
    } catch (e) {
      console.warn('Không hẹn được thông báo', p.id, e);
    }
  }

  const result: SyncResult = { scheduled: plan.items.length, dropped: plan.dropped, coveredUntil: plan.coveredUntil };
  await setSetting(db, 'last_sync', JSON.stringify({ ...result, at: new Date().toISOString() }));
  return result;
}

export async function getLastSync(db: SQLiteDatabase): Promise<(SyncResult & { at: string }) | null> {
  const raw = await getSetting(db, 'last_sync');
  return raw ? (JSON.parse(raw) as SyncResult & { at: string }) : null;
}

export async function countScheduled(): Promise<number> {
  if (IS_WEB) return 0;
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}

/** Hẹn nhắc lại một cữ sau N phút */
export async function snooze(db: SQLiteDatabase, data: DoseNotificationData, date: string): Promise<Date> {
  const settings = await loadSettings(db);
  const meds = (await getMedications(db)).filter((m) => data.medIds.includes(m.id));
  const at = new Date(Date.now() + settings.snoozeMinutes * 60_000);
  const payload: DoseNotificationData = { kind: 'snooze', time: data.time, date, medIds: data.medIds };
  await Notifications.scheduleNotificationAsync({
    identifier: `snooze|${date}|${data.time}`,
    content: {
      title: `⏰ Nhắc lại: thuốc lúc ${data.time}`,
      body: meds.length ? meds.map((m) => (meds.length > 1 ? `• ${medLine(m)}` : medLine(m))).join('\n') : 'Bạn chưa uống thuốc',
      data: payload,
      sound: 'default',
      categoryIdentifier: CATEGORY_ID,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL_ID },
  });
  return at;
}

/** Hủy lần nhắc lại đang chờ và gỡ thông báo đang hiện của cữ này */
export async function clearDoseNotifications(date: string, time: string): Promise<void> {
  if (IS_WEB) return;
  await Notifications.cancelScheduledNotificationAsync(`snooze|${date}|${time}`);
  const presented = await Notifications.getPresentedNotificationsAsync();
  for (const n of presented) {
    const d = n.request.content.data as Partial<DoseNotificationData> | undefined;
    if (!d?.time || d.time !== time) continue;
    const nDate = d.date ?? toDateKey(new Date(n.date));
    if (nDate === date) await Notifications.dismissNotificationAsync(n.request.identifier);
  }
}

/** Ghi nhận trạng thái + gỡ thông báo + cảnh báo sắp hết thuốc */
export async function recordDoses(
  db: SQLiteDatabase,
  entries: { medicationId: number; date: string; time: string }[],
  status: DoseLogStatus | null,
): Promise<void> {
  const res = await setDoseStatus(db, entries, status);
  if (status !== null) {
    const slots = new Set(entries.map((e) => `${e.date}|${e.time}`));
    for (const s of slots) {
      const [date, time] = s.split('|');
      await clearDoseNotifications(date, time).catch(() => undefined);
    }
  }
  if (status === 'taken' && res.stockChanged.length) await maybeWarnLowStock(db, res.stockChanged.map((s) => s.medicationId));
}

async function maybeWarnLowStock(db: SQLiteDatabase, medIds: number[]): Promise<void> {
  if (IS_WEB) return;
  const settings = await loadSettings(db);
  const today = toDateKey(new Date());
  for (const id of medIds) {
    const med = await getMedication(db, id);
    if (!med || !isLowStock(med, settings.lowStockDays)) continue;
    const key = `low_stock_notified_${id}`;
    if ((await getSetting(db, key)) === today) continue;
    await setSetting(db, key, today);
    const left = daysOfStockLeft(med);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ Sắp hết ${med.name}`,
        body:
          med.stock === 0
            ? 'Đã hết thuốc. Hãy mua thêm hoặc tái khám để không bị gián đoạn.'
            : `Còn ${med.stock} ${med.unit} (khoảng ${left} ngày). Nhớ mua thêm nhé.`,
        data: { kind: 'stock', medicationId: id },
      },
      trigger: Platform.OS === 'android' ? { channelId: STOCK_CHANNEL_ID } : null,
    });
  }
}

/**
 * Xử lý khi người dùng bấm vào thông báo / nút hành động.
 * Trả về true nếu đã xử lý (để không xử lý trùng).
 */
export async function handleNotificationResponse(db: SQLiteDatabase, response: Notifications.NotificationResponse): Promise<void> {
  const data = response.notification.request.content.data as Partial<DoseNotificationData> | undefined;
  if (!data || (data.kind !== 'dose' && data.kind !== 'snooze') || !data.time || !data.medIds) return;

  // Chống xử lý trùng (listener + getLastNotificationResponseAsync khi mở app từ trạng thái tắt)
  const key = `${response.notification.request.identifier}|${response.notification.date}|${response.actionIdentifier}`;
  if ((await getSetting(db, 'last_response_key')) === key) return;
  await setSetting(db, 'last_response_key', key);

  const date = data.date ?? toDateKey(new Date(response.notification.date));
  const full: DoseNotificationData = { kind: data.kind, time: data.time, date, medIds: data.medIds };
  const entries = data.medIds.map((medicationId) => ({ medicationId, date, time: data.time! }));

  switch (response.actionIdentifier) {
    case ACTION_TAKE:
      await recordDoses(db, entries, 'taken');
      break;
    case ACTION_SKIP:
      await recordDoses(db, entries, 'skipped');
      break;
    case ACTION_SNOOZE:
      await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
      await snooze(db, full, date);
      break;
    default:
      // Bấm vào thân thông báo → chỉ mở app (màn hình Hôm nay)
      break;
  }
}

/** Gửi thông báo thử sau vài giây để kiểm tra âm thanh/hiển thị */
export async function sendTestNotification(seconds = 5): Promise<void> {
  await setupNotifications();
  const now = new Date();
  const at = new Date(now.getTime() + seconds * 1000);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '💊 Thông báo thử',
      body: `Nếu bạn thấy thông báo này lúc ${time} và nghe chuông, mọi thứ đã sẵn sàng.`,
      data: { kind: 'test' },
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId: CHANNEL_ID },
  });
}
