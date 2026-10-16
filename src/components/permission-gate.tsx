import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePermissions } from '@/lib/permissions-context';

// Full-screen gate for a tab driven by the getTabAccess/mergePermissions
// system (see MOBILE_PERMISSIONS_PATTERN.md and src/lib/permissions-context.tsx).
// Renders a distinct state for each of: still loading, failed to load (with
// retry — the fail-closed path must be visibly recoverable, never a silent
// blank screen), and genuinely denied. Only renders `children` once the
// permissions fetch succeeded AND the tab is enabled.
export function PermissionGate({
  tabKey,
  deniedMessage,
  children,
}: {
  tabKey: string;
  deniedMessage?: string;
  children: ReactNode;
}) {
  const { status, hasTab, refresh } = usePermissions();

  if (status === 'idle' || status === 'loading') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (status === 'error') {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary" style={styles.message}>
          Couldn&apos;t load your permissions.
        </ThemedText>
        <Pressable onPress={() => refresh()} style={styles.retryButton}>
          <ThemedText style={styles.retryLabel}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (!hasTab(tabKey)) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary" style={styles.message}>
          {deniedMessage ?? 'You do not have access to this feature.'}
        </ThemedText>
      </ThemedView>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  message: { textAlign: 'center' },
  retryButton: { height: 44, paddingHorizontal: Spacing.four, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7A1C2E' },
  retryLabel: { color: '#ffffff', fontWeight: '600' },
});
