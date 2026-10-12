import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { addDays, formatDateLong } from '../../lib/date';
import { useMedData, useNow, useToday } from '../../lib/hooks';
import { adherence, dosesForDate } from '../../lib/schedule';
import type { DoseItem } from '../../lib/types';
import { useApp } from '../../ui/AppContext';
import { Card, Chip, MedAvatar, Row, Txt } from '../../ui/components';
import { colors, radius } from '../../ui/theme';

const RANGES = [7, 30, 90];

export default function HistoryScreen() {
  const { settings } = useApp();
  const today = useToday();
  const now = useNow(60_000);
  const [range, setRange] = useState(7);
  const from = addDays(today, -(range - 1));
  const { meds, logs } = useMedData(from, today, true);
  const [expanded, setExpanded] = useState<string | null>(today);

  const days = useMemo(() => {
    const out: { date: string; items: DoseItem[] }[] = [];
    for (let i = 0; i < range; i++) {
      const date = addDays(today, -i);
      out.push({ date, items: dosesForDate(meds, logs, date, now, settings.missedAfterMinutes) });
    }
    return out;
  }, [meds, logs, today, now, range, settings.missedAfterMinutes]);

  const all = useMemo(() => days.flatMap((d) => d.items), [days]);
  const stats = adherence(all);
  const missed = all.filter((i) => i.status === 'missed').length;
  const skipped = all.filter((i) => i.status === 'skipped').length;

  return (
    <FlatList
      data={days}
      keyExtractor={(d) => d.date}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 12 }}>
          <Row gap={8}>
            {RANGES.map((r) => (
              <Chip key={r} label={`${r} ngày`} selected={range === r} onPress={() => setRange(r)} />
            ))}
          </Row>
          <Card>
            <Txt size={15} color={colors.textMuted}>
              Tỉ lệ uống đúng ({range} ngày qua)
            </Txt>
            <Txt size={44} weight="800" color={percentColor(stats.percent)}>
              {stats.percent === null ? '—' : `${stats.percent}%`}
            </Txt>
            <Row gap={16} style={{ flexWrap: 'wrap' }}>
              <Txt size={15} color={colors.success}>
                ✓ Đã uống: {stats.taken}
              </Txt>
              <Txt size={15} color={colors.danger}>
                ✗ Quên: {missed}
              </Txt>
              <Txt size={15} color={colors.textMuted}>
                Bỏ qua: {skipped}
              </Txt>
            </Row>
          </Card>
        </View>
      }
      renderItem={({ item: day }) => {
        const s = adherence(day.items);
        const open = expanded === day.date;
        return (
          <Card style={{ marginBottom: 10, padding: 0 }}>
            <Pressable onPress={() => setExpanded(open ? null : day.date)} style={{ padding: 14 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight="700">
                    {day.date === today ? 'Hôm nay' : formatDateLong(day.date)}
                  </Txt>
                  <Row gap={4} style={{ flexWrap: 'wrap', marginTop: 6 }}>
                    {day.items.length === 0 ? (
                      <Txt size={14} color={colors.textSoft}>
                        Không có lịch
                      </Txt>
                    ) : (
                      day.items.map((i) => <View key={`${i.medication.id}|${i.time}`} style={[styles.dot, { backgroundColor: statusColor(i.status) }]} />)
                    )}
                  </Row>
                </View>
                <Txt size={18} weight="800" color={percentColor(s.percent)}>
                  {s.percent === null ? '' : `${s.percent}%`}
                </Txt>
                <Txt size={16} color={colors.textSoft} style={{ marginLeft: 10 }}>
                  {open ? '▲' : '▼'}
                </Txt>
              </Row>
            </Pressable>
            {open && day.items.length > 0 && (
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 14, gap: 10 }}>
                {day.items.map((i) => (
                  <Row key={`${i.medication.id}|${i.time}`} gap={10}>
                    <Txt size={16} weight="700" style={{ width: 56 }}>
                      {i.time}
                    </Txt>
                    <MedAvatar color={i.medication.color} photoUri={i.medication.photoUri} size={32} />
                    <Txt size={16} style={{ flex: 1 }} numberOfLines={1}>
                      {i.medication.name}
                    </Txt>
                    <Txt size={14} weight="700" color={statusColor(i.status)}>
                      {statusLabel(i)}
                    </Txt>
                  </Row>
                ))}
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}

function statusColor(s: DoseItem['status']): string {
  return { taken: colors.success, skipped: colors.textSoft, missed: colors.danger, due: colors.accent, upcoming: colors.textSoft }[s];
}

function statusLabel(i: DoseItem): string {
  if (i.status === 'taken' && i.log) {
    const d = new Date(i.log.actedAt);
    return `✓ ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return { taken: '✓', skipped: 'Bỏ qua', missed: 'Quên', due: 'Đến giờ', upcoming: 'Sắp tới' }[i.status];
}

function percentColor(p: number | null): string {
  if (p === null) return colors.textSoft;
  if (p >= 90) return colors.success;
  if (p >= 70) return colors.warning;
  return colors.danger;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  dot: { width: 14, height: 14, borderRadius: radius.pill },
});
