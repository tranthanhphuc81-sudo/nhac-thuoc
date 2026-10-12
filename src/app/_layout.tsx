import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DATABASE_NAME, migrateDbIfNeeded } from '../lib/db';
import { seedDemo } from '../lib/demo';
import {
  getPermissionState,
  handleNotificationResponse,
  requestPermission,
  setupNotifications,
  syncNotifications,
} from '../lib/notifications';
import { AppProvider, useApp } from '../ui/AppContext';
import { colors } from '../ui/theme';

async function initDb(db: SQLiteDatabase) {
  await migrateDbIfNeeded(db);
  // Bản xem trước trên web: mở với ?demo=1 để có sẵn dữ liệu mẫu
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.search.includes('demo')) await seedDemo(db);
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDb}>
        <AppProvider>
          <Bootstrap />
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.primary },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="med/[id]" options={{ title: 'Thuốc' }} />
            <Stack.Screen name="guide" options={{ title: 'Nhắc đúng giờ' }} />
            <Stack.Screen name="scan" options={{ title: 'Quét đơn thuốc' }} />
          </Stack>
        </AppProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

/** Khởi tạo thông báo, xử lý nút bấm trên thông báo, đồng bộ lịch khi app quay lại foreground */
function Bootstrap() {
  const db = useSQLiteContext();
  const { bumpData } = useApp();
  const bumpRef = useRef(bumpData);
  useEffect(() => {
    bumpRef.current = bumpData;
  }, [bumpData]);

  useEffect(() => {
    let cancelled = false;

    const onResponse = async (response: Notifications.NotificationResponse) => {
      try {
        await handleNotificationResponse(db, response);
      } finally {
        bumpRef.current();
        if (router.canDismiss()) router.dismissAll();
        router.navigate('/');
      }
    };

    // Lắng nghe trước tiên để không bỏ lỡ phản hồi khi app được mở từ thông báo
    const sub = Notifications.addNotificationResponseReceivedListener(onResponse);

    (async () => {
      if (Platform.OS === 'web') return;
      await setupNotifications();
      if ((await getPermissionState()) === 'undetermined') await requestPermission();

      const last = await Notifications.getLastNotificationResponseAsync();
      if (last && !cancelled) {
        await onResponse(last);
        await Notifications.clearLastNotificationResponseAsync();
      }
      await syncNotifications(db);
    })().catch((e) => console.warn('Khởi tạo thông báo lỗi', e));

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncNotifications(db).catch(() => undefined);
        bumpRef.current();
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
      appStateSub.remove();
    };
  }, [db]);

  return null;
}
