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
  /** "heading": 14px semibold (dashboard `font-semibold text-sm`). "label": small uppercase muted caption. */
  titleVariant?: 'heading' | 'label';
  /** Right side of the header (a Button, Badge, link…). */
  action?: ReactNode;
  padding?: Padding;
  /**
   * Dashboard list-card look: header row with a bottom border, then a body
   * padded 20 on the sides (rows bring their own vertical padding). Ignores `padding`.
   */
  divided?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Extra style for the title row. */
  headerStyle?: StyleProp<ViewStyle>;
};

export function Card({ children, title, subtitle, titleVariant = 'heading', action, padding = 'md', divided = false, onPress, style, headerStyle }: CardProps) {
  const theme = useTheme();
  const hasHeader = !!(title || subtitle || action);
  const isLabel = titleVariant === 'label';

  const body = (
    <>
      {hasHeader && (
        <View
          style={[
            styles.header,
            divided
              ? { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.border }
              : children ? styles.headerGap : null,
            headerStyle,
          ]}>
          <View style={styles.headerText}>
            {title ? <ThemedText themeColor={isLabel ? 'textMuted' : 'text'} style={isLabel ? styles.label : styles.title}>{isLabel ? title.toUpperCase() : title}</ThemedText> : null}
            {subtitle ? <ThemedText type="small" themeColor="textMuted">{subtitle}</ThemedText> : null}
          </View>
          {action}
        </View>
      )}
      {divided ? <View style={styles.dividedBody}>{children}</View> : children}
    </>
  );

  const cardStyle = [
    styles.card,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border, padding: divided ? 0 : PADDING[padding] },
    divided && styles.clip,
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
  clip: { overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerGap: { marginBottom: Spacing.three },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 20, fontFamily: FontWeights.semiBold },
  // Dashboard: text-xs font-semibold uppercase tracking-wide, muted.
  label: { fontSize: 12, lineHeight: 18, fontFamily: FontWeights.semiBold, letterSpacing: 0.6 },
  dividedBody: { paddingHorizontal: 20 },
});
