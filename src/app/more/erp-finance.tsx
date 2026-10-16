import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchErpFinanceCustomers, fetchErpFinanceDaily, fetchErpFinanceMonthlyBreakdown, fetchErpFinanceOrders,
  fetchErpFinanceOverview, fetchErpFinanceSalesPerformance, fetchErpFinanceServices, getErrorMessage,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  ErpFinanceCustomers, ErpFinanceDailyPoint, ErpFinanceEmployeePerformance, ErpFinanceMonthlyBreakdown,
  ErpFinanceOrder, ErpFinanceOverview, ErpFinanceServices,
} from '@/types/api';

// canAccess=requireRoles('OWNER','STORE_MANAGER','ACCOUNTING') — a static
// role gate applied to every route in this file via a shared `canAccess`
// const near the top (backend/src/routes/erp-finance.ts, re-verified
// 2026-09-28 against origin/main — unchanged), unlike the dynamic per-user
// gates on CRM/Invoices/Legal. The dashboard's OWN page adds a narrower
// client-side redirect (OWNER/STORE_MANAGER only, ACCOUNTING gets bounced
// even though the backend allows it) — mobile intentionally follows the
// backend's real gate here, same precedent as every other screen in this
// project, not the dashboard's stricter client-only check.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'ACCOUNTING'];
const PAGE_SIZE = 20;

const DATE_PRESETS = ['month', 'quarter', 'year', 'pick', 'custom'] as const;
const DATE_PRESET_LABELS: Record<string, string> = {
  month: 'This Month', quarter: 'This Quarter', year: 'This Year', pick: 'By Month', custom: 'Custom',
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_COLORS: Record<string, string> = {
  PAID: '#22c55e', COMPLETED: '#22c55e', PARTIAL: '#e8a828', PENDING: '#8A8A8E', CANCELLED: '#e06868',
};

function formatCurrency(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetToDateRange(preset: string, pickMonth: number, pickYear: number, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  if (preset === 'custom') return { from: customFrom, to: customTo };
  if (preset === 'pick') {
    const from = new Date(pickYear, pickMonth - 1, 1);
    const to = new Date(pickYear, pickMonth, 0);
    return { from: isoDate(from), to: isoDate(to) };
  }
  if (preset === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    return { from: isoDate(new Date(now.getFullYear(), q * 3, 1)), to: isoDate(now) };
  }
  if (preset === 'year') return { from: isoDate(new Date(now.getFullYear(), 0, 1)), to: isoDate(now) };
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) };
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

// Exact dashboard CSV headers/filename (Source = Historical/Live, one more
// column than the on-screen table drops — Margin — since that's a derived
// display-only figure the dashboard's own export also omits).
async function exportOrdersCsv(orders: ErpFinanceOrder[], from: string, to: string) {
  const headers = ['Date', 'Order Id', 'Customer', 'Car Model', 'Item', 'Qty', 'Unit Price', 'Order Value', 'Profit', 'Status', 'Sold By', 'Remarks', 'Source'];
  const rows = orders.map((o) => [
    formatDate(o.date), o.orderNumber ?? o.id, o.customerName ?? '', o.vehicleModel ?? '',
    o.lineItems.join('; '), o.qty ?? '', o.unitPrice ?? '', o.amount ?? '', o.profit ?? '',
    o.status ?? '', o.soldBy ?? '', o.remarks ?? '', o.isHistorical ? 'Historical' : 'Live',
  ]);
  await shareCsv(`orders_${from}_${to}.csv`, [headers, ...rows]);
}

export default function ErpFinanceScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const now = new Date();

  const [preset, setPreset] = useState<typeof DATE_PRESETS[number]>('month');
  const [pickMonth, setPickMonth] = useState(now.getMonth() + 1);
  const [pickYear, setPickYear] = useState(now.getFullYear());
  const [customFrom, setCustomFrom] = useState(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [customTo, setCustomTo] = useState(isoDate(now));
  const { from: dateFrom, to: dateTo } = presetToDateRange(preset, pickMonth, pickYear, customFrom, customTo);

  const [overview, setOverview] = useState<ErpFinanceOverview | null>(null);
  const [orders, setOrders] = useState<ErpFinanceOrder[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [groupByOrder, setGroupByOrder] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sales Performance / Services / Top Customers — fetched alongside
  // overview/orders on every load/filter change, same as the dashboard's
  // page-level useEffect (no separate lazy tab-load on this page).
  const [salesPerformance, setSalesPerformance] = useState<ErpFinanceEmployeePerformance[] | null>(null);
  const [services, setServices] = useState<ErpFinanceServices | null>(null);
  const [servicesTab, setServicesTab] = useState<'byRevenue' | 'byVolume'>('byRevenue');
  const [customersData, setCustomersData] = useState<ErpFinanceCustomers | null>(null);

  // Daily drill-down — tap a month in the monthly revenue/profit list to
  // expand a per-day breakdown, matching the dashboard's chart-click
  // handleBarClick/GET /erp/finance/daily behavior (list tap substitutes for
  // a chart click, same underlying data).
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const [drillDays, setDrillDays] = useState<ErpFinanceDailyPoint[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Monthly View — lazy-loaded only when the toggle is opened, matching the
  // dashboard's own showMonthlyBreakdown/loadMonthlyBreakdown pattern (not
  // fetched alongside the rest of the page on every filter change).
  const [showMonthlyBreakdown, setShowMonthlyBreakdown] = useState(false);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<ErpFinanceMonthlyBreakdown | null>(null);
  const [monthlyBreakdownLoading, setMonthlyBreakdownLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [ov, ordersResp, sales, svc, custs] = await Promise.all([
        fetchErpFinanceOverview(dateFrom, dateTo),
        fetchErpFinanceOrders({ from: dateFrom, to: dateTo, page: 1, limit: PAGE_SIZE, search: search.trim() || undefined }),
        fetchErpFinanceSalesPerformance(dateFrom, dateTo),
        fetchErpFinanceServices(dateFrom, dateTo),
        fetchErpFinanceCustomers(dateFrom, dateTo),
      ]);
      setOverview(ov);
      setOrders(ordersResp.orders);
      setTotal(ordersResp.total);
      setPage(1);
      setSalesPerformance(sales);
      setServices(svc);
      setCustomersData(custs);
      setDrillMonth(null);
      setDrillDays(null);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load ERP Finance.'));
    }
  }, [isAuthorized, dateFrom, dateTo, search]);

  const onToggleDrillMonth = async (yearMonth: string) => {
    if (drillMonth === yearMonth) { setDrillMonth(null); return; }
    setDrillMonth(yearMonth);
    setDrillLoading(true);
    try {
      const [y, m] = yearMonth.split('-');
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const from = `${y}-${m}-01`;
      const to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      setDrillDays(await fetchErpFinanceDaily(from, to));
    } catch {
      setDrillDays([]);
    } finally {
      setDrillLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / filter change
    load();
  }, [load]);

  const loadMonthlyBreakdown = useCallback(async () => {
    setMonthlyBreakdownLoading(true);
    try {
      const data = await fetchErpFinanceMonthlyBreakdown(dateFrom, dateTo);
      setMonthlyBreakdown(data);
    } catch {
      setMonthlyBreakdown({ employees: [], months: [] });
    } finally {
      setMonthlyBreakdownLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (showMonthlyBreakdown) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on toggle-open / filter change
      loadMonthlyBreakdown();
    }
  }, [showMonthlyBreakdown, loadMonthlyBreakdown]);

  // 400ms debounce, matching dashboard's search box exactly.
  const onChangeSearchInput = (t: string) => {
    setSearchInput(t);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setSearch(t), 400);
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const onLoadMore = async () => {
    if (isLoadingMore || !orders || orders.length >= total) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const resp = await fetchErpFinanceOrders({ from: dateFrom, to: dateTo, page: nextPage, limit: PAGE_SIZE, search: search.trim() || undefined });
      setOrders((prev) => [...(prev ?? []), ...resp.orders]);
      setPage(nextPage);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load more orders.'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  // "By Order" groups line items by orderNumber (falling back to id) —
  // client-side dedup, matching dashboard's exact grouping logic.
  const displayedOrders = (() => {
    if (!orders) return orders;
    if (!groupByOrder) return orders;
    const seen = new Set<string>();
    return orders.filter((o) => {
      const key = o.orderNumber || o.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const onExportPage = async () => {
    if (!displayedOrders || displayedOrders.length === 0) return;
    setIsExporting(true);
    try {
      await exportOrdersCsv(displayedOrders, dateFrom, dateTo);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Export failed.'));
    } finally {
      setIsExporting(false);
    }
  };

  const onExportAll = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const resp = await fetchErpFinanceOrders({ from: dateFrom, to: dateTo, page: 1, limit: 2000, search: search.trim() || undefined });
      await exportOrdersCsv(resp.orders, dateFrom, dateTo);
    } catch {
      setError('Export failed — try a shorter date range');
    } finally {
      setIsExporting(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          ERP Finance is only available to Owner, Store Manager, or Accounting accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'ERP Finance' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) onLoadMore();
        }}
        scrollEventThrottle={200}>
        <ThemedText type="smallBold">Date Range</ThemedText>
        <View style={styles.chipRow}>
          {DATE_PRESETS.map((p) => (
            <Pressable key={p} onPress={() => setPreset(p)} style={[styles.chip, { backgroundColor: preset === p ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={preset === p ? styles.chipLabelActive : undefined}>{DATE_PRESET_LABELS[p]}</ThemedText>
            </Pressable>
          ))}
        </View>
        {preset === 'pick' && (
          <View style={styles.pickRow}>
            <View style={styles.chipRow}>
              {MONTH_NAMES.map((m, i) => (
                (pickYear < now.getFullYear() || i <= now.getMonth()) && (
                  <Pressable key={m} onPress={() => setPickMonth(i + 1)} style={[styles.chip, { backgroundColor: pickMonth === i + 1 ? theme.primary : theme.backgroundElement }]}>
                    <ThemedText type="small" style={pickMonth === i + 1 ? styles.chipLabelActive : undefined}>{m.slice(0, 3)}</ThemedText>
                  </Pressable>
                )
              ))}
            </View>
            <View style={styles.chipRow}>
              {Array.from({ length: now.getFullYear() - 2025 + 1 }, (_, i) => 2025 + i).map((y) => (
                <Pressable key={y} onPress={() => setPickYear(y)} style={[styles.chip, { backgroundColor: pickYear === y ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={pickYear === y ? styles.chipLabelActive : undefined}>{y}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {preset === 'custom' && (
          <View style={styles.pickRow}>
            <TextInput value={customFrom} onChangeText={setCustomFrom} placeholder="From YYYY-MM-DD" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
            <TextInput value={customTo} onChangeText={setCustomTo} placeholder="To YYYY-MM-DD" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          </View>
        )}
        <ThemedText type="small" themeColor="textSecondary" style={styles.rangeLabel}>{dateFrom} → {dateTo}</ThemedText>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {overview === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <>
            <View style={styles.kpiGrid}>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Revenue Collected</ThemedText>
                <ThemedText type="subtitle">{formatCurrency(overview.kpis.totalRevenue)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Total Profit</ThemedText>
                <ThemedText type="subtitle">{formatCurrency(overview.kpis.totalProfit)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Av. Order Value</ThemedText>
                <ThemedText type="subtitle">{overview.kpis.totalOrders === 0 ? 'N/A' : formatCurrency(overview.kpis.avgOrderValue)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Profit per Order</ThemedText>
                <ThemedText type="subtitle">{overview.kpis.totalOrders === 0 ? 'N/A' : formatCurrency(overview.kpis.profitPerOrder)}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Total No of Orders</ThemedText>
                <ThemedText type="subtitle">{overview.kpis.totalOrders}</ThemedText>
              </GlassCard>
              <GlassCard style={styles.kpiCard}>
                <ThemedText type="small" themeColor="textSecondary">Month on Month Growth</ThemedText>
                <ThemedText type="subtitle" style={{ color: overview.kpis.momGrowth >= 0 ? '#167A48' : '#B83030' }}>
                  {overview.kpis.momGrowth >= 0 ? '+' : ''}
                  {overview.kpis.momGrowth.toFixed(1)}%
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">vs previous period</ThemedText>
              </GlassCard>
            </View>

            {overview.chart.length > 0 && (
              <>
                <ThemedText type="smallBold" style={styles.sectionTitle}>Monthly revenue & profit</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Tap a month for the day-by-day breakdown</ThemedText>
                {overview.chart.map((point) => (
                  <View key={point.yearMonth}>
                    <Pressable onPress={() => onToggleDrillMonth(point.yearMonth)}>
                      <ThemedView type="backgroundElement" style={styles.chartRow}>
                        <ThemedText type="small">{point.month}</ThemedText>
                        <View style={styles.chartValues}>
                          <ThemedText type="small" themeColor="textSecondary">Rev {formatCurrency(point.revenue)}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">Profit {formatCurrency(point.profit)}</ThemedText>
                        </View>
                      </ThemedView>
                    </Pressable>
                    {drillMonth === point.yearMonth && (
                      <View style={[styles.monthlyCard, { borderColor: theme.border }]}>
                        {drillLoading ? (
                          <ActivityIndicator style={styles.spinner} />
                        ) : !drillDays || drillDays.length === 0 ? (
                          <ThemedText type="small" themeColor="textSecondary">No daily data for this month.</ThemedText>
                        ) : (
                          drillDays.map((d) => (
                            <View key={d.date} style={styles.tableRow}>
                              <ThemedText type="small" style={styles.flex1}>{formatDate(d.date)}</ThemedText>
                              <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(d.revenue)}</ThemedText>
                              <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{formatCurrency(d.profit)}</ThemedText>
                              <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{d.orders} orders</ThemedText>
                            </View>
                          ))
                        )}
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <View style={styles.ordersHeaderRow}>
          <ThemedText type="smallBold">Orders {total > 0 ? `(${total})` : ''}</ThemedText>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setGroupByOrder(true)} style={[styles.chip, { backgroundColor: groupByOrder ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={groupByOrder ? styles.chipLabelActive : undefined}>By Order</ThemedText>
            </Pressable>
            <Pressable onPress={() => setGroupByOrder(false)} style={[styles.chip, { backgroundColor: !groupByOrder ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={!groupByOrder ? styles.chipLabelActive : undefined}>By Line Item</ThemedText>
            </Pressable>
          </View>
        </View>
        <TextInput
          value={searchInput}
          onChangeText={onChangeSearchInput}
          placeholder="Search customer or order #"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <View style={styles.exportRow}>
          <Pressable onPress={onExportPage} disabled={isExporting || !displayedOrders || displayedOrders.length === 0} style={[styles.exportButton, { borderColor: theme.border }]}>
            <ThemedText type="small">Export Page</ThemedText>
          </Pressable>
          <Pressable onPress={onExportAll} disabled={isExporting} style={[styles.exportButton, { borderColor: theme.border }]}>
            {isExporting ? <ActivityIndicator size="small" /> : <ThemedText type="small">Export All</ThemedText>}
          </Pressable>
        </View>

        {displayedOrders === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : displayedOrders.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No orders found for this period.</ThemedText>
        ) : (
          displayedOrders.map((o) => {
            const margin = o.amount ? ((o.profit ?? 0) / o.amount) * 100 : null;
            const marginColor = margin == null ? theme.textSecondary : margin > 40 ? '#22c55e' : margin > 20 ? '#e8a828' : '#e06868';
            const statusColor = o.status ? (STATUS_COLORS[o.status.toUpperCase()] ?? theme.textSecondary) : theme.textSecondary;
            const unitPriceWarning = o.unitPrice != null && o.amount != null && o.unitPrice > o.amount;
            return (
              <ThemedView key={o.id} type="backgroundElement" style={styles.orderRow}>
                <View style={styles.orderTop}>
                  <View style={styles.badgeRow}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.orderCustomer}>{o.customerName ?? ''}</ThemedText>
                    {o.isHistorical && (
                      <View style={styles.histBadge}><ThemedText type="small" style={styles.histBadgeLabel}>hist</ThemedText></View>
                    )}
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">{formatDate(o.date)}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {o.orderNumber ?? o.id} · {o.vehicleModel ?? ''} {o.lineItems.length > 0 ? `· ${o.lineItems.join(', ')}` : ''}
                </ThemedText>
                <View style={styles.orderStatsRow}>
                  <ThemedText type="small" themeColor="textSecondary">Qty {o.qty ?? '—'}</ThemedText>
                  <ThemedText type="small" style={unitPriceWarning ? styles.error : undefined} themeColor={unitPriceWarning ? undefined : 'textSecondary'}>
                    Unit {o.unitPrice != null ? formatCurrency(o.unitPrice) : '—'}{unitPriceWarning ? ' ⚠' : ''}
                  </ThemedText>
                  <ThemedText type="small">{o.amount != null ? formatCurrency(o.amount) : '—'}</ThemedText>
                  {margin != null && <ThemedText type="small" style={{ color: marginColor }}>{margin.toFixed(1)}%</ThemedText>}
                </View>
                <View style={styles.orderBottom}>
                  <ThemedText type="small" style={{ color: statusColor }}>{o.status ?? '—'}</ThemedText>
                  {o.soldBy && <ThemedText type="small" themeColor="textSecondary">Sold by {o.soldBy}</ThemedText>}
                </View>
                {o.remarks && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{o.remarks}</ThemedText>}
              </ThemedView>
            );
          })
        )}
        {isLoadingMore && <ActivityIndicator style={styles.spinner} />}

        <View style={styles.ordersHeaderRow}>
          <ThemedText type="smallBold" style={styles.sectionTitle}>Sales Performance</ThemedText>
          <Pressable onPress={() => setShowMonthlyBreakdown((v) => !v)} style={[styles.chip, { backgroundColor: showMonthlyBreakdown ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={showMonthlyBreakdown ? styles.chipLabelActive : undefined}>Monthly View</ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary">Order Value and Profit by employee</ThemedText>
        {salesPerformance === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : salesPerformance.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No data</ThemedText>
        ) : (
          [...salesPerformance].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map((e) => (
            <View key={e.name} style={styles.tableRow}>
              <View style={styles.flex1}>
                <ThemedText type="small" numberOfLines={1}>{e.name}</ThemedText>
                {e.designation && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{e.designation}</ThemedText>}
              </View>
              <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(e.revenue)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{formatCurrency(e.profit)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{e.orderCount}</ThemedText>
            </View>
          ))
        )}

        {showMonthlyBreakdown && (
          <View style={[styles.monthlyCard, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>Monthly Revenue by Employee</ThemedText>
            {monthlyBreakdownLoading ? (
              <ActivityIndicator style={styles.spinner} />
            ) : !monthlyBreakdown || monthlyBreakdown.employees.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No data for selected period</ThemedText>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={styles.monthlyRow}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.monthlyEmployeeCell}>Employee</ThemedText>
                    {monthlyBreakdown.months.map((m) => (
                      <ThemedText key={m} type="small" themeColor="textSecondary" style={styles.monthlyCell}>
                        {MONTH_NAMES[Number(m.split('-')[1]) - 1].slice(0, 3)} &apos;{m.split('-')[0].slice(2)}
                      </ThemedText>
                    ))}
                    <ThemedText type="small" themeColor="textSecondary" style={styles.monthlyCell}>Total</ThemedText>
                  </View>
                  {monthlyBreakdown.employees.map((emp, i) => (
                    <View key={i} style={styles.monthlyRow}>
                      <ThemedText type="small" numberOfLines={1} style={styles.monthlyEmployeeCell}>{emp.name}</ThemedText>
                      {emp.monthly.map((m, j) => (
                        <ThemedText key={j} type="small" themeColor={m.revenue > 0 ? undefined : 'textSecondary'} style={[styles.tabularNums, styles.monthlyCell]}>
                          {m.revenue > 0 ? `₹${Math.round(m.revenue / 1000)}k` : '—'}
                        </ThemedText>
                      ))}
                      <ThemedText type="small" style={[styles.tabularNums, styles.monthlyCell, { color: theme.primary, fontWeight: '700' }]}>
                        ₹{(emp.total / 100000).toFixed(1)}L
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}

        <View style={styles.ordersHeaderRow}>
          <ThemedText type="smallBold">Services</ThemedText>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setServicesTab('byRevenue')} style={[styles.chip, { backgroundColor: servicesTab === 'byRevenue' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={servicesTab === 'byRevenue' ? styles.chipLabelActive : undefined}>By Order Value</ThemedText>
            </Pressable>
            <Pressable onPress={() => setServicesTab('byVolume')} style={[styles.chip, { backgroundColor: servicesTab === 'byVolume' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={servicesTab === 'byVolume' ? styles.chipLabelActive : undefined}>By Volume</ThemedText>
            </Pressable>
          </View>
        </View>
        {services === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (services[servicesTab]?.length ?? 0) === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No data</ThemedText>
        ) : (
          services[servicesTab].map((s) => (
            <View key={s.service} style={styles.tableRow}>
              <ThemedText type="small" style={styles.flex1} numberOfLines={1}>{s.service}</ThemedText>
              <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(s.revenue)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                {servicesTab === 'byRevenue' ? `${s.orderCount ?? 0} orders` : `${s.volume ?? 0} units`}
              </ThemedText>
            </View>
          ))
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>Top Customers</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Ranked by total spend in selected period</ThemedText>
        {customersData === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : customersData.customers.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No customer data for this period.</ThemedText>
        ) : (
          <>
            {customersData.customers.map((c, i) => (
              <View key={`${c.name}-${i}`} style={styles.tableRow}>
                <ThemedText type="small" style={i < 3 ? { color: theme.primary, fontWeight: '700' } : undefined}>{i + 1}</ThemedText>
                <View style={styles.flex1}>
                  <ThemedText type="small" numberOfLines={1}>{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{c.phone ?? '—'}</ThemedText>
                </View>
                <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(c.totalSpend)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{c.orderCount}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{formatDate(c.lastVisit)}</ThemedText>
              </View>
            ))}
            {customersData.walkInCount > 0 && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.walkInNote}>
                ℹ {customersData.walkInCount} Walk-in line items excluded from Top Customers list.
              </ThemedText>
            )}
          </>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.historicalNotice}>
          13,530 historical line items (Jan 2025 – Jul 2026) imported from Excel records and merged across all sections. Historical rows are tagged [hist] in the Orders table. Profit data available for ~32% of line items (stored per service row).
        </ThemedText>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030' },
  spinner: { marginTop: Spacing.three },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  kpiCard: { width: '47%' },
  sectionTitle: { marginTop: Spacing.two },
  chartRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.three, padding: Spacing.three },
  chartValues: { flexDirection: 'row', gap: Spacing.two },
  orderRow: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  orderCustomer: { flex: 1 },
  orderBottom: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  historicalTag: { fontStyle: 'italic' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  pickRow: { gap: Spacing.two, marginTop: Spacing.one },
  input: { height: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  rangeLabel: { marginTop: Spacing.half },
  ordersHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  exportRow: { flexDirection: 'row', gap: Spacing.two },
  exportButton: { flex: 1, height: 40, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flex: 1 },
  histBadge: { backgroundColor: 'rgba(232,168,40,0.15)', borderRadius: 4, paddingHorizontal: Spacing.one, paddingVertical: 1 },
  histBadgeLabel: { color: '#e8a828', fontSize: 10, fontWeight: '700' },
  orderStatsRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  historicalNotice: { marginTop: Spacing.three, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(127,127,127,0.3)', borderRadius: Spacing.two, padding: Spacing.two },
  flex1: { flex: 1 },
  tabularNums: { fontVariant: ['tabular-nums'] },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  walkInNote: { marginTop: Spacing.one },
  monthlyCard: { borderWidth: 1, borderRadius: Spacing.two, padding: Spacing.two },
  monthlyRow: { flexDirection: 'row', paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  monthlyEmployeeCell: { width: 110 },
  monthlyCell: { width: 80, textAlign: 'right' },
});
