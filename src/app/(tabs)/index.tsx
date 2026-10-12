import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatDateFull, formatDateLong } from '../../lib/date';
import { useMedData, useNow, useToday } from '../../lib/hooks';
import { getLastSync, getPermissionState, recordDoses, requestPermission, type PermissionState } from '../../lib/notifications';
import { daysOfStockLeft, describeDose, dosesForDate, groupByTime, isLowStock } from '../../lib/schedule';
import type { DoseItem, DoseLogStatus } from '../../lib/types';
import { useApp } from '../../ui/AppContext';
import { Badge, Banner, Button, Card, MedAvatar, Row, Txt } from '../../ui/components';
import { colors, radius } from '../../ui/theme';

export default function TodayScreen() {
  const db = useSQLiteContext();
  const { settings, bumpData, dataVersion } = useApp();
  const today = useToday();
  const now = useNow();
  const { meds, logs, loaded } = useMedData(today, today);
  const [perm, setPerm] = useState<PermissionState>('granted');
  const [coveredUntil, setCoveredUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getPermissionState().then(setPerm);
    getLastSync(db).then((s) => setCoveredUntil(s?.coveredUntil ?? null));
  }, [db, dataVersion]);

  const doses = useMemo(() => dosesForDate(meds, logs, today, now, settings.missedAfterMinutes), [meds, logs, today, now, settings.missedAfterMinutes]);
  const groups = useMemo(() => groupByTime(doses), [doses]);
  const lowStock = useMemo(() => meds.filter((m) => isLowStock(m, settings.lowStockDays)), [meds, settings.lowStockDays]);
  const takenCount = doses.filter((d) => d.status === 'taken').length;

  const act = async (items: DoseItem[], status: DoseLogStatus | null, key: string) => {
    setBusy(key);
    try {
      await recordDoses(
        db,
        items.map((i) => ({ medicationId: i.medication.id, date: i.date, time: i.time })),
        status,
      );

      bumpData();
    } finally {
      setBusy(null);
    }
  };

  const activeMeds = meds.filter((m) => m.active);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Txt size={22} weight="800">
        {formatDateLong(today)}
      </Txt>
      {doses.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Txt size={16} color={colors.textMuted}>
            Đã uống {takenCount}/{doses.length} cữ hôm nay
          </Txt>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(takenCount * 100) / doses.length}%` }]} />
          </View>
        </View>
      )}

      <View style={{ gap: 12, marginTop: 16 }}>
        {perm !== 'granted' && (
          <Banner
            tone="danger"
            title="Chưa bật thông báo"
            text="Ứng dụng không thể nhắc bạn uống thuốc nếu thông báo bị tắt."
            action={
              <Button
                small
                title={perm === 'denied' ? 'Mở cài đặt' : 'Bật thông báo'}
                onPress={async () => {
                  if (perm === 'denied') router.push('/settings');
                  else setPerm(await requestPermission());
                }}
              />
            }
          />
        )}

        {Platform.OS === 'android' && !settings.reliabilitySetupDone && activeMeds.length > 0 && (
          <Banner
            tone="warning"
            title="Thiết lập để nhắc đúng giờ"
            text="Nhiều điện thoại (Xiaomi, Oppo, Vivo, Samsung…) tự chặn thông báo để tiết kiệm pin. Làm 2 phút để không bỏ lỡ cữ nào."
            action={<Button small title="Xem hướng dẫn" onPress={() => router.push('/guide')} />}
          />
        )}

        {coveredUntil && (
          <Banner
            tone="info"
            title="Hãy mở ứng dụng thường xuyên"
            text={`Do giới hạn của hệ điều hành, các nhắc nhở của thuốc theo đợt hiện được hẹn đến hết ${formatDateFull(coveredUntil)}. Mỗi lần mở app, lịch sẽ tự được gia hạn.`}
          />
        )}

        {lowStock.map((m) => (
          <Banner
            key={m.id}
            tone="warning"
            title={`Sắp hết ${m.name}`}
            text={`Còn ${m.stock} ${m.unit} — đủ khoảng ${daysOfStockLeft(m)} ngày.`}
            action={<Button small variant="secondary" title="Cập nhật số lượng" onPress={() => router.push(`/med/${m.id}`)} />}
          />
        ))}
      </View>

      {loaded && activeMeds.length === 0 && (
        <Card style={{ marginTop: 24, alignItems: 'center', gap: 12 }}>
          <Txt size={48}>💊</Txt>
          <Txt size={18} weight="700" center>
            Chưa có thuốc nào
          </Txt>
          <Txt size={15} color={colors.textMuted} center>
            Thêm thuốc và giờ uống, ứng dụng sẽ nhắc bạn đúng giờ — kể cả khi không có mạng.
          </Txt>
          <Button title="Thêm thuốc đầu tiên" icon="＋" onPress={() => router.push('/med/new')} style={{ alignSelf: 'stretch' }} />
          <Button title="Chụp đơn thuốc để tự thêm" icon="📷" variant="secondary" onPress={() => router.push('/scan')} style={{ alignSelf: 'stretch' }} />
        </Card>
      )}

      {loaded && activeMeds.length > 0 && doses.length === 0 && (
        <Card style={{ marginTop: 24, alignItems: 'center', gap: 8 }}>
          <Txt size={40}>🌿</Txt>
          <Txt size={17} weight="700" center>
            Hôm nay không có lịch uống thuốc
          </Txt>
        </Card>
      )}

      {groups.map((g) => {
        const pending = g.items.filter((i) => i.status !== 'taken' && i.status !== 'skipped');
        const groupKey = `g|${g.time}`;
        const isPast = g.items.some((i) => i.status === 'due' || i.status === 'missed');
        return (
          <View key={g.time} style={{ marginTop: 22 }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <Txt size={26} weight="800" color={isPast && pending.length ? colors.accent : colors.text}>
                {g.time}
              </Txt>
              {pending.length > 1 && (
                <Button
                  small
                  variant="success"
                  title="Uống tất cả"
                  icon="✓"
                  loading={busy === groupKey}
                  onPress={() => act(pending, 'taken', groupKey)}
                />
              )}
            </Row>
            <View style={{ gap: 10 }}>
              {g.items.map((item) => (
                <DoseCard key={`${item.medication.id}|${item.time}`} item={item} busy={busy} onAct={act} />
              ))}
            </View>
          </View>
        );
      })}

      {activeMeds.length > 0 && (
        <Button
          title="Thêm thuốc"
          icon="＋"
          variant="secondary"
          onPress={() => router.push('/med/new')}
          style={{ marginTop: 28 }}
        />
      )}
    </ScrollView>
  );
}

function DoseCard({
  item,
  busy,
  onAct,
}: {
  item: DoseItem;
  busy: string | null;
  onAct: (items: DoseItem[], status: DoseLogStatus | null, key: string) => void;
}) {
  const { medication: m, status } = item;
  const key = `${m.id}|${item.time}`;
  const statusBadge = {
    taken: <Badge label="✓ Đã uống" tone="success" />,
    skipped: <Badge label="Đã bỏ qua" tone="muted" />,
    upcoming: <Badge label="Sắp tới" tone="info" />,
    due: <Badge label="Đến giờ uống" tone="warning" />,
    missed: <Badge label="Chưa uống" tone="danger" />,
  }[status];
  const done = status === 'taken' || status === 'skipped';

  return (
    <Card style={[done && { opacity: 0.75 }, status === 'due' && { borderColor: colors.accent, borderWidth: 2 }]}>
      <Pressable onPress={() => router.push(`/med/${m.id}`)}>
        <Row gap={12} style={{ alignItems: 'flex-start' }}>
          <MedAvatar color={m.color} photoUri={m.photoUri} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={19} weight="700" numberOfLines={2}>
              {m.name}
              {m.dosage ? <Txt size={16} color={colors.textMuted}>{`  ${m.dosage}`}</Txt> : null}
            </Txt>
            <Txt size={16} color={colors.textMuted}>
              {describeDose(m)}
            </Txt>
            {m.notes ? (
              <Txt size={14} color={colors.textSoft} numberOfLines={2}>
                {m.notes}
              </Txt>
            ) : null}
            <View style={{ marginTop: 2 }}>{statusBadge}</View>
          </View>
        </Row>
      </Pressable>
      <Row style={{ marginTop: 12 }}>
        {done ? (
          <Button small variant="ghost" title="Hoàn tác" loading={busy === key} onPress={() => onAct([item], null, key)} style={{ flex: 1 }} />
        ) : (
          <>
            <Button
              small
              variant="ghost"
              title="Bỏ qua"
              disabled={busy === key}
              onPress={() => onAct([item], 'skipped', `${key}|s`)}
              style={{ flex: 1 }}
            />
            <Button
              small
              variant="success"
              title="Đã uống"
              icon="✓"
              loading={busy === key}
              onPress={() => onAct([item], 'taken', key)}
              style={{ flex: 2 }}
            />
          </>
        )}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  progressTrack: { height: 10, borderRadius: radius.pill, backgroundColor: colors.border, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.success, borderRadius: radius.pill },
});
