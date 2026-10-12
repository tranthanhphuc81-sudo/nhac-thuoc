import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import { sendTestNotification } from '../lib/notifications';
import { needsExactAlarm, openAppSettings, openBatterySettings, openExactAlarmSettings, openNotificationSettings } from '../lib/system';
import { useApp } from '../ui/AppContext';
import { Banner, Button, Card, Chip, Row, SectionTitle, Txt } from '../ui/components';
import { colors } from '../ui/theme';

type Brand = 'xiaomi' | 'oppo' | 'vivo' | 'samsung' | 'other';

const BRAND_LABEL: Record<Brand, string> = {
  xiaomi: 'Xiaomi / Redmi / POCO',
  oppo: 'Oppo / Realme / OnePlus',
  vivo: 'Vivo / iQOO',
  samsung: 'Samsung',
  other: 'Hãng khác',
};

const BRAND_STEPS: Record<Brand, string[]> = {
  xiaomi: [
    'Cài đặt → Ứng dụng → Quản lý ứng dụng → Nhắc Uống Thuốc.',
    'Bật “Tự khởi động” (Autostart).',
    'Mục “Tiết kiệm pin” → chọn “Không hạn chế”.',
    'Mục “Thông báo” → bật tất cả, bật “Màn hình khóa”, “Thông báo nổi” và “Âm thanh”.',
    'Mở đa nhiệm (nút vuông), nhấn giữ ứng dụng → bấm biểu tượng ổ khóa để không bị dọn.',
  ],
  oppo: [
    'Cài đặt → Pin → Mức sử dụng pin của ứng dụng (hoặc “Quản lý pin”) → Nhắc Uống Thuốc.',
    'Bật “Cho phép hoạt động nền” và “Cho phép tự khởi chạy”, tắt “Tối ưu hóa”.',
    'Cài đặt → Thông báo & thanh trạng thái → Nhắc Uống Thuốc → bật “Biểu ngữ”, “Màn hình khóa”, “Âm thanh”.',
    'Mở đa nhiệm, kéo ứng dụng xuống hoặc bấm “⋮” → “Khóa” để không bị dọn.',
  ],
  vivo: [
    'Cài đặt → Pin → Mức tiêu thụ điện năng nền cao → bật cho Nhắc Uống Thuốc.',
    'i Manager (Quản lý điện thoại) → Quản lý ứng dụng → Tự khởi động → bật Nhắc Uống Thuốc.',
    'Cài đặt → Thông báo & thanh trạng thái → Nhắc Uống Thuốc → bật tất cả.',
    'Mở đa nhiệm, kéo ứng dụng xuống để khóa.',
  ],
  samsung: [
    'Cài đặt → Ứng dụng → Nhắc Uống Thuốc → Pin → chọn “Không hạn chế”.',
    'Cài đặt → Chăm sóc thiết bị → Pin → Giới hạn sử dụng nền → đảm bảo app KHÔNG nằm trong “Ứng dụng ngủ” / “Ứng dụng ngủ sâu”.',
    'Cài đặt → Ứng dụng → Nhắc Uống Thuốc → Thông báo → bật, chọn kiểu “Cảnh báo”.',
    'Cài đặt → Ứng dụng → Nhắc Uống Thuốc → “Báo thức và lời nhắc” → Cho phép.',
  ],
  other: [
    'Cài đặt → Ứng dụng → Nhắc Uống Thuốc → Pin → chọn “Không hạn chế” / “Không tối ưu hóa”.',
    'Bật “Tự khởi động” hoặc “Chạy nền” nếu máy có mục này.',
    'Bật đầy đủ thông báo: âm thanh, màn hình khóa, hiển thị nổi.',
    'Không dùng các app “dọn RAM”, “tăng tốc” vì chúng sẽ tắt nhắc nhở.',
  ],
};

function detectBrand(): Brand {
  const m = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/.test(m)) return 'xiaomi';
  if (/oppo|realme|oneplus/.test(m)) return 'oppo';
  if (/vivo|iqoo/.test(m)) return 'vivo';
  if (/samsung/.test(m)) return 'samsung';
  return 'other';
}

export default function GuideScreen() {
  const { updateSettings } = useApp();
  const [brand, setBrand] = useState<Brand>(detectBrand);

  if (Platform.OS === 'ios') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={{ gap: 10 }}>
          <Txt size={18} weight="700">
            iPhone
          </Txt>
          <Txt size={16}>1. Cài đặt → Thông báo → Nhắc Uống Thuốc → bật “Cho phép thông báo”, “Âm thanh”, “Màn hình khóa”.</Txt>
          <Txt size={16}>2. Nếu dùng chế độ Tập trung (Focus / Không làm phiền), thêm ứng dụng vào danh sách được phép.</Txt>
          <Txt size={16}>3. Mở ứng dụng ít nhất 1 lần mỗi tuần nếu đang uống thuốc theo đợt để lịch được gia hạn.</Txt>
          <Button title="Mở cài đặt" onPress={() => openAppSettings()} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Banner
        tone="info"
        title="Vì sao cần làm bước này?"
        text="Ứng dụng chạy offline và tự hẹn giờ trên máy. Nhưng nhiều hãng điện thoại tự “ngủ đông” ứng dụng để tiết kiệm pin, làm thông báo đến trễ hoặc không đến."
      />

      <SectionTitle>Bước 1 · Quyền cơ bản</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Step n={1} text="Cho phép thông báo (âm thanh, màn hình khóa)." button="Mở" onPress={openNotificationSettings} />
        {needsExactAlarm && <Step n={2} text="Cho phép “Báo thức và lời nhắc” để nhắc đúng phút." button="Mở" onPress={openExactAlarmSettings} />}
        <Step n={needsExactAlarm ? 3 : 2} text="Tắt tối ưu hóa pin cho ứng dụng." button="Mở" onPress={openBatterySettings} />
      </Card>

      <SectionTitle>Bước 2 · Theo hãng điện thoại</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {(Object.keys(BRAND_LABEL) as Brand[]).map((b) => (
          <Chip key={b} label={BRAND_LABEL[b]} selected={brand === b} onPress={() => setBrand(b)} />
        ))}
      </View>
      <Card style={{ gap: 10 }}>
        {BRAND_STEPS[brand].map((s, i) => (
          <Row key={s} gap={10} style={{ alignItems: 'flex-start' }}>
            <View style={styles.num}>
              <Txt size={14} weight="800" color="#fff">
                {i + 1}
              </Txt>
            </View>
            <Txt size={16} style={{ flex: 1 }}>
              {s}
            </Txt>
          </Row>
        ))}
        <Button small variant="secondary" title="Mở trang thông tin ứng dụng" onPress={() => openAppSettings()} />
      </Card>

      <SectionTitle>Bước 3 · Kiểm tra</SectionTitle>
      <Card style={{ gap: 10 }}>
        <Txt size={16}>Bấm gửi thử, rồi khóa màn hình ngay. Sau 1 phút bạn phải nghe chuông và thấy thông báo.</Txt>
        <Button title="Gửi thông báo thử sau 60 giây" variant="secondary" onPress={() => sendTestNotification(60)} />
      </Card>

      <Button
        title="Tôi đã thiết lập xong"
        icon="✓"
        variant="success"
        style={{ marginTop: 24 }}
        onPress={async () => {
          await updateSettings({ reliabilitySetupDone: true });
          router.back();
        }}
      />
    </ScrollView>
  );
}

function Step({ n, text, button, onPress }: { n: number; text: string; button: string; onPress: () => void }) {
  return (
    <Row gap={10}>
      <View style={styles.num}>
        <Txt size={14} weight="800" color="#fff">
          {n}
        </Txt>
      </View>
      <Txt size={16} style={{ flex: 1 }}>
        {text}
      </Txt>
      <Button small variant="secondary" title={button} onPress={onPress} />
    </Row>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  num: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
