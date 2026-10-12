import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { useApp } from '../ui/AppContext';
import { toDateKey } from './date';
import { getLogsBetween, getMedications } from './repo';
import type { DoseLog, Medication } from './types';

/** Tải thuốc + nhật ký trong khoảng ngày; tự tải lại khi màn hình được focus hoặc dữ liệu đổi */
export function useMedData(from: string, to: string, includeArchived = false) {
  const db = useSQLiteContext();
  const { dataVersion } = useApp();
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<DoseLog[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([getMedications(db, includeArchived), getLogsBetween(db, from, to)]).then(([m, l]) => {
        if (cancelled) return;
        setMeds(m);
        setLogs(l);
        setLoaded(true);
      });
      return () => {
        cancelled = true;
      };
      // tick/dataVersion: buộc tải lại khi dữ liệu thay đổi
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, from, to, includeArchived, dataVersion, tick]),
  );

  return { meds, logs, loaded, reload };
}

/** "Bây giờ", cập nhật mỗi 30 giây để trạng thái cữ (sắp tới / đến giờ / quên) luôn đúng */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useToday(): string {
  return toDateKey(useNow(60_000));
}
