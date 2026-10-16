import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { fetchPurchaseOrders, fetchSuppliers, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ERPSupplier, PurchaseOrder } from '@/types/api';

// erp-purchases.ts: canAccess=[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER,
// INVENTORY_MANAGER] gates GET /erp/purchases and GET /erp/suppliers;
// canWrite=[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER] for create/status;
// delete narrower still ([OWNER,STORE_MANAGER] for orders, OWNER only for
// suppliers) (both files verified 2026-09-19). Both list endpoints are
// unpaginated with deep nested includes (lines+item, or the supplier itself)
// — this is a read-only view built against the existing endpoint with
// client-side windowing rather than a new backend endpoint, per the
// mobile-shaped-endpoint guidance for this module.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'ACCOUNTING', 'CASHIER', 'INVENTORY_MANAGER'];
const PAGE_SIZE = 25;

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function PurchasingScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [suppliers, setSuppliers] = useState<ERPSupplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [o, s] = await Promise.all([fetchPurchaseOrders(), fetchSuppliers()]);
      setOrders(o);
      setSuppliers(s);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load purchasing data.'));
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
          Purchasing is only available to Owner, Store Manager, Accounting, Cashier, or Inventory Manager accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  const ordersWindowed = (orders ?? []).slice(0, visibleCount);

  return (
    <>
      <Stack.Screen options={{ title: 'Purchasing' }} />
      <View style={styles.tabRow}>
        <Pressable onPress={() => setTab('orders')} style={[styles.tabBtn, tab === 'orders' && styles.tabBtnActive]}>
          <ThemedText type="smallBold">Purchase Orders</ThemedText>
        </Pressable>
        <Pressable onPress={() => setTab('suppliers')} style={[styles.tabBtn, tab === 'suppliers' && styles.tabBtnActive]}>
          <ThemedText type="smallBold">Suppliers</ThemedText>
        </Pressable>
      </View>
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {orders === null || suppliers === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : tab === 'orders' ? (
        <FlatList
          data={ordersWindowed}
          keyExtractor={(o) => o.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, orders.length))}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No purchase orders.</ThemedText>}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.supplier.name} · {formatCurrency(item.totalAmount)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.status} · {item.lines.length} line{item.lines.length === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleDateString('en-IN')}
              </ThemedText>
            </ThemedView>
          )}
          ListFooterComponent={ordersWindowed.length < orders.length ? <ActivityIndicator style={styles.spinner} /> : null}
        />
      ) : (
        <FlatList
          data={suppliers}
          keyExtractor={(s) => s.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No suppliers.</ThemedText>}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.row}>
              <ThemedText type="smallBold">{item.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[item.contact, item.phone, item.email].filter(Boolean).join(' · ') || 'No contact details'}
              </ThemedText>
            </ThemedView>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  tabRow: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.three },
  tabBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: 'rgba(120,120,140,0.15)' },
  tabBtnActive: { backgroundColor: 'rgba(120,120,140,0.35)' },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.one },
});
