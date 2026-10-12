import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { pickAndRestore, shareBackup } from '../../lib/backup';
import {
  countScheduled,
  getPermissionState,
  requestPermission,
  sendTestNotification,
  syncNotifications,
  type PermissionState,
} from '../../lib/notifications';
import { needsExactAlarm, openBatterySettings, openExactAlarmSettings, openNotificationSettings } from '../../lib/system';
import { useApp } from '../../ui/AppContext';
import { RxSettings } from '../../ui/RxSettings';
import { Badge, Button, Card, Chip, Row, SectionTitle, Txt } from '../../ui/components';
import { colors } from '../../ui/theme';

const FONT_SCALES = [
  { label: 'Vừa', value: 1 },
  { label: 'Lớn', value: 1.15 },
  { label: 'Rất lớn', value: 1.3 },
];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { settings, updateSettings, bumpData } = useApp();
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [scheduled, setScheduled] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPerm(await getPermissionState());
    setScheduled(await countScheduled());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Có lỗi xảy ra', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionTitle>Thông báo</SectionTitle>
      <Card style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={17} weight="600">
            Quyền thông báo
          </Txt>
          {perm === 'granted' ? <Badge label="Đã bật" tone="success" /> : <Badge label="Chưa bật" tone="danger" />}
        </Row>
        {perm !== 'granted' && (
          <Button
            title={perm === 'denied' ? 'Mở cài đặt thông báo' : 'Bật thông báo'}
            onPress={() =>
              run('perm', async () => {
                if (perm === 'denied') await openNotificationSettings();
                else setPerm(await requestPermission());
              })
            }
          />
        )}
        <Txt size={15} color={colors.textMuted}>
          Đang hẹn {scheduled ?? '…'} nhắc nhở trên máy.
        </Txt>
        <Row gap={8}>
          <Button
            small
            variant="secondary"
            title="Gửi thử (5 giây)"
            loading={busy === 'test'}
            onPress={() =>
              run('test', async () => {
                await sendTestNotification(5);
                Alert.alert('Đã hẹn', 'Thông báo thử sẽ hiện sau 5 giây. Bạn có thể khóa màn hình để kiểm tra.');
              })
            }
            style={{ flex: 1 }}
          />
          <Button
            small
            variant="secondary"
            title="Hẹn lại tất cả"
            loading={busy === 'sync'}
            onPress={() =>
              run('sync', async () => {
                const r = await syncNotifications(db);
                await refresh();
                Alert.alert('Đã cập nhật', `Đã hẹn ${r.scheduled} nhắc nhở.`);
              })
            }
            style={{ flex: 1 }}
          />
        </Row>
        <Button small variant="ghost" title="Mở cài đặt thông báo của máy" onPress={() => openNotificationSettings()} />
      </Card>

      {Platform.OS === 'android' && (
        <>
          <SectionTitle>Để nhắc đúng giờ (Android)</SectionTitle>
          <Card style={{ gap: 10 }}>
            {needsExactAlarm && (
              <SettingAction
                title="Báo thức và lời nhắc"
                text="Cho phép để thông báo đến đúng phút, không bị dồn trễ."
                button="Mở"
                onPress={openExactAlarmSettings}
              />
            )}
            <SettingAction
              title="Tắt tối ưu pin"
              text="Chọn “Tất cả ứng dụng” → Nhắc Uống Thuốc → “Không tối ưu hóa”."
              button="Mở"
              onPress={openBatterySettings}
            />
            <Button small title="Hướng dẫn theo hãng điện thoại" variant="secondary" onPress={() => router.push('/guide')} />
          </Card>
        </>
      )}

      <SectionTitle>Nhắc nhở</SectionTitle>
      <Card style={{ gap: 14 }}>
        <Option label="Nút “Nhắc lại sau”">
          {[5, 10, 15, 30].map((m) => (
            <Chip key={m} label={`${m} phút`} selected={settings.snoozeMinutes === m} onPress={() => updateSettings({ snoozeMinutes: m })} />
          ))}
        </Option>
        <Option label="Coi là “quên uống” sau">
          {[30, 60, 120, 240].map((m) => (
            <Chip
              key={m}
              label={m < 60 ? `${m} phút` : `${m / 60} giờ`}
              selected={settings.missedAfterMinutes === m}
              onPress={() => updateSettings({ missedAfterMinutes: m })}
            />
          ))}
        </Option>
        <Option label="Báo sắp hết thuốc khi còn">
          {[3, 5, 7, 10].map((d) => (
            <Chip key={d} label={`${d} ngày`} selected={settings.lowStockDays === d} onPress={() => updateSettings({ lowStockDays: d })} />
          ))}
        </Option>
      </Card>

      <SectionTitle>Quét đơn thuốc</SectionTitle>
      <RxSettings />

      <SectionTitle>Hiển thị</SectionTitle>
      <Card>
        <Option label="Cỡ chữ">
          {FONT_SCALES.map((f) => (
            <Chip key={f.value} label={f.label} selected={settings.fontScale === f.value} onPress={() => updateSettings({ fontScale: f.value })} />
          ))}
        </Option>
      </Card>

      <SectionTitle>Dữ liệu</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Txt size={15} color={colors.textMuted}>
          Mọi dữ liệu chỉ lưu trên điện thoại này. Hãy sao lưu khi đổi máy (ảnh thuốc không nằm trong bản sao lưu).
        </Txt>
        <Button
          small
          variant="secondary"
          title="📤 Sao lưu ra file"
          loading={busy === 'backup'}
          onPress={() => run('backup', () => shareBackup(db))}
        />
        <Button
          small
          variant="ghost"
          title="📥 Khôi phục từ file"
          loading={busy === 'restore'}
          onPress={() =>
            Alert.alert('Khôi phục dữ liệu?', 'Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu trong file sao lưu.', [
              { text: 'Hủy', style: 'cancel' },
              {
                text: 'Khôi phục',
                style: 'destructive',
                onPress: () =>
                  run('restore', async () => {
                    if (!(await pickAndRestore(db))) return;
                    await syncNotifications(db);
                    bumpData();
                    await refresh();
                    Alert.alert('Xong', 'Đã khôi phục dữ liệu và hẹn lại nhắc nhở.');
                  }),
              },
            ])
          }
        />
      </Card>

      <Txt size={13} color={colors.textSoft} center style={{ marginTop: 24 }}>
        Nhắc Uống Thuốc v{Constants.expoConfig?.version ?? '1.0.0'} · Nhắc thuốc chạy hoàn toàn offline{'\n'}
        Ứng dụng chỉ hỗ trợ nhắc nhở, không thay thế chỉ định của bác sĩ.
      </Txt>
    </ScrollView>
  );
}

function Option({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt size={16} weight="600">
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

function SettingAction({ title, text, button, onPress }: { title: string; text: string; button: string; onPress: () => void }) {
  return (
    <Row gap={12} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 10 }}>
      <View style={{ flex: 1 }}>
        <Txt size={16} weight="700">
          {title}
        </Txt>
        <Txt size={14} color={colors.textMuted}>
          {text}
        </Txt>
      </View>
      <Button small variant="secondary" title={button} onPress={onPress} />
    </Row>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
});
