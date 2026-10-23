import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BarRow = {
  label: string;
  value: number;
  // Shown under the label, e.g. "3 scored".
  caption?: string;
};

// Horizontal bar chart from plain Views — no chart library. Each row is the
// label (full width, so long labels wrap instead of squeezing the bar), then a
// bar sized value / max of the series with the number beside it. `max` defaults
// to the largest value in the series; pass a fixed one (e.g. 100 for scores).
export function BarChart({ rows, max, color = '#6AA4CC', format }: {
  rows: BarRow[];
  max?: number;
  color?: string;
  format?: (v: number) => string;
}) {
  const theme = useTheme();
  const top = max ?? Math.max(...rows.map((r) => r.value), 0);
  return (
    <View style={styles.wrap}>
      {rows.map((r) => {
        // A non-zero value always gets a visible sliver; zero gets none.
        const pct = top > 0 ? Math.min(r.value / top, 1) * 100 : 0;
        return (
          <View key={r.label} style={styles.row}>
            <ThemedText type="small">{r.label}</ThemedText>
            {r.caption ? <ThemedText type="small" themeColor="textSecondary">{r.caption}</ThemedText> : null}
            <View style={styles.barLine}>
              <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                <View style={[styles.fill, { width: `${pct}%`, minWidth: r.value > 0 ? 4 : 0, backgroundColor: color }]} />
              </View>
              <ThemedText type="smallBold" style={styles.value}>{format ? format(r.value) : r.value}</ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  row: { gap: Spacing.half },
  barLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  track: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
  value: { minWidth: 36, textAlign: 'right' },
});
