import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SCREEN_REGISTRY } from '@/constants/screen-registry';
import { Layout, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchNotifications, getErrorMessage, markNotificationRead, markNotificationsRead } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AppNotification } from '@/types/api';

// Mirrors the dashboard's notifications page (own notifications only — the API
// scopes by JWT; notifications can be marked read but not deleted). Pagination
// is page-based (`page`/`limit`), matching GET /notifications. The dashboard's
// module tabs, filters and grouping are intentionally left out of this pass.
const PAGE_SIZE = 20;

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * `metadata.link` is a dashboard web path ('/dashboard/my-tasks'). Maps it to
 * the matching mobile route via the registry's `dashboardRoute`, the same way
 * push-notifications.ts routes taps. Returns null (row just marks read, no
 * navigation) for anything unmapped or role-gated away — never guesses.
 */
function mobileRouteFor(link: unknown, role: string | undefined): string | null {
  if (typeof link !== 'string' || !link.startsWith('/')) return null;
  const path = link.split(/[?#]/)[0];
  if (path === '/dashboard/my-tasks' || path === '/dashboard/tasks') return '/tasks';
  const screen = SCREEN_REGISTRY.find((s) => s.dashboardRoute === path && s.id !== 'team-chat');
  if (!screen) return null;
  if (screen.visibleToRoles && !screen.visibleToRoles.includes(role ?? '')) return null;
  return screen.route ?? `/more/${screen.id}`;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();

  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null); // initial/refresh load failure
  const [moreError, setMoreError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Drops a late load-more response that a refresh has since superseded.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    setMoreError(null);
    try {
      const res = await fetchNotifications({ page: 1, limit: PAGE_SIZE });
      if (seq !== loadSeq.current) return;
      setItems(res.data);
      setTotal(res.total);
      setPage(1);
    } catch (err: any) {
      if (seq === loadSeq.current) setError(getErrorMessage(err, 'Could not load notifications.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const hasMore = items !== null && items.length < total;

  const loadMore = async () => {
    if (!hasMore || isLoadingMore || isRefreshing) return;
    const seq = loadSeq.current;
    setIsLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetchNotifications({ page: page + 1, limit: PAGE_SIZE });
      if (seq !== loadSeq.current) return;
      // New notifications can shift pages between requests, so drop repeats.
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id));
        return [...(prev ?? []), ...res.data.filter((n) => !seen.has(n.id))];
      });
      setTotal(res.total);
      setPage(page + 1);
    } catch (err: any) {
      if (seq === loadSeq.current) setMoreError(getErrorMessage(err, 'Could not load more notifications.'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const setReadLocally = (ids: Set<string>, isRead: boolean) =>
    setItems((prev) => prev?.map((n) => (ids.has(n.id) ? { ...n, isRead } : n)) ?? prev);

  const onOpen = async (n: AppNotification) => {
    setActionError(null);
    if (!n.isRead) {
      setReadLocally(new Set([n.id]), true);
      markNotificationRead(n.id).catch((err: any) => {
        setReadLocally(new Set([n.id]), false);
        setActionError(getErrorMessage(err, 'Could not mark as read.'));
      });
    }
    const target = mobileRouteFor(n.metadata?.link, user?.role);
    if (target) router.push(target as never);
  };

  const onMarkAll = async () => {
    setIsMarkingAll(true);
    setActionError(null);
    try {
      await markNotificationsRead();
      setItems((prev) => prev?.map((n) => ({ ...n, isRead: true })) ?? prev);
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not mark all as read.'));
    } finally {
      setIsMarkingAll(false);
    }
  };

  const hasUnread = items?.some((n) => !n.isRead) ?? false;

  const header = (
    <Stack.Screen
      options={{
        title: 'Notifications',
        headerRight: () =>
          hasUnread ? (
            <Pressable onPress={onMarkAll} disabled={isMarkingAll} hitSlop={8} accessibilityLabel="Mark all notifications as read">
              {isMarkingAll ? <ActivityIndicator /> : <ThemedText type="link">Mark all read</ThemedText>}
            </Pressable>
          ) : null,
      }}
    />
  );

  if (items === null) {
    return (
      <>
        {header}
        <ThemedView style={styles.center}>
          {error ? (
            <>
              <ThemedText style={styles.error}>{error}</ThemedText>
              <Pressable onPress={load} style={styles.retryButton}>
                <ThemedText type="small" style={styles.retryLabel}>Retry</ThemedText>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator />
          )}
        </ThemedView>
      </>
    );
  }

  return (
    <>
      {header}
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          error || actionError ? (
            <ThemedText style={styles.error}>{error ?? actionError}</ThemedText>
          ) : null
        }
        ListEmptyComponent={
          error ? null : (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No notifications.
            </ThemedText>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <ActivityIndicator style={styles.footer} />
          ) : moreError ? (
            <View style={styles.footer}>
              <ThemedText style={styles.error}>{moreError}</ThemedText>
              <Pressable onPress={loadMore} style={styles.retryButton}>
                <ThemedText type="small" style={styles.retryLabel}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : hasMore ? (
            <Pressable onPress={loadMore} style={styles.footer}>
              <ThemedText type="link">Load more</ThemedText>
            </Pressable>
          ) : null
        }
        renderItem={({ item: n }) => (
          <Pressable onPress={() => onOpen(n)} accessibilityRole="button">
            <ThemedView
              type="backgroundElement"
              style={[styles.card, !n.isRead && { borderLeftColor: theme.primary, borderLeftWidth: 4 }]}>
              <View style={styles.cardTop}>
                <ThemedText type={n.isRead ? 'default' : 'smallBold'} style={styles.message}>
                  {n.message}
                </ThemedText>
                {!n.isRead && <View style={[styles.dot, { backgroundColor: theme.primary }]} />}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {timeAgo(n.createdAt)}
              </ThemedText>
            </ThemedView>
          </Pressable>
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.three },
  list: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  error: { color: '#B83030', textAlign: 'center' },
  footer: { alignItems: 'center', gap: Spacing.two, minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  message: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  retryButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E' },
  retryLabel: { color: '#ffffff' },
});
