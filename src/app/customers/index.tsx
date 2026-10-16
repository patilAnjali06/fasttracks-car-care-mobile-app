import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteCustomer, fetchCustomers, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CustomerListItem } from '@/types/api';

// CORRECTED 2026-09-28 (re-verification sweep): date-range/source filters
// and OWNER-only delete (DELETE /crm/customers/:id, requireOwner,
// backend/src/routes/crm.ts) were both missing — added here. Known
// remaining gap, deliberately not built this pass: the dashboard's "Status"
// tab is a full kanban board (board-stage drag-advance + a walkout-reason
// dialog) — a genuinely separate, large feature on its own backend surface
// (PATCH board-stage route), not a quick addition to this list screen.
// Flagged rather than silently skipped.
function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

// Dashboard's SOURCE_LABELS — matches page.tsx's own map for the source
// badge + source filter dropdown.
const SOURCE_OPTIONS = [
  { value: 'INSTAGRAM_FACEBOOK', label: 'Instagram / Facebook' },
  { value: 'FAMILY_FRIENDS', label: 'Family & Friends' },
  { value: 'GOOGLE_SEARCH', label: 'Google Search' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'INTERNAL_EMPLOYEE', label: 'Internal Employee' },
  { value: 'KNOWN_TO_OWNER', label: 'Known to Owner' },
  { value: 'REGULAR_CUSTOMER', label: 'Regular Customer' },
];

export default function CustomersScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerListItem[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setError(null);
    try {
      const result = await fetchCustomers(query || undefined, {
        fromDate: fromDate.trim() || undefined,
        toDate: toDate.trim() || undefined,
        source: source ?? undefined,
      });
      setCustomers(result.customers);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load customers.'));
    }
  }, [fromDate, toDate, source]);

  useEffect(() => {
    const handle = setTimeout(() => {
      load(search);
    }, 300);
    return () => clearTimeout(handle);
  }, [search, load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load(search);
    setIsRefreshing(false);
  };

  const hasActiveFilters = !!(fromDate || toDate || source);
  const clearFilters = () => { setFromDate(''); setToDate(''); setSource(null); };

  const onDeleteCustomer = (c: CustomerListItem) => {
    Alert.alert('Delete customer', `Permanently delete ${c.name}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingId(c.id);
          setError(null);
          try {
            await deleteCustomer(c.id);
            setCustomers((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete this customer.'));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, phone, vehicle number…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Pressable onPress={() => setShowFilters((v) => !v)}>
          <ThemedText type="link">{showFilters ? 'Hide filters' : hasActiveFilters ? `Filters (${[fromDate, toDate, source].filter(Boolean).length})` : 'Filters'}</ThemedText>
        </Pressable>
        {showFilters && (
          <View style={styles.filterBlock}>
            <View style={styles.dateRow}>
              <TextInput
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="From YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <TextInput
                value={toDate}
                onChangeText={setToDate}
                placeholder="To YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
                style={[styles.searchInput, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
              <Pressable onPress={() => setSource(null)} style={[styles.chip, { backgroundColor: source === null ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={source === null ? styles.chipLabelActive : undefined}>All sources</ThemedText>
              </Pressable>
              {SOURCE_OPTIONS.map((s) => (
                <Pressable key={s.value} onPress={() => setSource(s.value)} style={[styles.chip, { backgroundColor: source === s.value ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={source === s.value ? styles.chipLabelActive : undefined}>{s.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
            {hasActiveFilters && (
              <Pressable onPress={clearFilters}><ThemedText type="small" themeColor="textSecondary">Clear filters</ThemedText></Pressable>
            )}
          </View>
        )}
      </View>

      {customers === null ? (
        <ThemedView style={styles.center}>
          {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
        </ThemedView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {customers.length === 0 && !error && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No customers found.
            </ThemedText>
          )}

          {customers.map((c) => (
            <ThemedView key={c.id} type="backgroundElement" style={styles.row}>
              <Link href={`/customers/${c.id}`} asChild>
                <Pressable>
                  <View style={styles.rowTop}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                      {c.name}
                      {c.isRegular ? ' · Regular' : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatCurrency(c.totalSpent)}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {c.phone}
                    {c.vehicles.length > 0 ? ` · ${c.vehicles.map((v) => v.vehicleNumber).join(', ')}` : ''}
                    {c.source ? ` · ${SOURCE_OPTIONS.find((s) => s.value === c.source)?.label ?? c.source}` : ''}
                  </ThemedText>
                </Pressable>
              </Link>
              {isOwner && (
                <Pressable onPress={() => onDeleteCustomer(c)} disabled={deletingId === c.id} style={styles.deleteRow}>
                  {deletingId === c.id ? <ActivityIndicator size="small" /> : <ThemedText type="small" style={styles.error}>Delete</ThemedText>}
                </Pressable>
              )}
            </ThemedView>
          ))}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBar: { padding: Spacing.three, paddingBottom: Spacing.two },
  searchInput: { height: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  list: { padding: Spacing.three, paddingTop: 0, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  error: { color: '#B83030' },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1 },
  filterBlock: { gap: Spacing.two, marginTop: Spacing.two },
  dateRow: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  chipScroller: { flexDirection: 'row' },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, marginRight: Spacing.one },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  deleteRow: { marginTop: Spacing.one, alignSelf: 'flex-start' },
});
