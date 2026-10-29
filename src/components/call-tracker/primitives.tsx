import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeights, Radii, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { initials } from '@/lib/call-tracker-format';

export const PRESSED_OPACITY = 0.6;

// Subtle fade (+ 6px rise) on mount. Remount with a new `key` to replay.
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 220, delay, useNativeDriver: true }).start();
  }, [progress, delay]);

  return (
    <Animated.View style={[style, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: withAlpha(theme.primary, 0.12) }]}>
      <ThemedText style={{ color: theme.primary, fontSize: size * 0.34, lineHeight: size * 0.44, fontFamily: FontWeights.semiBold }}>{initials(name)}</ThemedText>
    </View>
  );
}

// Section caption: 13 semibold uppercase muted.
export function SectionTitle({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <ThemedText themeColor="textMuted" style={styles.sectionTitle}>{children.toUpperCase()}</ThemedText>
    </View>
  );
}

export type SegmentedOption = { value: string; label: string };

// Pill segmented control (iOS style): a tinted track with a raised active segment.
export function Segmented({ options, value, onChange }: { options: SegmentedOption[]; value: string; onChange: (value: string) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: withAlpha(theme.border, 0.6) }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              active && [styles.segmentActive, { backgroundColor: theme.backgroundElement }],
              pressed && !active && { opacity: PRESSED_OPACITY },
            ]}>
            <ThemedText style={[styles.segmentText, { color: active ? theme.text : theme.textSecondary }, active && { fontFamily: FontWeights.semiBold }]} numberOfLines={1}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, lineHeight: 18, fontFamily: FontWeights.semiBold, letterSpacing: 0.8 },
  track: { flexDirection: 'row', padding: 3, borderRadius: Radii.sm + 2, gap: 2 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.sm, paddingHorizontal: 8 },
  segmentActive: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontSize: 14, lineHeight: 20, fontFamily: FontWeights.medium },
});
