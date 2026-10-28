import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeights, Spacing } from '@/constants/theme';

export type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  /** Right side: a Button, link, Badge… */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Dashboard page / section heading: semibold title, muted subtitle, action on the right.
export function SectionHeader({ title, subtitle, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.text}>
        <ThemedText style={styles.title}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textMuted">{subtitle}</ThemedText> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, lineHeight: 26, fontFamily: FontWeights.semiBold },
});
