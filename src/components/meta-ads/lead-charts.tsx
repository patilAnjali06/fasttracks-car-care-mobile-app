import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { C_ORGANIC, C_PAID, DrillLink, dayLabel, num } from '@/components/meta-ads/ads-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AdsDayRow } from '@/types/api';

const BAR_W = 18;
const COL_W = 26;
const CHART_H = 150;

// "Lead flow" — daily enquiries stacked Paid (bottom) over Direct, from plain
// Views (no chart library). `daily` arrives newest-first; like the dashboard it
// drops the dead run of empty days at the START of the window (never a zero in
// the middle). Tapping a segment opens that day's paid / direct leads.
export function LeadFlowChart({ daily, onDrill }: {
  daily: AdsDayRow[];
  onDrill: (f: { date: string; paid: string }) => void;
}) {
  const theme = useTheme();
  const data = useMemo(() => {
    const asc = daily.slice().reverse();
    const first = asc.findIndex((r) => r.leads > 0 || r.spend > 0);
    return first > 0 ? asc.slice(first) : asc;
  }, [daily]);
  const max = Math.max(1, ...data.map((r) => r.leads));
  // ~5 date labels across the chart, whatever the window length.
  const every = Math.max(1, Math.ceil(data.length / 5));

  return (
    <View>
      <View style={styles.legend}>
        <LegendDot color={C_PAID} label="Paid" />
        <LegendDot color={C_ORGANIC} label="Direct" />
        <ThemedText type="small" themeColor="textSecondary" style={styles.flexEnd}>Peak {num(max)}/day</ThemedText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.plot, { borderBottomColor: theme.backgroundElement, width: data.length * COL_W }]}>
          {data.map((r, i) => (
            <View key={r.date} style={styles.col}>
              <View style={styles.stack}>
                {r.organic > 0 && (
                  <Pressable
                    onPress={() => onDrill({ date: r.date, paid: '0' })}
                    style={{ width: BAR_W, height: (r.organic / max) * CHART_H, backgroundColor: C_ORGANIC, borderTopLeftRadius: 3, borderTopRightRadius: 3 }}
                  />
                )}
                {r.paid > 0 && (
                  <Pressable
                    onPress={() => onDrill({ date: r.date, paid: '1' })}
                    style={{ width: BAR_W, height: (r.paid / max) * CHART_H, backgroundColor: C_PAID, borderTopLeftRadius: r.organic > 0 ? 0 : 3, borderTopRightRadius: r.organic > 0 ? 0 : 3 }}
                  />
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label} numberOfLines={1}>
                {i % every === 0 ? dayLabel(r.date) : ' '}
              </ThemedText>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="small">{label}</ThemedText>
    </View>
  );
}

const SIZE = 150;
const R = 54;
const STROKE = 24;
const CIRC = 2 * Math.PI * R;

// "Where leads came from" — Paid vs Direct donut (react-native-svg, already in
// the app for the menu icons) with the same tappable legend counts.
export function SourceDonut({ paid, organic, onDrill }: { paid: number; organic: number; onDrill: (paid: '1' | '0') => void }) {
  const parts = ([
    { name: 'Paid', value: paid, color: C_PAID, key: '1' as const },
    { name: 'Direct', value: organic, color: C_ORGANIC, key: '0' as const },
  ]).filter((s) => s.value > 0);
  const total = parts.reduce((a, s) => a + s.value, 0);
  let offset = 0;

  return (
    <View style={styles.donutRow}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {parts.map((s) => {
          const len = (s.value / total) * CIRC;
          const gap = parts.length > 1 ? 3 : 0;
          const el = (
            <Circle
              key={s.name}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${Math.max(len - gap, 0)} ${CIRC - Math.max(len - gap, 0)}`}
              strokeDashoffset={-offset}
              rotation={-90}
              origin={`${SIZE / 2}, ${SIZE / 2}`}
              onPress={() => onDrill(s.key)}
            />
          );
          offset += len;
          return el;
        })}
      </Svg>
      <View style={styles.donutLegend}>
        {parts.map((s) => (
          <View key={s.name} style={styles.donutLine}>
            <LegendDot color={s.color} label={s.name} />
            <DrillLink onPress={() => onDrill(s.key)} bold>{num(s.value)}</DrillLink>
          </View>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Direct means no Meta ad was attributed. It is not proof the enquiry was organic.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.two },
  flexEnd: { marginLeft: 'auto' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  dot: { width: 10, height: 10, borderRadius: 2 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H + 22, borderBottomWidth: 1 },
  col: { width: COL_W, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  stack: { justifyContent: 'flex-end', alignItems: 'center' },
  label: { fontSize: 9, marginTop: 4, width: COL_W + 14, textAlign: 'center' },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  donutLegend: { flex: 1, minWidth: 150, gap: Spacing.two },
  donutLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
