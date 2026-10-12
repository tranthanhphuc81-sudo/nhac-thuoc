import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadSettings, saveSettings } from '../lib/repo';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';

type AppContextValue = {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Tăng mỗi khi dữ liệu thay đổi để các màn hình tải lại */
  dataVersion: number;
  bumpData: () => void;
  /** Cỡ chữ đã nhân hệ số người dùng chọn */
  fs: (size: number) => number;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    loadSettings(db).then(setSettings);
  }, [db, dataVersion]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(db, next);
    },
    [db, settings],
  );

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const value = useMemo<AppContextValue>(
    () => ({
      settings,
      updateSettings,
      dataVersion,
      bumpData,
      fs: (size: number) => Math.round(size * settings.fontScale),
    }),
    [settings, updateSettings, dataVersion, bumpData],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp phải nằm trong AppProvider');
  return ctx;
}
