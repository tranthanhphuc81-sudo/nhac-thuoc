import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

const ANDROID_PACKAGE = Constants.expoConfig?.android?.package ?? 'vn.nhacthuoc.app';

async function tryIntent(action: string, params?: IntentLauncher.IntentLauncherParams): Promise<boolean> {
  try {
    await IntentLauncher.startActivityAsync(action, params);
    return true;
  } catch {
    return false;
  }
}

export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    const ok = await tryIntent(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
      extra: { 'android.provider.extra.APP_PACKAGE': ANDROID_PACKAGE },
    });
    if (ok) return;
  }
  await Linking.openSettings();
}

/** Android 12+: quyền "Báo thức và lời nhắc" để thông báo đến đúng phút */
export const needsExactAlarm = Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 31;

export async function openExactAlarmSettings(): Promise<void> {
  const ok = await tryIntent(IntentLauncher.ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM, { data: `package:${ANDROID_PACKAGE}` });
  if (!ok) await Linking.openSettings();
}

export async function openBatterySettings(): Promise<void> {
  const ok = await tryIntent(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
  if (!ok) await Linking.openSettings();
}
