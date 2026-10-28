import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeights, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Padding = 'none' | 'sm' | 'md' | 'lg';

// Dashboard Card: p-3 / p-5 / p-6 (12 / 20 / 24).
const PADDING: Record<Padding, number> = { none: 0, sm: 12, md: 20, lg: 24 };

export type CardProps = {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
  /** Right side of the header (a Button, Badge, link…). */
  action?: ReactNode;
  padding?: Padding;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, title, subtitle, action, padding = 'md', onPress, style }: CardProps) {
  const theme = useTheme();
  const hasHeader = !!(title || subtitle || action);

  const body = (
    <>
      {hasHeader && (
        <View style={[styles.header, children ? styles.headerGap : null]}>
          <View style={styles.headerText}>
            {title ? <ThemedText style={styles.title}>{title}</ThemedText> : null}
            {subtitle ? <ThemedText type="small" themeColor="textMuted">{subtitle}</ThemedText> : null}
          </View>
          {action}
        </View>
      )}
      {children}
    </>
  );

  const cardStyle = [
    styles.card,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border, padding: PADDING[padding] },
    style,
  ];

  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [cardStyle, pressed && styles.pressed]}>
        {body}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{body}</View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radii.md },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  headerGap: { marginBottom: Spacing.three },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 22, fontFamily: FontWeights.semiBold },
});
