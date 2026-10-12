import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { describeDays, formatDateFull } from '../../lib/date';
import { useMedData, useToday } from '../../lib/hooks';
import { syncNotifications } from '../../lib/notifications';
import { setMedicationActive } from '../../lib/repo';
import { daysOfStockLeft, describeDose, isLowStock } from '../../lib/schedule';
import type { Medication } from '../../lib/types';
import { useApp } from '../../ui/AppContext';
import { Badge, Button, Card, MedAvatar, Row, SectionTitle, Txt } from '../../ui/components';
import { colors } from '../../ui/theme';

export default function MedsScreen() {
  const db = useSQLiteContext();
  const { settings, bumpData } = useApp();
  const today = useToday();
  const { meds, loaded } = useMedData(today, today);

  const toggle = async (m: Medication, active: boolean) => {
    await setMedicationActive(db, m.id, active);

    bumpData();
    await syncNotifications(db);
  };

  const isFinished = (m: Medication) => !!m.endDate && m.endDate < today;
  const current = meds.filter((m) => m.active && !isFinished(m));
  const paused = meds.filter((m) => !m.active || isFinished(m));

  const renderMed = (m: Medication) => {
    const left = daysOfStockLeft(m);
    return (
      <Card key={m.id}>
        <Pressable onPress={() => router.push(`/med/${m.id}`)} accessibilityRole="button" accessibilityLabel={`Sửa ${m.name}`}>
          <Row gap={12} style={{ alignItems: 'flex-start' }}>
            <MedAvatar color={m.color} photoUri={m.photoUri} size={52} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt size={18} weight="700" numberOfLines={2}>
                {m.name}
                {m.dosage ? <Txt size={15} color={colors.textMuted}>{`  ${m.dosage}`}</Txt> : null}
              </Txt>
              <Txt size={15} color={colors.textMuted}>
                {describeDose(m)}
              </Txt>
              <Txt size={15} weight="600" color={colors.primaryDark}>
                🕒 {m.times.join(' · ') || 'Chưa đặt giờ'}
              </Txt>
              <Txt size={14} color={colors.textSoft}>
                {describeDays(m.days)}
                {m.endDate ? ` · đến ${formatDateFull(m.endDate)}` : ''}
                {m.startDate > today ? ` · bắt đầu ${formatDateFull(m.startDate)}` : ''}
              </Txt>
              <Row style={{ flexWrap: 'wrap', marginTop: 4 }} gap={6}>
                {m.stock !== null && (
                  <Badge
                    label={`Còn ${m.stock} ${m.unit}${left !== null ? ` · ~${left} ngày` : ''}`}
                    tone={isLowStock(m, settings.lowStockDays) ? 'warning' : 'muted'}
                  />
                )}
                {isFinished(m) && <Badge label="Đã hết đợt" tone="muted" />}
                {!m.active && <Badge label="Tạm dừng" tone="muted" />}
              </Row>
            </View>
          </Row>
        </Pressable>
        <Row style={{ justifyContent: 'space-between', marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
          <Txt size={15} color={colors.textMuted}>
            {m.active ? 'Đang nhắc' : 'Tạm dừng nhắc'}
          </Txt>
          <Switch
            value={m.active}
            onValueChange={(v) => toggle(m, v)}
            trackColor={{ true: colors.primary, false: colors.border }}
            accessibilityLabel={`Bật tắt nhắc ${m.name}`}
          />
        </Row>
      </Card>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={{ gap: 10 }}>
        <Button title="Thêm thuốc" icon="＋" onPress={() => router.push('/med/new')} />
        <Button title="Chụp đơn thuốc để tự thêm" icon="📷" variant="secondary" onPress={() => router.push('/scan')} />
      </View>

      {loaded && meds.length === 0 && (
        <Txt size={16} color={colors.textMuted} center style={{ marginTop: 32 }}>
          Danh sách thuốc trống. Bấm “Thêm thuốc” để bắt đầu.
        </Txt>
      )}

      {current.length > 0 && <SectionTitle>Đang dùng ({current.length})</SectionTitle>}
      <View style={{ gap: 12 }}>{current.map(renderMed)}</View>

      {paused.length > 0 && <SectionTitle>Tạm dừng / đã hết đợt ({paused.length})</SectionTitle>}
      <View style={{ gap: 12 }}>{paused.map(renderMed)}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
});
