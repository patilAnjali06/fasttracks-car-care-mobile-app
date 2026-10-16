import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AdminAttendance } from '@/components/attendance/admin-attendance';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { attendanceStatusColor, attendanceStatusLabel } from '@/constants/attendance-status';
import { MaxContentWidth, Spacing, Layout, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchMyLateRecords, fetchMyMonthlyAttendance, fetchMyWarnings, fetchTodayAttendance, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AttendanceRecord, LateRecord, WarningRecord } from '@/types/api';

// Matches the dashboard's ALL_TAB_ROLES exactly (attendance/page.tsx) --
// these roles get a My Attendance / All Employees tab switch; everyone
// else only ever sees their own attendance (StaffAttendanceScreen below).
const ALL_TAB_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'TECH_TEAM', 'ACCOUNTING', 'CASHIER'];

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Full read-only "My Attendance" module — today's status, month-by-month
 * history, late records, and warnings. Deliberately self-scoped only; no
 * edit/override/pardon action is exposed here, and no manager admin view.
 *
 * All four endpoints this screen calls (attendance/today, /monthly,
 * /late-records, /warnings) are gated by verifyToken alone server-side
 * (backend/src/routes/attendance.ts, verified 2026-09-20) — any authenticated
 * user, self-scoped by the JWT userId when no manager-only ?userId= override
 * is passed (which this screen never does). This is distinct from
 * /attendance/register and the edit-log/override/pardon routes, which
 * reference the non-existent `(prisma as any).attendanceEditLog` Prisma
 * model and would 500 in production — none of those are called here.
 */
const LEGEND_ITEMS: { status: AttendanceRecord['status']; label: string; color: string }[] = [
  { status: 'PRESENT', label: 'Present', color: attendanceStatusColor('PRESENT') },
  { status: 'LATE', label: 'Late', color: attendanceStatusColor('LATE') },
  { status: 'HALF_DAY', label: 'Half Day', color: attendanceStatusColor('HALF_DAY') },
  { status: 'ABSENT', label: 'Absent', color: attendanceStatusColor('ABSENT') },
  { status: 'LEAVE', label: 'Leave', color: attendanceStatusColor('LEAVE') },
];

function StaffAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [today, setToday] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[] | null>(null);
  const [lateRecords, setLateRecords] = useState<LateRecord[] | null>(null);
  const [warnings, setWarnings] = useState<WarningRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const month = target.getMonth() + 1;
    const year = target.getFullYear();

    const [todayResult, historyResult, lateResult, warningResult] = await Promise.allSettled([
      fetchTodayAttendance(),
      fetchMyMonthlyAttendance(month, year, user?.id),
      fetchMyLateRecords(month, year),
      fetchMyWarnings(),
    ]);

    if (todayResult.status === 'fulfilled') {
      setToday(todayResult.value.find((r) => r.userId === user?.id) ?? todayResult.value[0] ?? null);
    } else if (monthOffset === 0) {
      setError(getErrorMessage(todayResult.reason, 'Could not load today’s attendance.'));
    }
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    else setHistory([]);
    if (lateResult.status === 'fulfilled') setLateRecords(lateResult.value);
    else setLateRecords([]);
    if (warningResult.status === 'fulfilled') setWarnings(warningResult.value);
    else setWarnings([]);
  }, [monthOffset, user?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const monthLabel = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1).toLocaleDateString(
    'en-IN',
    { month: 'long', year: 'numeric' }
  );

  return (
    <>
      <Stack.Screen options={{ title: 'My Attendance' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
        <GlassCard>
          <ThemedText type="smallBold">Attendance synced automatically</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
            Your attendance is recorded via the biometric device. Contact Rakesh Sir for any discrepancies.
          </ThemedText>
        </GlassCard>

        <View style={styles.legendRow}>
          {LEGEND_ITEMS.map((item) => (
            <View key={item.status} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
              <ThemedText type="small" themeColor="textSecondary">{item.label}</ThemedText>
            </View>
          ))}
        </View>

        {monthOffset === 0 && (
          <GlassCard>
            <ThemedText type="smallBold">Today</ThemedText>
            {today ? (
              <>
                <ThemedText type="subtitle" style={{ color: attendanceStatusColor(today.status), fontSize: 20 }}>
                  {attendanceStatusLabel(today.status)}
                </ThemedText>
                <View style={styles.timesRow}>
                  <ThemedText type="small" themeColor="textSecondary">In: {formatTime(today.clockIn)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Out: {formatTime(today.clockOut)}</ThemedText>
                </View>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">No record for today yet.</ThemedText>
            )}
          </GlassCard>
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <View style={styles.monthNav}>
          <ThemedText type="smallBold" onPress={() => setMonthOffset((m) => m - 1)} style={styles.navArrow}>
            ‹
          </ThemedText>
          <ThemedText type="smallBold">{monthLabel}</ThemedText>
          <ThemedText
            type="smallBold"
            onPress={() => monthOffset < 0 && setMonthOffset((m) => m + 1)}
            style={[styles.navArrow, monthOffset >= 0 && styles.navArrowDisabled]}>
            ›
          </ThemedText>
        </View>

        <ThemedText type="smallBold" style={styles.sectionTitle}>Punch Times</ThemedText>
        {history === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : history.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No attendance records this month.</ThemedText>
        ) : (
          history.map((r) => (
            <ThemedView key={r.id} type="backgroundElement" style={styles.row}>
              <ThemedText type="small">{formatDate(r.date)}</ThemedText>
              <View style={styles.rowRight}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatTime(r.clockIn)} – {formatTime(r.clockOut)}
                </ThemedText>
                <ThemedText type="smallBold" style={{ color: attendanceStatusColor(r.status) }}>
                  {attendanceStatusLabel(r.status)}
                </ThemedText>
              </View>
            </ThemedView>
          ))
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>Late arrivals this month</ThemedText>
        {lateRecords === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : lateRecords.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No late arrivals this month.</ThemedText>
        ) : (
          lateRecords.map((l) => (
            <ThemedView key={l.id} type="backgroundElement" style={styles.row}>
              <ThemedText type="small">{formatDate(l.date)}</ThemedText>
            </ThemedView>
          ))
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>Warnings</ThemedText>
        {warnings === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : warnings.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No warnings on file.</ThemedText>
        ) : (
          warnings.map((w) => (
            <ThemedView key={w.id} type="backgroundElement" style={styles.warningRow}>
              <ThemedText type="small">{w.reason}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{formatDate(w.issuedAt)}</ThemedText>
            </ThemedView>
          ))
        )}
      </ScrollView>
    </>
  );
}

// ── Tab switcher — mirrors the dashboard's TabbedAttendance exactly:
// OWNER doesn't punch, so gets All Employees only, no tab to switch away
// from; the other ALL_TAB_ROLES default to My Attendance with a tab to
// switch to All Employees. ─────────────────────────────────────────────
export default function AttendanceScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const canSeeAll = ALL_TAB_ROLES.includes(user?.role ?? '');
  const isOwner = user?.role === 'OWNER';
  const showMineTab = !isOwner;
  const defaultTab: 'mine' | 'all' = user?.role === 'ACCOUNTING' || user?.role === 'CASHIER' || isOwner ? 'all' : 'mine';

  const [tab, setTab] = useState<'mine' | 'all'>(showMineTab ? defaultTab : 'all');

  if (!canSeeAll) return <StaffAttendanceScreen />;

  return (
    <>
      <Stack.Screen options={{ title: 'Attendance' }} />
      <View style={[tabStyles.switcherWrap, { backgroundColor: theme.background, borderColor: theme.border }]}>
        {showMineTab && (
          <Pressable
            onPress={() => setTab('mine')}
            style={[tabStyles.tabButton, { backgroundColor: tab === 'mine' ? theme.backgroundElement : 'transparent' }]}>
            <ThemedText type="small" style={tab === 'mine' ? undefined : { color: theme.textSecondary }}>👤 My Attendance</ThemedText>
          </Pressable>
        )}
        <Pressable
          onPress={() => setTab('all')}
          style={[tabStyles.tabButton, { backgroundColor: tab === 'all' ? theme.backgroundElement : 'transparent' }]}>
          <ThemedText type="small" style={tab === 'all' ? undefined : { color: theme.textSecondary }}>👥 All Employees</ThemedText>
        </Pressable>
      </View>
      {tab === 'mine' ? <StaffAttendanceScreen /> : <AdminAttendance />}
    </>
  );
}

const tabStyles = StyleSheet.create({
  switcherWrap: {
    flexDirection: 'row', gap: Spacing.one, padding: Spacing.one, borderRadius: Radii.md, borderWidth: 1,
    alignSelf: 'flex-start', marginHorizontal: Layout.screenPaddingH, marginTop: Spacing.three, marginBottom: Spacing.two,
  },
  tabButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Radii.sm },
});

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  timesRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  error: { color: '#B83030' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginTop: Spacing.two },
  navArrow: { fontSize: 20, paddingHorizontal: Spacing.two },
  navArrowDisabled: { opacity: 0.3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  sectionTitle: { marginTop: Spacing.two },
  spinner: { marginTop: Spacing.two },
  warningRow: { borderRadius: Spacing.three, padding: Spacing.three, gap: 2 },
});
