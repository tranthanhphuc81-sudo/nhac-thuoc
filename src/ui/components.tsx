import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { resolvePhoto } from '../lib/photos';
import { useApp } from './AppContext';
import { colors, radius } from './theme';

type TxtProps = {
  children: ReactNode;
  size?: number;
  weight?: '400' | '500' | '600' | '700' | '800';
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
};

/** Text có cỡ chữ tự nhân theo cài đặt "Cỡ chữ" */
export function Txt({ children, size = 16, weight = '400', color = colors.text, style, numberOfLines, center }: TxtProps) {
  const { fs } = useApp();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontSize: fs(size), lineHeight: Math.round(fs(size) * 1.35), fontWeight: weight, color }, center && { textAlign: 'center' }, style]}
    >
      {children}
    </Text>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({ title, onPress, variant = 'primary', icon, disabled, loading, small, style, accessibilityLabel }: ButtonProps) {
  const palette = {
    primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
    secondary: { bg: colors.primarySoft, fg: colors.primaryDark, border: colors.primarySoft },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: colors.border },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
    success: { bg: colors.success, fg: '#fff', border: colors.success },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Txt size={small ? 15 : 17} weight="700" color={palette.fg} center>
          {icon ? `${icon}  ` : ''}
          {title}
        </Txt>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Chip({ label, selected, onPress, color }: { label: string; selected: boolean; onPress: () => void; color?: string }) {
  const c = color ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c : colors.border, backgroundColor: selected ? c : '#fff' }]}
    >
      <Txt size={15} weight="600" color={selected ? '#fff' : colors.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Banner({
  tone,
  title,
  text,
  action,
}: {
  tone: 'warning' | 'danger' | 'info' | 'success';
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  const map = {
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    info: [colors.infoSoft, colors.info],
    success: [colors.successSoft, colors.success],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Txt size={16} weight="700" color={fg}>
        {title}
      </Txt>
      {text ? (
        <Txt size={14} color={colors.text} style={{ marginTop: 4 }}>
          {text}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Txt size={14} weight="700" color={colors.textSoft} style={styles.sectionTitle}>
      {children}
    </Txt>
  );
}

export function MedAvatar({ color, photoUri, size = 48 }: { color: string; photoUri: string | null; size?: number }) {
  const uri = resolvePhoto(photoUri);
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: colors.border }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.5 }}>💊</Text>
    </View>
  );
}

export function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' | 'info' }) {
  const map = {
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    info: [colors.infoSoft, colors.info],
    muted: ['#F1F5F9', colors.textMuted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Txt size={13} weight="700" color={fg}>
        {label}
      </Txt>
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  banner: { borderRadius: radius.md, padding: 14 },
  sectionTitle: { textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
