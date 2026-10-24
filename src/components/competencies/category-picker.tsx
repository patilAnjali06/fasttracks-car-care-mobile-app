import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CompetencyCategory } from '@/types/api';

// Exact labels from the dashboard's competencies page.
export const CATEGORY_LABELS: Record<CompetencyCategory, string> = {
  WORKSHOP: 'Workshop / Automotive',
  CUSTOMER_SALES: 'Customer & Sales',
  OFFICE_ADMIN: 'Office / Admin',
  TECH_IT: 'Tech / IT',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CompetencyCategory[];

export function CategoryPicker({ value, onChange, disabled }: {
  value: CompetencyCategory | null;
  onChange: (c: CompetencyCategory) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {CATEGORIES.map((c) => (
        <Pressable
          key={c}
          disabled={disabled}
          onPress={() => onChange(c)}
          style={[styles.chip, { backgroundColor: value === c ? theme.primary : theme.backgroundElement }, disabled && styles.disabled]}>
          <ThemedText type="small" style={value === c ? styles.active : undefined}>{CATEGORY_LABELS[c]}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  active: { color: '#ffffff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
