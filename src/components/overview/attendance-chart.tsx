import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { FontWeights, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Exact colours from the dashboard's AttendanceChart.
const GREEN = '#16a34a';
const YELLOW = '#eab308';
const RED = '#ef4444';

type Props = { onTime: number; late: number; absent: number; dateLabel: string };

const HEIGHT = 160;
const TOP = 10;
const BOTTOM = 26; // x-axis label row
const LEFT = 28; // y-axis width
const RIGHT = 20;
const BAR_W = 48;
const BAR_GAP = 4;

// Y-axis step: smallest "nice" step that fits the data in 4 intervals (5
// ticks, like the dashboard's recharts axis). 43 -> 15, giving 0/15/30/45/60.
function niceStep(max: number) {
  const raw = Math.max(max, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 1.5, 2, 2.5, 5, 7.5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

// Dashboard AttendanceChart: stacked "present" bar (on-time green + late
// amber on top) beside a red "absent" bar, count labels inside, tap for the
// tooltip, coloured legend and a Present / Absent summary.
export function AttendanceChart({ onTime, late, absent, dateLabel }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState(false);

  const present = onTime + late;
  const step = niceStep(Math.max(present, absent));
  const yMax = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);

  const plotH = HEIGHT - TOP - BOTTOM;
  const plotW = Math.max(width - LEFT - RIGHT, 0);
  const y = (v: number) => TOP + plotH - (v / yMax) * plotH;
  const h = (v: number) => (v / yMax) * plotH;

  const groupW = BAR_W * 2 + BAR_GAP;
  const presentX = LEFT + (plotW - groupW) / 2;
  const absentX = presentX + BAR_W + BAR_GAP;

  const count = (value: number, x: number, top: number) =>
    value > 0 ? (
      <SvgText key={`${x}-${top}`} x={x + BAR_W / 2} y={top + h(value) / 2 + 4} fill="#fff" fontSize={11} fontWeight="700" textAnchor="middle">
        {value}
      </SvgText>
    ) : null;

  // Light grey plot area (the dashboard's chart hover/cursor tint).
  const plotBg = withAlpha(theme.border, 0.35);

  return (
    <Card padding="none" style={styles.card}>
      <ThemedText themeColor="textMuted" style={styles.title}>{`${dateLabel} Attendance`.toUpperCase()}</ThemedText>

      <Pressable onPress={() => setTip(false)} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Rect x={LEFT} y={TOP} width={plotW} height={plotH} fill={plotBg} />
            {ticks.map((t) => (
              <G key={t}>
                <Line x1={LEFT} x2={LEFT + plotW} y1={y(t)} y2={y(t)} stroke={theme.border} strokeDasharray="3 3" />
                <SvgText x={LEFT - 6} y={y(t) + 4} fill={theme.textMuted} fontSize={11} textAnchor="end">{t}</SvgText>
              </G>
            ))}
            <Rect x={presentX} y={y(onTime)} width={BAR_W} height={h(onTime)} fill={GREEN} onPress={() => setTip(true)} />
            <Rect x={presentX} y={y(present)} width={BAR_W} height={h(late)} fill={YELLOW} onPress={() => setTip(true)} />
            <Rect x={absentX} y={y(absent)} width={BAR_W} height={h(absent)} fill={RED} onPress={() => setTip(true)} />
            {count(onTime, presentX, y(onTime))}
            {count(late, presentX, y(present))}
            {count(absent, absentX, y(absent))}
            <SvgText x={LEFT + plotW / 2} y={HEIGHT - 8} fill={theme.textMuted} fontSize={12} textAnchor="middle">{dateLabel}</SvgText>
          </Svg>
        )}
        {tip && width > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, left: Math.min(Math.max(presentX + groupW / 2 - 50, 0), Math.max(width - 130, 0)) },
            ]}>
            <ThemedText style={styles.tipTitle}>{dateLabel}</ThemedText>
            <ThemedText style={[styles.tipLine, { color: GREEN }]}>On-time : {onTime}</ThemedText>
            <ThemedText style={[styles.tipLine, { color: YELLOW }]}>Late : {late}</ThemedText>
            <ThemedText style={[styles.tipLine, { color: RED }]}>Absent : {absent}</ThemedText>
          </View>
        )}
      </Pressable>

      <View style={styles.legend}>
        {(
          [
            ['On-time', GREEN],
            ['Late', YELLOW],
            ['Absent', RED],
          ] as const
        ).map(([label, color]) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: color }]} />
            <ThemedText style={[styles.legendText, { color }]}>{label}</ThemedText>
          </View>
        ))}
      </View>

      <ThemedText themeColor="textMuted" style={styles.summary}>
        <ThemedText style={[styles.summaryStrong, { color: GREEN }]}>{present} Present</ThemedText>
        {late > 0 ? <ThemedText style={[styles.summaryText, { color: YELLOW }]}>{` (${late} Late)`}</ThemedText> : null}
        <ThemedText themeColor="textMuted" style={styles.summaryText}>{' · '}</ThemedText>
        <ThemedText style={[styles.summaryStrong, { color: RED }]}>{absent} Absent</ThemedText>
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  // Dashboard: padding 16px 20px.
  card: { paddingVertical: 16, paddingHorizontal: 20 },
  title: { fontSize: 12, lineHeight: 18, fontFamily: FontWeights.semiBold, letterSpacing: 0.6, marginBottom: 12 },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.three, paddingTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10 },
  legendText: { fontSize: 12, lineHeight: 16 },
  summary: { textAlign: 'center', marginTop: 4 },
  summaryStrong: { fontSize: 12, lineHeight: 18, fontFamily: FontWeights.bold },
  summaryText: { fontSize: 12, lineHeight: 18 },
  tooltip: { position: 'absolute', top: 8, minWidth: 110, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, gap: 2 },
  tipTitle: { fontSize: 12, lineHeight: 16, fontFamily: FontWeights.semiBold },
  tipLine: { fontSize: 12, lineHeight: 16 },
});
