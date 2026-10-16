import { BlurView } from 'expo-blur';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Translucent, blurred "glass" panel — the shared surface for Home widgets
 * and the side menu (glassmorphism per the nav/visual redesign). Falls back
 * gracefully if BlurView can't blur on a given platform/build (e.g. some
 * Android release-build configurations): the semi-transparent tinted
 * background under it still reads as a distinct panel either way. */
export function GlassCard({ style, children, ...rest }: ViewProps) {
  const scheme = useColorScheme();
  return (
    <View style={[styles.wrap, style]} {...rest}>
      <BlurView
        intensity={40}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        // See side-menu.tsx — Android needs this explicit native blur method
        // or BlurView silently falls back to a flat translucent tint.
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: scheme === 'dark' ? 'rgba(31,22,24,0.3)' : 'rgba(255,255,255,0.35)' },
        ]}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radii.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  content: { padding: Spacing.three, gap: Spacing.two },
});
