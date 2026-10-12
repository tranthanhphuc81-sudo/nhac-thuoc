import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import { checkServer, DEFAULT_RX_CONFIG, isRxReady, loadRxConfig, normalizeServerUrl, saveRxConfig, type RxConfig, type RxMode } from '../lib/rx/client';
import { useApp } from './AppContext';
import { Badge, Button, Card, Chip, Row, Txt } from './components';
import { colors, radius } from './theme';

const MODES: { mode: RxMode; label: string }[] = [
  { mode: 'off', label: 'Tắt' },
  { mode: 'server', label: 'Máy chủ riêng' },
  { mode: 'apikey', label: 'API key trên máy' },
];

/** Phần cài đặt "Quét đơn thuốc bằng AI" trong màn hình Cài đặt */
export function RxSettings() {
  const db = useSQLiteContext();
  const { fs } = useApp();
  const [cfg, setCfg] = useState<RxConfig>(DEFAULT_RX_CONFIG);
  const [saved, setSaved] = useState<RxConfig>(DEFAULT_RX_CONFIG);
  const [checking, setChecking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadRxConfig(db).then((c) => {
        if (cancelled) return;
        setCfg(c);
        setSaved(c);
      });
      return () => {
        cancelled = true;
      };
    }, [db]),
  );

  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const input = { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: 12, fontSize: fs(15), color: colors.text };

  const save = async () => {
    const next = { ...cfg, serverUrl: normalizeServerUrl(cfg.serverUrl), accessCode: cfg.accessCode.trim(), apiKey: cfg.apiKey.trim() };
    await saveRxConfig(db, next);
    setCfg(next);
    setSaved(next);
  };

  return (
    <Card style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt size={17} weight="600">
          Đọc đơn thuốc bằng AI
        </Txt>
        {isRxReady(saved) ? <Badge label="Sẵn sàng" tone="success" /> : <Badge label="Chưa bật" tone="muted" />}
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MODES.map((m) => (
          <Chip key={m.mode} label={m.label} selected={cfg.mode === m.mode} onPress={() => setCfg({ ...cfg, mode: m.mode })} />
        ))}
      </View>

      {cfg.mode === 'server' && (
        <View style={{ gap: 8 }}>
          <Txt size={14} color={colors.textMuted}>
            Dùng chung cho gia đình, bạn bè. Người quản lý máy chủ cấp địa chỉ và mã truy cập riêng cho từng người.
          </Txt>
          <Txt size={15} weight="600">
            Địa chỉ máy chủ
          </Txt>
          <TextInput
            value={cfg.serverUrl}
            onChangeText={(serverUrl) => setCfg({ ...cfg, serverUrl })}
            placeholder="Dán địa chỉ, vd: …workers.dev"
            placeholderTextColor={colors.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={input}
          />
          <Txt size={15} weight="600">
            Mã truy cập
          </Txt>
          <TextInput
            value={cfg.accessCode}
            onChangeText={(accessCode) => setCfg({ ...cfg, accessCode })}
            placeholder="Mã riêng của bạn"
            placeholderTextColor={colors.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
          />
          <Button
            small
            variant="ghost"
            title="Kiểm tra kết nối"
            loading={checking}
            onPress={async () => {
              setChecking(true);
              try {
                const model = await checkServer(cfg);
                Alert.alert('Kết nối tốt', `Máy chủ đang chạy${model ? ` (model ${model})` : ''}.`);
              } catch (e) {
                Alert.alert('Không kết nối được', e instanceof Error ? e.message : String(e));
              } finally {
                setChecking(false);
              }
            }}
          />
        </View>
      )}

      {cfg.mode === 'apikey' && (
        <View style={{ gap: 8 }}>
          <Txt size={14} color={colors.warning}>
            Chỉ nên dùng trên máy của chính bạn: API key được lưu trên điện thoại này, ai cầm máy cũng dùng được. Không chia sẻ cách này cho người khác.
          </Txt>
          <TextInput
            value={cfg.apiKey}
            onChangeText={(apiKey) => setCfg({ ...cfg, apiKey })}
            placeholder="sk-ant-..."
            placeholderTextColor={colors.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
          />
        </View>
      )}

      {cfg.consent && cfg.mode !== 'off' && (
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt size={14} color={colors.textMuted} style={{ flex: 1 }}>
            Đã đồng ý gửi ảnh đơn thuốc cho AI đọc
          </Txt>
          <Button small variant="ghost" title="Rút lại" onPress={() => setCfg({ ...cfg, consent: false })} />
        </Row>
      )}

      {dirty && <Button small title="Lưu cài đặt quét đơn" onPress={save} />}
    </Card>
  );
}
