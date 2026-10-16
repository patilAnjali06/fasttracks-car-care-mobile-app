import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { fetchSalesOrders, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { SalesOrder } from '@/types/api';

// erp-sales.ts: canAccess=[OWNER,STORE_MANAGER,SALES,ACCOUNTING,CASHIER] gates
// GET /erp/sales; canWrite=[OWNER,STORE_MANAGER,SALES] for create/status,
// delete narrower still ([OWNER,STORE_MANAGER]) (verified 2026-09-19). List
// is unpaginated with a deep lines+item include — read-only view against the
// existing endpoint with client-side windowing, no write actions in this pass.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'SALES', 'ACCOUNTING', 'CASHIER'];
const PAGE_SIZE = 25;

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function ErpSalesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');

  const [orders, setOrders] = useState<SalesOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setOrders(await fetchSalesOrders());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load sales orders.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          ERP Sales is only available to Owner, Store Manager, Sales, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  const windowed = (orders ?? []).slice(0, visibleCount);

  return (
    <>
      <Stack.Screen options={{ title: 'ERP Sales' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {orders === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <FlatList
          data={windowed}
          keyExtractor={(o) => o.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, orders.length))}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No sales orders.</ThemedText>}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.customerName} · {formatCurrency(item.totalAmount)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.status} · {item.lines.length} line{item.lines.length === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleDateString('en-IN')}
              </ThemedText>
            </ThemedView>
          )}
          ListFooterComponent={windowed.length < orders.length ? <ActivityIndicator style={styles.spinner} /> : null}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.one },
});
