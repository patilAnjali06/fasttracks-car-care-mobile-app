import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  /** Fully round (avatars). */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Dashboard .skeleton: --color-border block, 6px radius, shimmering. A plain
// opacity pulse stands in for the gradient shimmer.
export function Skeleton({ width = '100%', height = 16, circle = false, style }: SkeletonProps) {
  const theme = useTheme();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, opacity, backgroundColor: theme.border, borderRadius: circle ? height / 2 : 6 },
        style,
      ]}
    />
  );
}

// Dashboard SkeletonKPI / SkeletonCard: stat-tile placeholder.
export function SkeletonCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}>
      <View style={styles.cardTop}>
        <Skeleton width={120} height={12} />
        <Skeleton width={44} height={44} style={styles.icon} />
      </View>
      <Skeleton width={160} height={32} />
      <Skeleton width={80} height={12} />
    </View>
  );
}

// Dashboard SkeletonList: avatar + two lines + trailing text, repeated.
export function SkeletonList({ items = 5 }: { items?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: items }).map((_, i) => (
        <View key={i} style={styles.listRow}>
          <Skeleton width={40} height={40} circle />
          <View style={styles.listText}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="40%" height={11} />
          </View>
          <Skeleton width={60} height={11} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radii.md, padding: 24, gap: Spacing.three },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  icon: { borderRadius: Radii.md },
  list: { gap: Spacing.three },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two },
  listText: { flex: 1, gap: Spacing.two },
});
