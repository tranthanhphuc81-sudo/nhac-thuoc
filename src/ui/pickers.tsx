import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Button, Txt } from './components';
import { colors, radius } from './theme';

type Mode = 'date' | 'time';

type PickerRequest = {
  mode: Mode;
  value: Date;
  title: string;
  minimumDate?: Date;
  onPick: (d: Date) => void;
};

/**
 * Hook mở bộ chọn ngày/giờ đa nền tảng.
 * Android: hộp thoại hệ thống. iOS: modal có bánh xe cuộn + nút "Xong".
 */
export function usePicker() {
  const [req, setReq] = useState<PickerRequest | null>(null);
  const [temp, setTemp] = useState(new Date());

  const open = (r: PickerRequest) => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: r.value,
        mode: r.mode,
        is24Hour: true,
        minimumDate: r.minimumDate,
        onValueChange: (_e, d) => r.onPick(d),
      });
      return;
    }
    setTemp(r.value);
    setReq(r);
  };

  const element =
    Platform.OS === 'ios' && req ? (
      <Modal transparent animationType="slide" visible onRequestClose={() => setReq(null)}>
        <Pressable style={styles.backdrop} onPress={() => setReq(null)} />
        <View style={styles.sheet}>
          <Txt size={18} weight="700" center>
            {req.title}
          </Txt>
          <DateTimePicker
            value={temp}
            mode={req.mode}
            display="spinner"
            locale="vi-VN"
            minimumDate={req.minimumDate}
            onValueChange={(_e, d) => setTemp(d)}
            style={{ alignSelf: 'stretch' }}
          />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button title="Hủy" variant="ghost" onPress={() => setReq(null)} style={{ flex: 1 }} />
            <Button
              title="Xong"
              onPress={() => {
                req.onPick(temp);
                setReq(null);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Modal>
    ) : null;

  return { open, element };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: {
    backgroundColor: colors.card,
    padding: 20,
    paddingBottom: 36,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: 12,
  },
});
