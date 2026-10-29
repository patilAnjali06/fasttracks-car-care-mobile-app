import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accents, FontWeights, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'secondary' | 'muted' | 'blue' | 'purple' | 'orange';

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** Small status dot before the label. */
  dot?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Badge({ variant = 'secondary', size = 'md', dot = false, children, style }: BadgeProps) {
  const theme = useTheme();

  // Dashboard: tinted variants are `bg-X/15 text-X border-X/30`.
  const tint = (color: string) => ({ fg: color, bg: withAlpha(color, 0.15), border: withAlpha(color, 0.3) });
  const colors = {
    success: tint(theme.success),
    warning: tint(theme.warning),
    danger: tint(theme.danger),
    primary: tint(theme.primary),
    blue: tint(Accents.blue),
    purple: tint(Accents.purple),
    orange: tint(Accents.orange),
    secondary: { fg: theme.textSecondary, bg: theme.surface, border: theme.border },
    muted: { fg: theme.textMuted, bg: withAlpha(theme.border, 0.5), border: theme.border },
  }[variant];

  const small = size === 'sm';
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg, borderColor: colors.border, paddingHorizontal: small ? 6 : 8 },
        style,
      ]}>
      {dot ? <View style={[styles.dot, { backgroundColor: colors.fg }]} /> : null}
      <ThemedText style={[styles.label, { color: colors.fg, fontSize: small ? 10 : 12, lineHeight: small ? 14 : 18 }]}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontFamily: FontWeights.medium },
});
