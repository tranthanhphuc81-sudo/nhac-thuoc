import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { addDays, diffDays, formatDateFull, parseDateKey, toDateKey, toTimeKey, WEEK_ORDER, WEEKDAY_SHORT } from '../../lib/date';
import { syncNotifications } from '../../lib/notifications';
import { deletePhoto, savePhoto } from '../../lib/photos';
import { archiveMedication, getMedication, saveMedication } from '../../lib/repo';
import { formatAmount } from '../../lib/schedule';
import type { MedicationInput } from '../../lib/types';
import { useApp } from '../../ui/AppContext';
import { Button, Chip, MedAvatar, Row, SectionTitle, Txt } from '../../ui/components';
import { usePicker } from '../../ui/pickers';
import { colors, INSTRUCTIONS, MED_COLORS, radius, UNITS } from '../../ui/theme';

const TIME_PRESETS = [
  { label: 'Sáng', time: '07:00' },
  { label: 'Trưa', time: '12:00' },
  { label: 'Chiều', time: '17:00' },
  { label: 'Tối', time: '21:00' },
];

const DURATION_PRESETS = [3, 5, 7, 10, 14, 30];

export default function MedicationForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const medId = isNew ? undefined : Number(id);
  const db = useSQLiteContext();
  const { fs, bumpData } = useApp();
  const picker = usePicker();

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [unit, setUnit] = useState('viên');
  const [doseAmount, setDoseAmount] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState(MED_COLORS[0]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [originalPhoto, setOriginalPhoto] = useState<string | null>(null);
  const [times, setTimes] = useState<string[]>(isNew ? ['08:00'] : []);
  const [everyDay, setEveryDay] = useState(true);
  const [days, setDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(toDateKey(new Date()));
  const [isCourse, setIsCourse] = useState(false);
  const [courseDays, setCourseDays] = useState('7');
  const [trackStock, setTrackStock] = useState(false);
  const [stock, setStock] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!medId) return;
    getMedication(db, medId).then((m) => {
      if (!m) {
        router.back();
        return;
      }
      setName(m.name);
      setDosage(m.dosage);
      setUnit(m.unit);
      setDoseAmount(m.doseAmount);
      setInstructions(m.instructions);
      setNotes(m.notes);
      setColor(m.color);
      setPhoto(m.photoUri);
      setOriginalPhoto(m.photoUri);
      setTimes(m.times);
      setEveryDay(m.days.length === 0 || m.days.length === 7);
      setDays(m.days);
      setStartDate(m.startDate);
      setIsCourse(!!m.endDate);
      if (m.endDate) setCourseDays(String(diffDays(m.startDate, m.endDate) + 1));
      setTrackStock(m.stock !== null);
      setStock(m.stock !== null ? String(m.stock) : '');
      setActive(m.active);
      setLoading(false);
    });
  }, [db, medId]);

  const nCourse = Math.max(1, parseInt(courseDays, 10) || 0);
  const endDate = isCourse ? addDays(startDate, nCourse - 1) : null;

  const addTime = (t: string) => setTimes((prev) => [...new Set([...prev, t])].sort());

  const editTime = (index: number | null) => {
    const base = index === null ? '08:00' : times[index];
    const [h, m] = base.split(':').map(Number);
    const value = new Date();
    value.setHours(h, m, 0, 0);
    picker.open({
      mode: 'time',
      value,
      title: index === null ? 'Thêm giờ uống' : 'Đổi giờ uống',
      onPick: (d) => {
        const t = toTimeKey(d);
        setTimes((prev) => {
          const next = index === null ? [...prev, t] : prev.map((x, i) => (i === index ? t : x));
          return [...new Set(next)].sort();
        });
      },
    });
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Cần quyền camera', 'Hãy cho phép ứng dụng dùng camera trong Cài đặt của điện thoại.');
        return;
      }
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const saved = await savePhoto(res.assets[0].uri);
    if (photo && photo !== originalPhoto) deletePhoto(photo);
    setPhoto(saved);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return Alert.alert('Thiếu tên thuốc', 'Vui lòng nhập tên thuốc.');
    if (times.length === 0) return Alert.alert('Thiếu giờ uống', 'Thêm ít nhất một giờ uống.');
    if (!everyDay && days.length === 0) return Alert.alert('Chưa chọn ngày', 'Chọn ít nhất một ngày trong tuần.');
    if (doseAmount <= 0) return Alert.alert('Liều không hợp lệ', 'Số lượng mỗi lần uống phải lớn hơn 0.');
    const stockNum = trackStock ? Number(stock.replace(',', '.')) : null;
    if (trackStock && (stockNum === null || !Number.isFinite(stockNum) || stockNum < 0)) {
      return Alert.alert('Số lượng không hợp lệ', 'Nhập số lượng thuốc còn lại, ví dụ 30.');
    }

    const input: MedicationInput = {
      name: trimmed,
      dosage,
      unit,
      doseAmount,
      instructions,
      notes,
      color,
      photoUri: photo,
      startDate,
      endDate,
      days: everyDay ? [] : days,
      stock: stockNum,
      active,
      times,
    };
    setSaving(true);
    try {
      await saveMedication(db, input, medId);
      if (originalPhoto && originalPhoto !== photo) deletePhoto(originalPhoto);
      await syncNotifications(db);
      bumpData();
      router.back();
    } catch (e) {
      Alert.alert('Không lưu được', String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!medId) return;
    Alert.alert('Xóa thuốc này?', 'Ứng dụng sẽ ngừng nhắc. Lịch sử uống thuốc trước đây vẫn được giữ lại.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: async () => {
          await archiveMedication(db, medId);
          deletePhoto(originalPhoto);
          await syncNotifications(db);
          bumpData();
          router.back();
        },
      },
    ]);
  };

  const inputStyle = [styles.input, { fontSize: fs(17) }];

  if (loading) return <Stack.Screen options={{ title: 'Đang tải…' }} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Thêm thuốc' : 'Sửa thuốc' }} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Row gap={14}>
          <MedAvatar color={color} photoUri={photo} size={72} />
          <View style={{ flex: 1, gap: 8 }}>
            <Row gap={8}>
              <Button small variant="secondary" title="📷 Chụp" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
              <Button small variant="secondary" title="🖼️ Chọn ảnh" onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
            </Row>
            {photo ? <Button small variant="ghost" title="Bỏ ảnh" onPress={() => setPhoto(null)} /> : null}
          </View>
        </Row>

        <SectionTitle>Tên thuốc *</SectionTitle>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ví dụ: Amlodipin"
          placeholderTextColor={colors.textSoft}
          style={inputStyle}
          autoFocus={isNew}
          maxLength={80}
        />

        <SectionTitle>Hàm lượng (không bắt buộc)</SectionTitle>
        <TextInput
          value={dosage}
          onChangeText={setDosage}
          placeholder="Ví dụ: 5mg, 500mg"
          placeholderTextColor={colors.textSoft}
          style={inputStyle}
          maxLength={40}
        />

        <SectionTitle>Mỗi lần uống</SectionTitle>
        <Row gap={12}>
          <Button title="−" variant="secondary" onPress={() => setDoseAmount((v) => Math.max(0.25, Math.round((v - 0.5) * 4) / 4))} style={{ width: 56 }} />
          <View style={styles.amountBox}>
            <Txt size={24} weight="800" center>
              {formatAmount(doseAmount)}
            </Txt>
          </View>
          <Button title="+" variant="secondary" onPress={() => setDoseAmount((v) => Math.round((v + 0.5) * 4) / 4)} style={{ width: 56 }} />
          <Txt size={18} weight="600">
            {unit}
          </Txt>
        </Row>
        <View style={styles.wrap}>
          {UNITS.map((u) => (
            <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </View>

        <SectionTitle>Cách uống</SectionTitle>
        <View style={styles.wrap}>
          {INSTRUCTIONS.map((ins) => (
            <Chip key={ins || 'none'} label={ins || 'Không ghi'} selected={instructions === ins} onPress={() => setInstructions(ins)} />
          ))}
        </View>

        <SectionTitle>Giờ uống *</SectionTitle>
        <View style={styles.wrap}>
          {times.map((t, i) => (
            <View key={t} style={styles.timeChip}>
              <Pressable onPress={() => editTime(i)} accessibilityLabel={`Đổi giờ ${t}`} style={{ paddingVertical: 8, paddingLeft: 14 }}>
                <Txt size={22} weight="800" color={colors.primaryDark}>
                  {t}
                </Txt>
              </Pressable>
              <Pressable
                onPress={() => setTimes((prev) => prev.filter((x) => x !== t))}
                accessibilityLabel={`Xóa giờ ${t}`}
                hitSlop={8}
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}
              >
                <Txt size={18} color={colors.danger}>
                  ✕
                </Txt>
              </Pressable>
            </View>
          ))}
          <Button small title="＋ Thêm giờ" variant="secondary" onPress={() => editTime(null)} />
        </View>
        <Txt size={14} color={colors.textSoft} style={{ marginTop: 10 }}>
          Thêm nhanh:
        </Txt>
        <View style={[styles.wrap, { marginTop: 6 }]}>
          {TIME_PRESETS.map((p) => (
            <Chip key={p.time} label={`${p.label} ${p.time}`} selected={times.includes(p.time)} onPress={() => addTime(p.time)} />
          ))}
        </View>

        <SectionTitle>Ngày uống</SectionTitle>
        <View style={styles.wrap}>
          <Chip label="Hằng ngày" selected={everyDay} onPress={() => setEveryDay(true)} />
          <Chip
            label="Chọn thứ trong tuần"
            selected={!everyDay}
            onPress={() => {
              setEveryDay(false);
              if (days.length === 0) setDays([1, 2, 3, 4, 5]);
            }}
          />
        </View>
        {!everyDay && (
          <View style={[styles.wrap, { marginTop: 10 }]}>
            {WEEK_ORDER.map((d) => (
              <Chip
                key={d}
                label={WEEKDAY_SHORT[d]}
                selected={days.includes(d)}
                onPress={() => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
              />
            ))}
          </View>
        )}

        <SectionTitle>Thời gian dùng</SectionTitle>
        <Pressable
          style={styles.field}
          onPress={() =>
            picker.open({
              mode: 'date',
              value: parseDateKey(startDate),
              title: 'Ngày bắt đầu',
              onPick: (d) => setStartDate(toDateKey(d)),
            })
          }
        >
          <Txt size={15} color={colors.textSoft}>
            Bắt đầu từ
          </Txt>
          <Txt size={18} weight="700">
            {formatDateFull(startDate)}
          </Txt>
        </Pressable>
        <View style={[styles.wrap, { marginTop: 10 }]}>
          <Chip label="Dùng lâu dài" selected={!isCourse} onPress={() => setIsCourse(false)} />
          <Chip label="Theo đợt (số ngày)" selected={isCourse} onPress={() => setIsCourse(true)} />
        </View>
        {isCourse && (
          <View style={{ marginTop: 10, gap: 10 }}>
            <Row gap={10}>
              <TextInput
                value={courseDays}
                onChangeText={(t) => setCourseDays(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                style={[inputStyle, { width: 90, textAlign: 'center' }]}
                maxLength={3}
              />
              <Txt size={17}>ngày → đến hết {endDate ? formatDateFull(endDate) : ''}</Txt>
            </Row>
            <View style={styles.wrap}>
              {DURATION_PRESETS.map((n) => (
                <Chip key={n} label={`${n} ngày`} selected={nCourse === n} onPress={() => setCourseDays(String(n))} />
              ))}
            </View>
          </View>
        )}

        <SectionTitle>Theo dõi số lượng thuốc</SectionTitle>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={16} style={{ flex: 1 }}>
            Tự trừ khi bấm “Đã uống” và báo khi sắp hết
          </Txt>
          <Switch value={trackStock} onValueChange={setTrackStock} trackColor={{ true: colors.primary, false: colors.border }} />
        </Row>
        {trackStock && (
          <Row gap={10} style={{ marginTop: 10 }}>
            <TextInput
              value={stock}
              onChangeText={setStock}
              keyboardType="decimal-pad"
              placeholder="30"
              placeholderTextColor={colors.textSoft}
              style={[inputStyle, { width: 120, textAlign: 'center' }]}
            />
            <Txt size={17}>{unit} còn lại</Txt>
          </Row>
        )}

        <SectionTitle>Màu nhận diện</SectionTitle>
        <View style={styles.wrap}>
          {MED_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityLabel={`Màu ${c}`}
              style={[styles.colorDot, { backgroundColor: c, borderWidth: color === c ? 4 : 0 }]}
            />
          ))}
        </View>

        <SectionTitle>Ghi chú</SectionTitle>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Ví dụ: Uống với nhiều nước, không dùng chung với sữa"
          placeholderTextColor={colors.textSoft}
          style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
          multiline
          maxLength={300}
        />

        {!isNew && (
          <>
            <SectionTitle>Trạng thái</SectionTitle>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt size={16}>{active ? 'Đang nhắc' : 'Tạm dừng nhắc'}</Txt>
              <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary, false: colors.border }} />
            </Row>
          </>
        )}

        <Button title={isNew ? 'Lưu thuốc' : 'Lưu thay đổi'} onPress={save} loading={saving} style={{ marginTop: 28 }} />
        {!isNew && <Button title="Xóa thuốc" variant="danger" onPress={remove} style={{ marginTop: 12 }} />}
      </ScrollView>
      {picker.element}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 60 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  amountBox: {
    minWidth: 72,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
  },
  field: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
  },
  colorDot: { width: 44, height: 44, borderRadius: 22, borderColor: colors.text },
});
