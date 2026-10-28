import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeights, Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Before the text: an avatar, icon… */
  left?: ReactNode;
  /** Right side: a value, Badge… (shown above `rightSubtitle`). */
  right?: ReactNode;
  rightSubtitle?: string;
  onPress?: () => void;
  /** Bottom divider; turn off on the last row of a Card. */
  divider?: boolean;
};

// Mobile stand-in for a dashboard Table row: one line of identity on the left,
// the key value on the right, tap for detail.
export function ListRow({ title, subtitle, left, right, rightSubtitle, onPress, divider = true }: ListRowProps) {
  const theme = useTheme();

  const content = (
    <>
      {left}
      <View style={styles.text}>
        <ThemedText numberOfLines={1} style={styles.title}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.subtitle}>{subtitle}</ThemedText> : null}
      </View>
      {right != null || rightSubtitle ? (
        <View style={styles.right}>
          {typeof right === 'string' || typeof right === 'number' ? (
            <ThemedText numberOfLines={1} style={styles.rightText}>{right}</ThemedText>
          ) : (
            right
          )}
          {rightSubtitle ? <ThemedText type="small" themeColor="textMuted" numberOfLines={1} style={styles.subtitle}>{rightSubtitle}</ThemedText> : null}
        </View>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null}
    </>
  );

  const rowStyle = [styles.row, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }];

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [rowStyle, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: Layout.minTouchTarget + 8, paddingVertical: Spacing.two },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0, gap: Spacing.half },
  title: { fontSize: 15, lineHeight: 21, fontFamily: FontWeights.medium },
  subtitle: { fontSize: 13, lineHeight: 18 },
  right: { alignItems: 'flex-end', gap: Spacing.half, flexShrink: 0 },
  rightText: { fontSize: 14, lineHeight: 20, fontFamily: FontWeights.semiBold },
});
