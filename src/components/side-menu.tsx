import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { SCREEN_REGISTRY } from '@/constants/screen-registry';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth-context';
import { useDrawer } from '@/lib/drawer-context';

const PANEL_WIDTH = Math.min(300, Dimensions.get('window').width * 0.82);

const MENU_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  tasks: 'checkbox-outline',
  customers: 'people-outline',
  'my-timesheet': 'time-outline',
  reminders: 'alarm-outline',
  'my-salary': 'wallet-outline',
  'my-payslips': 'document-outline',
  expenses: 'receipt-outline',
  payslips: 'document-text-outline',
  overtime: 'hourglass-outline',
  'leave-requests': 'calendar-outline',
  onboarding: 'clipboard-outline',
  applications: 'person-add-outline',
  'my-finance': 'cash-outline',
  'personal-info': 'person-outline',
  'timesheets-manager': 'time-outline',
  'overtime-approval': 'hourglass-outline',
  'finance-approvals': 'cash-outline',
  employees: 'people-outline',
  'employee-documents': 'folder-outline',
  contacts: 'call-outline',
  incentives: 'trophy-outline',
  'team-chat': 'chatbubbles-outline',
  payroll: 'wallet-outline',
  inventory: 'cube-outline',
  invoices: 'document-text-outline',
  quotations: 'reader-outline',
  pipeline: 'git-network-outline',
  calls: 'call-outline',
  accounting: 'calculator-outline',
  accounts: 'business-outline',
  financial: 'bar-chart-outline',
  legal: 'briefcase-outline',
  devices: 'phone-portrait-outline',
  settings: 'construct-outline',
  'sim-tracker': 'card-outline',
  agents: 'hardware-chip-outline',
  overview: 'speedometer-outline',
  remarks: 'chatbox-ellipses-outline',
  'new-entry': 'add-circle-outline',
  attendance: 'time-outline',
  'erp-finance': 'cash-outline',
};

// Guards against a bug that's shipped 3 times now (Phase 2, 3, 4): a new
// screen-registry entry with no matching MENU_ICONS key silently falls back
// to a plain circle in the side menu instead of a real icon. This surfaces
// it immediately in dev rather than waiting for someone to spot a circle on
// a real device.
if (__DEV__) {
  const missing = SCREEN_REGISTRY.filter((s) => !MENU_ICONS[s.id]).map((s) => s.id);
  if (missing.length > 0) {
    console.warn(
      `[side-menu] MENU_ICONS is missing an entry for: ${missing.join(', ')} — these will render as a plain circle. Add them to MENU_ICONS in src/components/side-menu.tsx.`
    );
  }
}

/** Layered icon that fakes a soft 3D/neumorphic look from a flat vector
 * glyph: a dark "shadow" glyph offset behind a lighter one, no real 3D asset
 * pipeline available in this environment (see NAV_REDESIGN_PLAN.md). */
function DepthIcon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <Animated.View style={styles.iconWrap}>
      <Ionicons name={name} size={22} color="#00000030" style={styles.iconShadow} />
      <Ionicons name={name} size={22} color={color} />
    </Animated.View>
  );
}

export function SideMenu() {
  const { isOpen, close } = useDrawer();
  const { user, signOut } = useAuth();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(isOpen ? 1 : 0, { duration: 260 });
  }, [isOpen, progress]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * PANEL_WIDTH }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.45,
    pointerEvents: progress.value > 0 ? 'auto' : 'none',
  }));

  const pan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      if (e.translationX < 0) {
        progress.value = Math.max(0, 1 + e.translationX / PANEL_WIDTH);
      }
    })
    .onEnd((e) => {
      const shouldClose = e.translationX < -PANEL_WIDTH / 3 || e.velocityX < -800;
      progress.value = withTiming(shouldClose ? 0 : 1, { duration: 220 });
      if (shouldClose) runOnJS(close)();
    });

  const items = SCREEN_REGISTRY.filter((s) => !s.visibleToRoles || s.visibleToRoles.includes(user?.role ?? ''));

  const navigateTo = (id: string, route?: string) => {
    close();
    router.push((route ?? `/more/${id}`) as never);
  };

  if (!isOpen) {
    // Still mounted (for the closing animation) but non-interactive once
    // fully closed — avoids an invisible overlay eating touches.
  }

  return (
    <>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        pointerEvents={isOpen ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.panel, { width: PANEL_WIDTH, backgroundColor: colors.background }, panelStyle]}
          pointerEvents={isOpen ? 'auto' : 'none'}>
          {/* Solid opaque base FIRST: on some Android devices (confirmed on a
              tablet/foldable) experimentalBlurMethod silently renders fully
              transparent instead of falling back to a tint, letting the
              screen underneath show through and overlap the drawer's own
              text. The panel's own backgroundColor above is what guarantees
              opacity; BlurView is a decorative layer on top of it, never
              load-bearing for readability. */}
          <BlurView
            intensity={70}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.panelContent}>
            <ScrollView contentContainerStyle={styles.scroll}>
              <Image source={require('@/../assets/images/brand-logo-icon.png')} style={styles.logo} />
              <ThemedText type="subtitle">{user?.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.role}>
                {user?.role}
              </ThemedText>

              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => navigateTo(item.id, item.route)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                  <DepthIcon name={MENU_ICONS[item.id] ?? 'ellipse-outline'} color={colors.text} />
                  <ThemedText style={styles.rowLabel}>{item.title}</ThemedText>
                </Pressable>
              ))}

              <Pressable
                onPress={() => {
                  close();
                  signOut();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                <DepthIcon name="log-out-outline" color={colors.danger} />
                <ThemedText style={[styles.rowLabel, { color: colors.danger }]}>Sign out</ThemedText>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000000', zIndex: 20 },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
    overflow: 'hidden',
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 16,
  },
  panelContent: { flex: 1 },
  scroll: { padding: Spacing.four, gap: Spacing.one },
  logo: { width: 48, height: 48, marginBottom: Spacing.two, borderRadius: 12 },
  role: { marginBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  rowPressed: { opacity: 0.5 },
  rowLabel: { fontSize: 16 },
  iconWrap: { width: 22, height: 22 },
  iconShadow: { position: 'absolute', top: 1.5, left: 1.5 },
});
