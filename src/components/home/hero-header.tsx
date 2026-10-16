import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MenuButton } from '@/components/menu-button';
import { ThemedText } from '@/components/themed-text';
import { attendanceStatusColor, attendanceStatusLabel } from '@/constants/attendance-status';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AttendanceRecord } from '@/types/api';

export const HERO_EXPANDED_HEIGHT = 210;
export const HERO_COLLAPSED_HEIGHT = 56;

interface HeroHeaderProps {
  scrollY: SharedValue<number>;
  record: AttendanceRecord | null;
  clockInTime: string;
  onPressStatus: () => void;
}

/** Collapsing parallax hero: full logo + today's live status strip at rest,
 * settling into a small centered logo + status dot in the top bar once the
 * user scrolls the Home screen (Part 4c of the nav/home redesign). Driven by
 * `scrollY` (a Reanimated shared value from the screen's Animated.ScrollView)
 * via `interpolate`, not a manual onScroll re-render. */
export function HeroHeader({ scrollY, record, clockInTime, onPressStatus }: HeroHeaderProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const topInset = insets.top;
  const expandedTotal = HERO_EXPANDED_HEIGHT + topInset;
  const collapsedTotal = HERO_COLLAPSED_HEIGHT + topInset;
  const range = expandedTotal - collapsedTotal;

  const containerStyle = useAnimatedStyle(() => {
    const height = interpolate(scrollY.value, [0, range], [expandedTotal, collapsedTotal], 'clamp');
    return { height };
  });

  const expandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, range * 0.6], [1, 0], 'clamp'),
  }));

  const collapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [range * 0.5, range], [0, 1], 'clamp'),
  }));

  const statusColor = attendanceStatusColor(record?.status);

  return (
    <Animated.View style={[styles.container, { paddingTop: topInset }, containerStyle]}>
      <BlurView
        intensity={60}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        // See side-menu.tsx / glass-card.tsx — required on Android for real
        // blur instead of a flat translucent fallback.
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: scheme === 'dark' ? 'rgba(31,22,24,0.35)' : 'rgba(255,255,255,0.4)' },
        ]}
      />

      {/* Collapsed bar — small centered logo + hamburger + status dot */}
      <Animated.View style={[styles.collapsedRow, collapsedStyle]} pointerEvents="box-none">
        <MenuButton />
        <View style={styles.collapsedCenter}>
          <Image source={require('@/../assets/images/brand-logo-icon.png')} style={styles.logoSmall} />
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
        </View>
        <View style={styles.headerSpacer} />
      </Animated.View>

      {/* Expanded hero — big logo + full status strip */}
      <Animated.View style={[styles.expanded, expandedStyle]}>
        <View style={styles.expandedTop}>
          <MenuButton />
          <View style={styles.headerSpacer} />
        </View>
        <Image source={require('@/../assets/images/brand-logo-icon.png')} style={styles.logoBig} />
        <View
          onTouchEnd={onPressStatus}
          style={[styles.statusStrip, { borderColor: statusColor }]}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <ThemedText type="smallBold">{attendanceStatusLabel(record?.status)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {clockInTime}
          </ThemedText>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  collapsedRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  collapsedCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  headerSpacer: { width: 26 },
  logoSmall: { width: 26, height: 26, borderRadius: 6 },
  expanded: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  expandedTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logoBig: { width: 56, height: 56, borderRadius: 14, alignSelf: 'center' },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
