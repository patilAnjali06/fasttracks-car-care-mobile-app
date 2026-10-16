import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchCustomerSpendSlabCustomers, fetchCustomerSpendSlabs,
  fetchFinancialGrowth, fetchFinancialOutstanding, fetchFinancialOverview,
  fetchFinancialRevenueBreakdown, fetchFinancialTopCustomers, getErrorMessage,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  CustomerSpendSlab, FinancialOverview, MonthlyGrowthEntry, OutstandingResponse,
  RevenueBreakdownItem, SlabCustomer, TopCustomerEntry,
} from '@/types/api';

// requireManagerOrOwner (backend/src/middleware/auth.ts:83 =
// [OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER]) gates every /financial/*
// route EXCEPT the two Customer Spend Slabs routes (backend/src/routes/
// financial.ts, re-verified 2026-09-28), which use a narrower
// requireRoles('OWNER','STORE_MANAGER') — gated separately below via
// SLAB_ROLES, not folded into this screen's own VIEW_ROLES. The
// dashboard's OWN client-side gate is actually a third, different thing
// (OWNER/STORE_MANAGER always pass, everyone else needs a
// permissions.financial tab-permission boolean the backend doesn't
// enforce at all) — mobile intentionally follows the backend's real
// requireManagerOrOwner array here rather than that dashboard-only flag,
// same precedent as every other screen in this project.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING', 'CASHIER'];
const SLAB_ROLES = ['OWNER', 'STORE_MANAGER'];

const PERIOD_OPTIONS = ['today', 'week', 'month', 'year', 'all'] as const;
const PERIOD_LABELS: Record<string, string> = { today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year', all: 'All Time' };
const BREAKDOWN_TABS = ['service', 'employee', 'brand', 'payment_mode'] as const;
const BREAKDOWN_LABELS: Record<string, string> = { service: 'By Service', employee: 'By Employee', brand: 'By Vehicle Brand', payment_mode: 'By Payment Mode' };
const SLAB_ORDER: CustomerSpendSlab[] = ['BELOW_2L', '2L_TO_5L', '5L_TO_10L', 'ABOVE_10L'];
const SLAB_LABELS: Record<CustomerSpendSlab, string> = {
  BELOW_2L: 'Below ₹2L', '2L_TO_5L': '₹2L – ₹5L', '5L_TO_10L': '₹5L – ₹10L', ABOVE_10L: 'Above ₹10L',
};

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// week = trailing 7-day window (not calendar week) — matches the
// dashboard's getPeriodDateParams() exactly.
function periodToDateParams(period: string): { fromDate?: string; toDate?: string } {
  if (period === 'all') return {};
  const now = new Date();
  let from: Date;
  switch (period) {
    case 'today': from = now; break;
    case 'week': from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
    case 'year': from = new Date(now.getFullYear(), 0, 1); break;
    case 'month':
    default: from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { fromDate: isoDate(from), toDate: isoDate(now) };
}

function getOverdueBadgeColor(days: number) {
  if (days > 30) return { bg: 'rgba(224,104,104,0.15)', text: '#e06868' };
  if (days > 15) return { bg: 'rgba(232,168,40,0.15)', text: '#e8a828' };
  return { bg: 'rgba(216,136,64,0.15)', text: '#d88840' };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function shareCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
}

type Tab = 'overview' | 'outstanding' | 'topCustomers' | 'breakdown' | 'growth' | 'slabs';

export default function FinancialScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const canSeeSlabs = SLAB_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingResponse | null>(null);
  const [topCustomers, setTopCustomers] = useState<TopCustomerEntry[] | null>(null);
  const [breakdown, setBreakdown] = useState<RevenueBreakdownItem[] | null>(null);
  const [breakdownGroupBy, setBreakdownGroupBy] = useState<typeof BREAKDOWN_TABS[number]>('service');
  const [growth, setGrowth] = useState<MonthlyGrowthEntry[] | null>(null);
  const [period, setPeriod] = useState<typeof PERIOD_OPTIONS[number]>('month');
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Customer Spend Slabs
  const [slabCounts, setSlabCounts] = useState<Record<CustomerSpendSlab, number> | null>(null);
  const [activeSlab, setActiveSlab] = useState<CustomerSpendSlab | null>(null);
  const [slabCustomers, setSlabCustomers] = useState<SlabCustomer[] | null>(null);
  const [slabSearch, setSlabSearch] = useState('');
  const [isExportingSlab, setIsExportingSlab] = useState(false);

  const load = useCallback(async (which: Tab) => {
    if (!isAuthorized) return;
    setError(null);
    try {
      if (which === 'overview') setOverview(await fetchFinancialOverview());
      else if (which === 'outstanding') setOutstanding(await fetchFinancialOutstanding());
      else if (which === 'topCustomers') setTopCustomers(await fetchFinancialTopCustomers());
      else if (which === 'breakdown') setBreakdown(await fetchFinancialRevenueBreakdown(period, breakdownGroupBy));
      else if (which === 'growth') setGrowth(await fetchFinancialGrowth());
      else if (which === 'slabs' && canSeeSlabs) {
        const { fromDate, toDate } = periodToDateParams(period);
        setSlabCounts(await fetchCustomerSpendSlabs(fromDate, toDate));
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load this data.'));
    }
  }, [isAuthorized, canSeeSlabs, period, breakdownGroupBy]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / tab, period, groupBy change
    load(tab);
  }, [load, tab]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load(tab);
    setIsRefreshing(false);
  };

  const openSlab = async (slab: CustomerSpendSlab) => {
    setActiveSlab(slab);
    setSlabCustomers(null);
    setSlabSearch('');
    setError(null);
    try {
      const { fromDate, toDate } = periodToDateParams(period);
      setSlabCustomers(await fetchCustomerSpendSlabCustomers(slab, fromDate, toDate));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load customers for this slab.'));
    }
  };

  const filteredSlabCustomers = (() => {
    if (!slabCustomers) return [];
    const q = slabSearch.trim().toLowerCase();
    if (!q) return slabCustomers;
    return slabCustomers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q));
  })();

  const onExportSlabCsv = async () => {
    if (!activeSlab || filteredSlabCustomers.length === 0) return;
    setIsExportingSlab(true);
    try {
      const headers = ['Name', 'Phone', 'Vehicle(s)', 'Total Spent', 'Purchased Items'];
      const rows = filteredSlabCustomers.map((c) => [
        c.name,
        c.phone,
        c.vehicles.map((v) => [v.make, v.model, v.year].filter(Boolean).join(' ') || 'Vehicle').join('; '),
        String(c.totalSpent),
        c.purchasedItems.join('; '),
      ]);
      await shareCsv(`customer-spend-${activeSlab}-${period}.csv`, [headers, ...rows]);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not export this list.'));
    } finally {
      setIsExportingSlab(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Financial is only available to Owner, Store Manager, HR, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Financial' }} />
      <ScrollView contentContainerStyle={styles.tabScroll} horizontal showsHorizontalScrollIndicator={false}>
        {([
          ['overview', 'Overview'], ['outstanding', 'Outstanding'], ['topCustomers', 'Top Customers'],
          ['breakdown', 'Breakdown'], ['growth', 'Growth'],
          ...(canSeeSlabs ? [['slabs', 'Customer Spend Slabs']] : []),
        ] as [Tab, string][]).map(([t, label]) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabChip, { backgroundColor: tab === t ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={tab === t ? styles.tabLabelActive : undefined}>{label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {(tab === 'breakdown' || tab === 'slabs') && (
        <ScrollView contentContainerStyle={styles.tabScroll} horizontal showsHorizontalScrollIndicator={false}>
          {PERIOD_OPTIONS.map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.periodChip, { backgroundColor: period === p ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={period === p ? styles.tabLabelActive : undefined}>{PERIOD_LABELS[p]}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {tab === 'overview' && (
          overview === null ? <ActivityIndicator style={styles.spinner} /> : (
            <View style={styles.grid}>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Revenue Today</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(overview.revenue.today)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">This Week</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(overview.revenue.thisWeek)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">This Month</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(overview.revenue.thisMonth)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">This Year</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(overview.revenue.thisYear)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Jobs Today</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{overview.jobs.today}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Jobs This Month</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{overview.jobs.thisMonth}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Total Jobs</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{overview.jobs.total}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">Outstanding</ThemedText>
                <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(overview.outstanding.amount)}</ThemedText>
              </GlassCard>
            </View>
          )
        )}

        {tab === 'outstanding' && (
          outstanding === null ? <ActivityIndicator style={styles.spinner} /> : (
            <>
              <ThemedText type="smallBold" style={styles.tabularNums}>Total outstanding: {formatCurrency(outstanding.totalOutstanding)}</ThemedText>
              {outstanding.jobs.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No outstanding payments.</ThemedText>
              ) : (
                outstanding.jobs.map((j) => {
                  const badge = getOverdueBadgeColor(j.daysSinceCreated ?? 0);
                  return (
                    <ThemedView key={j.id} type="backgroundElement" style={styles.row}>
                      <View style={styles.headerRow}>
                        <ThemedText type="smallBold" style={styles.flex1}>{j.customer?.name ?? 'Unknown customer'}</ThemedText>
                        <View style={[styles.overdueBadge, { backgroundColor: badge.bg }]}>
                          <ThemedText type="small" style={{ color: badge.text }}>{j.daysSinceCreated ?? 0}d overdue</ThemedText>
                        </View>
                      </View>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                        {formatCurrency(j.finalAmount ?? j.quotedAmount ?? 0)}
                      </ThemedText>
                      {j.assignedTo && <ThemedText type="small" themeColor="textSecondary">Handled by {j.assignedTo.name}</ThemedText>}
                    </ThemedView>
                  );
                })
              )}
            </>
          )
        )}

        {tab === 'topCustomers' && (
          topCustomers === null ? <ActivityIndicator style={styles.spinner} /> : topCustomers.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No customer data available.</ThemedText>
          ) : (
            topCustomers.map((c, i) => (
              <ThemedView key={c.customer?.id ?? i} type="backgroundElement" style={styles.row}>
                <ThemedText type="smallBold">{i + 1}. {c.customer?.name ?? 'Unknown'}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                  {formatCurrency(c.totalSpent)} · {c.invoiceCount} invoices
                </ThemedText>
              </ThemedView>
            ))
          )
        )}

        {tab === 'breakdown' && (
          <>
            <View style={styles.tabScrollInline}>
              {BREAKDOWN_TABS.map((g) => (
                <Pressable key={g} onPress={() => setBreakdownGroupBy(g)} style={[styles.periodChip, { backgroundColor: breakdownGroupBy === g ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={breakdownGroupBy === g ? styles.tabLabelActive : undefined}>{BREAKDOWN_LABELS[g]}</ThemedText>
                </Pressable>
              ))}
            </View>
            {breakdown === null ? <ActivityIndicator style={styles.spinner} /> : breakdown.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No job payment data for this period.</ThemedText>
            ) : (
              breakdown.map((b) => (
                <View key={b.service} style={styles.breakdownRow}>
                  <ThemedText type="small" style={styles.flex1} numberOfLines={1}>{b.service}</ThemedText>
                  <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(b.revenue)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{b.count} jobs</ThemedText>
                </View>
              ))
            )}
          </>
        )}

        {tab === 'slabs' && (
          !canSeeSlabs ? (
            <ThemedText type="small" themeColor="textSecondary">Customer Spend Slabs is only available to Owner or Store Manager accounts.</ThemedText>
          ) : slabCounts === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : (
            <>
              <ThemedText type="smallBold" style={styles.sectionTitle}>Customers by Spend Slab — {PERIOD_LABELS[period]}</ThemedText>
              <View style={styles.grid}>
                {SLAB_ORDER.map((slab) => (
                  <Pressable key={slab} onPress={() => openSlab(slab)} style={styles.slabCard}>
                    <ThemedView type="backgroundElement" style={styles.slabCardInner}>
                      <ThemedText type="small" themeColor="textSecondary">{SLAB_LABELS[slab]}</ThemedText>
                      <ThemedText type="title" style={styles.tabularNums}>{slabCounts[slab] ?? 0}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">customers</ThemedText>
                    </ThemedView>
                  </Pressable>
                ))}
              </View>
            </>
          )
        )}

        {tab === 'growth' && (
          growth === null ? <ActivityIndicator style={styles.spinner} /> : (
            growth.map((g) => (
              <View key={g.month} style={styles.breakdownRow}>
                <ThemedText type="small" style={styles.flex1}>{g.month}</ThemedText>
                <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(g.revenue)}</ThemedText>
                <ThemedText type="small" style={{ color: g.growthPercent == null ? theme.textSecondary : g.growthPercent >= 0 ? '#167A48' : '#B83030' }}>
                  {g.growthPercent == null ? '—' : `${g.growthPercent > 0 ? '+' : ''}${g.growthPercent}%`}
                </ThemedText>
              </View>
            ))
          )
        )}
      </ScrollView>

      <Modal visible={activeSlab != null} animationType="slide" onRequestClose={() => setActiveSlab(null)} presentationStyle="pageSheet">
        <ThemedView style={styles.flex1}>
          <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
            <ThemedText type="subtitle" style={styles.flex1} numberOfLines={1}>
              {activeSlab ? `Customers ${SLAB_LABELS[activeSlab]} — ${PERIOD_LABELS[period]}` : ''}
            </ThemedText>
            <Pressable onPress={() => setActiveSlab(null)} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
          </View>
          <View style={styles.sheetToolbar}>
            <TextInput
              value={slabSearch}
              onChangeText={setSlabSearch}
              placeholder="Search by name or phone..."
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <Pressable onPress={onExportSlabCsv} disabled={isExportingSlab || filteredSlabCustomers.length === 0} style={[styles.exportButton, { borderColor: theme.border, opacity: filteredSlabCustomers.length === 0 ? 0.5 : 1 }]}>
              {isExportingSlab ? <ActivityIndicator size="small" /> : <ThemedText type="small">CSV</ThemedText>}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetScroll}>
            {slabCustomers === null ? (
              <ActivityIndicator style={styles.spinner} />
            ) : filteredSlabCustomers.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {slabSearch.trim() ? `No customers match "${slabSearch}".` : 'No customers in this slab.'}
              </ThemedText>
            ) : (
              filteredSlabCustomers.map((c) => (
                <ThemedView key={c.id} type="backgroundElement" style={styles.row}>
                  <ThemedText type="smallBold">{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{c.phone}</ThemedText>
                  <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(c.totalSpent)}</ThemedText>
                  {c.vehicles.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {c.vehicles.map((v) => [v.make, v.model, v.year].filter(Boolean).join(' ') || 'Vehicle').join(', ')}
                    </ThemedText>
                  )}
                  {c.purchasedItems.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>Purchased: {c.purchasedItems.join(', ')}</ThemedText>
                  )}
                </ThemedView>
              ))
            )}
          </ScrollView>
        </ThemedView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Layout.cardGap },
  card: { width: '47%', minHeight: Layout.minTouchTarget, padding: Spacing.three, gap: Spacing.one },
  tabScroll: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.one, flexDirection: 'row' },
  tabChip: { paddingHorizontal: Spacing.three, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.one },
  tabLabelActive: { color: '#ffffff', fontWeight: '600' },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  flex1: { flex: 1 },
  tabularNums: { fontVariant: ['tabular-nums'] },
  periodChip: { paddingHorizontal: Spacing.three, height: 36, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.one },
  tabScrollInline: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginBottom: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  overdueBadge: { paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: 999 },
  sectionTitle: { marginBottom: Spacing.one },
  slabCard: { width: '47%' },
  slabCardInner: { minHeight: Layout.minTouchTarget, padding: Spacing.three, gap: Spacing.one, borderRadius: Spacing.three },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetToolbar: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, paddingBottom: 0 },
  sheetScroll: { padding: Spacing.three, gap: Spacing.two },
  input: { height: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  exportButton: { height: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
