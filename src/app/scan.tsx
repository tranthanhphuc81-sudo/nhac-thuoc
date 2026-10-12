import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { toDateKey } from '../lib/date';
import { syncNotifications } from '../lib/notifications';
import { getMedications, saveMedication } from '../lib/repo';
import { isRxReady, loadRxConfig, prepareImage, saveRxConfig, scanPrescription, type RxConfig } from '../lib/rx/client';
import { RX_SLOTS, RxError } from '../lib/rx/extract';
import { draftToInput, SLOT_LABELS, SLOT_TIMES, toDrafts, type RxDraft } from '../lib/rx/map';
import { formatAmount } from '../lib/schedule';
import { useApp } from '../ui/AppContext';
import { Badge, Banner, Button, Card, Chip, Row, SectionTitle, Txt } from '../ui/components';
import { colors, INSTRUCTIONS, MED_COLORS, radius } from '../ui/theme';

type Phase = 'pick' | 'reading' | 'review';

export default function ScanScreen() {
  const db = useSQLiteContext();
  const { bumpData, fs } = useApp();
  const [cfg, setCfg] = useState<RxConfig | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [photo, setPhoto] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<RxDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [askConsent, setAskConsent] = useState<null | (() => void)>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRxConfig(db).then((c) => {
        if (!cancelled) setCfg(c);
      });
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const withConsent = (fn: () => void) => {
    if (cfg?.consent) fn();
    else setAskConsent(() => fn);
  };

  const pick = async (fromCamera: boolean) => {
    if (!cfg) return;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 1 };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Cần quyền camera', 'Hãy cho phép ứng dụng dùng camera trong Cài đặt của điện thoại.');
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? null : res.assets[0];
    if (!asset) return;

    setPhoto(asset.uri);
    setPhase('reading');
    try {
      const image = await prepareImage(asset.uri, asset.width, asset.height);
      const out = await scanPrescription(cfg, image);
      if (!out.result.is_prescription || out.result.medications.length === 0) {
        setPhase('pick');
        Alert.alert(
          'Không tìm thấy thuốc',
          [out.result.warnings.join('\n'), 'Hãy chụp lại rõ hơn: đặt đơn trên mặt phẳng, đủ sáng, chụp thẳng và lấy trọn trang.']
            .filter(Boolean)
            .join('\n\n'),
        );
        return;
      }
      const existing = new Set((await getMedications(db)).filter((m) => m.active).map((m) => m.name.trim().toLowerCase()));
      setDrafts(
        toDrafts(out.result).map((d) =>
          existing.has(d.name.trim().toLowerCase())
            ? { ...d, include: false, flags: [...d.flags, 'Thuốc này đã có trong danh sách — mặc định không thêm trùng'] }
            : d,
        ),
      );
      setWarnings(out.result.warnings);
      setRemaining(out.remaining);
      setPhase('review');
    } catch (e) {
      setPhase('pick');
      Alert.alert('Chưa đọc được đơn', e instanceof RxError || e instanceof Error ? e.message : String(e));
    }
  };

  const update = (key: string, patch: Partial<RxDraft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const included = drafts.filter((d) => d.include);

  const saveAll = async () => {
    const invalid = included.find((d) => !d.name.trim() || d.times.length === 0);
    if (invalid) return Alert.alert('Thiếu thông tin', `Thuốc "${invalid.name || 'chưa có tên'}" cần có tên và ít nhất một buổi uống.`);
    setSaving(true);
    try {
      const today = toDateKey(new Date());
      let i = 0;
      for (const d of included) await saveMedication(db, draftToInput(d, today, MED_COLORS[i++ % MED_COLORS.length]));
      await syncNotifications(db);
      bumpData();
      router.dismissTo('/meds');
    } catch (e) {
      Alert.alert('Không lưu được', String(e));
    } finally {
      setSaving(false);
    }
  };

  const input = [styles.input, { fontSize: fs(16) }];

  if (!cfg) return <Stack.Screen options={{ title: 'Quét đơn thuốc' }} />;

  if (!isRxReady(cfg)) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title: 'Quét đơn thuốc' }} />
        <Card style={{ gap: 12 }}>
          <Txt size={40} center>
            📄
          </Txt>
          <Txt size={18} weight="700" center>
            Chưa bật tính năng quét đơn
          </Txt>
          <Txt size={15} color={colors.textMuted} center>
            Tính năng dùng AI để đọc đơn thuốc nên cần mạng và cần thiết lập một lần: nhập địa chỉ máy chủ và mã truy cập (người cài app cho bạn sẽ cung cấp).
          </Txt>
          <Button title="Mở Cài đặt" onPress={() => router.push('/settings')} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: phase === 'review' ? 'Kiểm tra trước khi lưu' : 'Quét đơn thuốc' }} />

      {phase === 'pick' && (
        <ScrollView contentContainerStyle={styles.container}>
          <Card style={{ gap: 14 }}>
            <Txt size={18} weight="700">
              Chụp đơn thuốc để tự thêm thuốc
            </Txt>
            <Txt size={15} color={colors.textMuted}>
              AI sẽ đọc tên thuốc, liều, buổi uống và số ngày. Bạn kiểm tra lại rồi mới lưu.
            </Txt>
            <Button title="📷  Chụp đơn thuốc" onPress={() => withConsent(() => pick(true))} />
            <Button title="🖼️  Chọn ảnh có sẵn" variant="secondary" onPress={() => withConsent(() => pick(false))} />
          </Card>
          <SectionTitle>Mẹo để đọc chính xác</SectionTitle>
          <Card style={{ gap: 8 }}>
            {[
              'Đặt đơn trên mặt bàn phẳng, đủ ánh sáng, không bị bóng tay.',
              'Chụp thẳng từ trên xuống, lấy trọn phần danh sách thuốc.',
              'Đơn nhiều trang: chụp từng trang, mỗi lần một trang.',
              'Đơn in máy đọc chính xác nhất; đơn viết tay cần kiểm tra kỹ hơn.',
            ].map((t) => (
              <Txt key={t} size={15}>
                • {t}
              </Txt>
            ))}
          </Card>
          <Txt size={13} color={colors.textSoft} style={{ marginTop: 16 }}>
            Ảnh chỉ được gửi đi để đọc rồi bỏ, không lưu trên máy chủ. Cần có mạng khi quét.
          </Txt>
        </ScrollView>
      )}

      {phase === 'reading' && (
        <View style={[styles.container, { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
          {photo ? <Image source={{ uri: photo }} style={styles.preview} resizeMode="contain" /> : null}
          <ActivityIndicator size="large" color={colors.primary} />
          <Txt size={18} weight="700" center>
            Đang đọc đơn thuốc…
          </Txt>
          <Txt size={15} color={colors.textMuted} center>
            Thường mất 10–30 giây
          </Txt>
        </View>
      )}

      {phase === 'review' && (
        <>
          <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 140 }]}>
            <Banner
              tone="warning"
              title={`AI đọc được ${drafts.length} thuốc — hãy so với đơn giấy`}
              text="AI có thể đọc sai tên hoặc liều. Kiểm tra từng thuốc, sửa nếu cần, bỏ chọn thuốc không muốn nhắc."
            />
            {warnings.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <Banner tone="info" title="Lưu ý khi đọc đơn" text={warnings.map((w) => `• ${w}`).join('\n')} />
              </View>
            )}
            {photo ? <Image source={{ uri: photo }} style={[styles.preview, { marginTop: 12 }]} resizeMode="contain" /> : null}

            <View style={{ gap: 14, marginTop: 16 }}>
              {drafts.map((d, idx) => (
                <DraftCard key={d.key} index={idx + 1} draft={d} inputStyle={input} onChange={(p) => update(d.key, p)} />
              ))}
            </View>
            {remaining !== null && (
              <Txt size={13} color={colors.textSoft} center style={{ marginTop: 16 }}>
                Còn {remaining} lượt quét hôm nay
              </Txt>
            )}
          </ScrollView>
          <View style={styles.footer}>
            <Button title="Chụp lại" variant="ghost" onPress={() => setPhase('pick')} style={{ flex: 1 }} />
            <Button
              title={included.length ? `Lưu ${included.length} thuốc` : 'Chưa chọn thuốc'}
              disabled={!included.length}
              loading={saving}
              onPress={saveAll}
              style={{ flex: 2 }}
            />
          </View>
        </>
      )}

      <Modal visible={!!askConsent} transparent animationType="fade" onRequestClose={() => setAskConsent(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={{ gap: 12, margin: 20 }}>
            <Txt size={18} weight="700">
              Gửi ảnh đơn thuốc để AI đọc?
            </Txt>
            <Txt size={15}>
              Ảnh sẽ được gửi qua Internet tới dịch vụ AI Claude (Anthropic) để đọc chữ. Ảnh không được lưu lại sau khi đọc. Đơn thuốc là thông tin sức khỏe — chỉ đồng ý nếu bạn thấy ổn.
            </Txt>
            <Row>
              <Button title="Không" variant="ghost" onPress={() => setAskConsent(null)} style={{ flex: 1 }} />
              <Button
                title="Đồng ý"
                onPress={async () => {
                  const next = { ...cfg, consent: true };
                  await saveRxConfig(db, next);
                  setCfg(next);
                  const fn = askConsent;
                  setAskConsent(null);
                  fn?.();
                }}
                style={{ flex: 1 }}
              />
            </Row>
          </Card>
        </View>
      </Modal>
    </View>
  );
}

function DraftCard({
  index,
  draft: d,
  onChange,
  inputStyle,
}: {
  index: number;
  draft: RxDraft;
  onChange: (p: Partial<RxDraft>) => void;
  inputStyle: object[];
}) {
  const conf = { high: <Badge label="Đọc rõ" tone="success" />, medium: <Badge label="Cần xem lại" tone="warning" />, low: <Badge label="Không chắc" tone="danger" /> }[
    d.confidence
  ];
  const toggleSlot = (time: string) => {
    const next = d.times.includes(time) ? d.times.filter((t) => t !== time) : [...d.times, time];
    onChange({ times: [...new Set(next)].sort() });
  };
  const extraTimes = d.times.filter((t) => !Object.values(SLOT_TIMES).includes(t));

  return (
    <Card style={[{ gap: 10 }, !d.include && { opacity: 0.6 }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={8}>
          <Txt size={15} weight="800" color={colors.textSoft}>
            #{index}
          </Txt>
          {conf}
        </Row>
        <Row gap={6}>
          <Txt size={14} color={colors.textMuted}>
            {d.include ? 'Thêm' : 'Bỏ qua'}
          </Txt>
          <Switch value={d.include} onValueChange={(v) => onChange({ include: v })} trackColor={{ true: colors.primary, false: colors.border }} />
        </Row>
      </Row>

      <TextInput value={d.name} onChangeText={(name) => onChange({ name })} placeholder="Tên thuốc" style={[inputStyle, { fontWeight: '700' }]} />
      <TextInput value={d.dosage} onChangeText={(dosage) => onChange({ dosage })} placeholder="Hàm lượng (vd 500mg)" style={inputStyle} />

      <Row gap={10}>
        <Txt size={15} color={colors.textMuted}>
          Mỗi lần
        </Txt>
        <Button small variant="secondary" title="−" onPress={() => onChange({ doseAmount: Math.max(0.25, Math.round((d.doseAmount - 0.5) * 4) / 4) })} />
        <Txt size={20} weight="800">
          {formatAmount(d.doseAmount)}
        </Txt>
        <Button small variant="secondary" title="+" onPress={() => onChange({ doseAmount: Math.round((d.doseAmount + 0.5) * 4) / 4 })} />
        <Txt size={16}>{d.unit}</Txt>
      </Row>

      <View style={styles.wrap}>
        {RX_SLOTS.map((s) => (
          <Chip key={s} label={`${SLOT_LABELS[s]} ${SLOT_TIMES[s]}`} selected={d.times.includes(SLOT_TIMES[s])} onPress={() => toggleSlot(SLOT_TIMES[s])} />
        ))}
        {extraTimes.map((t) => (
          <Chip key={t} label={t} selected onPress={() => toggleSlot(t)} />
        ))}
      </View>

      <View style={styles.wrap}>
        {INSTRUCTIONS.filter(Boolean).map((ins) => (
          <Chip key={ins} label={ins} selected={d.instructions === ins} onPress={() => onChange({ instructions: d.instructions === ins ? '' : ins })} />
        ))}
      </View>

      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Chip label="Dùng lâu dài" selected={d.courseDays === 0} onPress={() => onChange({ courseDays: 0 })} />
        <Chip label="Theo đợt" selected={d.courseDays > 0} onPress={() => onChange({ courseDays: d.courseDays || 7 })} />
        {d.courseDays > 0 && (
          <Row gap={6}>
            <TextInput
              value={String(d.courseDays)}
              onChangeText={(t) => onChange({ courseDays: Math.max(1, parseInt(t.replace(/\D/g, ''), 10) || 1) })}
              keyboardType="number-pad"
              style={[inputStyle, { width: 64, textAlign: 'center', paddingVertical: 8 }]}
            />
            <Txt size={15}>ngày</Txt>
          </Row>
        )}
      </Row>

      <Row gap={8}>
        <Txt size={15} color={colors.textMuted}>
          Số lượng
        </Txt>
        <TextInput
          value={d.stock === null ? '' : String(d.stock)}
          onChangeText={(t) => {
            const n = Number(t.replace(',', '.'));
            onChange({ stock: t.trim() === '' || !Number.isFinite(n) ? null : n });
          }}
          placeholder="—"
          keyboardType="decimal-pad"
          style={[inputStyle, { width: 96, textAlign: 'center', paddingVertical: 8 }]}
        />
        <Txt size={15}>{d.unit}</Txt>
      </Row>

      {d.note ? (
        <Txt size={14} color={colors.textMuted}>
          📝 {d.note}
        </Txt>
      ) : null}
      {d.flags.map((f) => (
        <Txt key={f} size={14} color={colors.warning}>
          ⚠️ {f}
        </Txt>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.border },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center' },
});
