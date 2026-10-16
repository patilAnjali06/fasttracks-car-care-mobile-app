import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { fetchDashboardOverview, fetchDashboardRecentActivity, fetchMyStaffRemarks, fetchOnLeave, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { DashboardOverview, DashboardRecentActivityItem, MyRemark, OnLeaveEntry } from '@/types/api';

// requireOwner (backend/src/routes/dashboard.ts) gates every /dashboard/*
// route this screen calls for OWNER — a static single-role check. Read-only
// KPI summary — /dashboard/overview is the single-call aggregate;
// recent-activity supplements it with a feed. today-snapshot and
// revenue-by-employee cover overlapping ground with overview's own jobs/
// attendance/revenue blocks, so this screen sticks to overview +
// recent-activity for a focused mobile summary rather than porting all four
// endpoints as separate sections.
//
// CORRECTED 2026-09-28 (re-verification sweep): non-OWNER roles used to see
// a blocking "Owner only" message here. The dashboard's own /dashboard
// route in fact serves every role — non-owners get a "Welcome" screen
// (quick-action cards + OnLeaveWidget + MyRemarksSection), not a 403.
// Added the same for mobile below (WelcomeScreen).
const VIEW_ROLES = ['OWNER'];
const LEAVE_APPROVER_ROLES = ['OWNER', 'STORE_MANAGER', 'HR'];

function formatCurrency(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' ' +
    new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export default function OverviewScreen() {
  const { user } = useAuth();
  const isOwner = VIEW_ROLES.includes(user?.role ?? '');
  if (!isOwner) return <WelcomeScreen />;
  return <OwnerOverviewScreen />;
}

// Non-owner landing screen — quick-action cards, On Leave widget (approver
// roles only), and a read-only feed of the caller's own remarks. Mirrors
// the dashboard's non-owner branch of DashboardOverviewPage.
function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canAddEntry = ['STORE_MANAGER', 'SALES'].includes(role);
  const isAccountingOrCashier = role === 'ACCOUNTING' || role === 'CASHIER';
  const isLeaveApprover = LEAVE_APPROVER_ROLES.includes(role);

  const [onLeave, setOnLeave] = useState<OnLeaveEntry[] | null>(null);
  const [remarks, setRemarks] = useState<MyRemark[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    const tasks: Promise<void>[] = [
      fetchMyStaffRemarks().then(setRemarks).catch(() => setRemarks([])),
    ];
    if (isLeaveApprover) tasks.push(fetchOnLeave().then(setOnLeave).catch(() => setOnLeave([])));
    await Promise.all(tasks);
  }, [isLeaveApprover]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const today = (onLeave ?? []).filter((e) => e.isToday);
  const upcoming = (onLeave ?? []).filter((e) => !e.isToday);
  const dateLabel = (e: OnLeaveEntry) => {
    const s = new Date(e.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const en = new Date(e.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return s === en ? s : `${s} – ${en}`;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Overview' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="title">Welcome, {user?.name?.split(' ')[0]}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">Here&apos;s your dashboard for today.</ThemedText>

        <View style={styles.grid}>
          {canAddEntry && (
            <Pressable onPress={() => router.push('/more/new-entry' as never)} style={styles.flex1min}>
              <GlassCard style={styles.quickActionCard}>
                <ThemedText type="smallBold">New Entry</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Add customer &amp; job</ThemedText>
              </GlassCard>
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/more/attendance' as never)} style={styles.flex1min}>
            <GlassCard style={styles.quickActionCard}>
              <ThemedText type="smallBold">Attendance</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Clock in/out &amp; leaves</ThemedText>
            </GlassCard>
          </Pressable>
          {isAccountingOrCashier && (
            <>
              <Pressable onPress={() => router.push('/more/finance-approvals' as never)} style={styles.flex1min}>
                <GlassCard style={styles.quickActionCard}>
                  <ThemedText type="smallBold">Finance Approvals</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Advances</ThemedText>
                </GlassCard>
              </Pressable>
              <Pressable onPress={() => router.push('/more/payroll' as never)} style={styles.flex1min}>
                <GlassCard style={styles.quickActionCard}>
                  <ThemedText type="smallBold">Payroll</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Monthly salary &amp; deductions</ThemedText>
                </GlassCard>
              </Pressable>
            </>
          )}
        </View>

        {isLeaveApprover && (
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">On Leave</ThemedText>
            {onLeave === null ? (
              <ActivityIndicator />
            ) : onLeave.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No one on leave right now.</ThemedText>
            ) : (
              <>
                {today.map((e) => (
                  <View key={e.id} style={styles.rowBetween}>
                    <ThemedText type="small">{e.user.name} · {e.leaveType.toLowerCase()}{e.isHalfDay ? ' · Half Day' : ''}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{dateLabel(e)}</ThemedText>
                  </View>
                ))}
                {upcoming.length > 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Upcoming</ThemedText>}
                {upcoming.map((e) => (
                  <View key={e.id} style={styles.rowBetween}>
                    <ThemedText type="small">{e.user.name} · {e.leaveType.toLowerCase()}{e.isHalfDay ? ' · Half Day' : ''}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{dateLabel(e)}</ThemedText>
                  </View>
                ))}
              </>
            )}
          </ThemedView>
        )}

        {remarks && remarks.length > 0 && (
          <View style={styles.section}>
            <ThemedText type="smallBold">My Remarks</ThemedText>
            {remarks.map((r) => (
              <ThemedView key={r.id} type="backgroundElement" style={styles.remarkCard}>
                <View style={styles.rowBetween}>
                  <ThemedText type="small" style={{ color: r.rating === 'POSITIVE' ? '#167A48' : '#B83030' }}>
                    {r.rating === 'POSITIVE' ? 'Positive' : 'Negative'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{r.category}</ThemedText>
                </View>
                <ThemedText type="small">{r.note}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </ThemedText>
              </ThemedView>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

function OwnerOverviewScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');

  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [activity, setActivity] = useState<DashboardRecentActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [ov, act] = await Promise.all([fetchDashboardOverview(), fetchDashboardRecentActivity(10)]);
      setOverview(ov);
      setActivity(act);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the overview.'));
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
        <ThemedText themeColor="textSecondary">Overview is only available to Owner accounts.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Overview' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {overview === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.grid}>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Present</ThemedText>
              <ThemedText type="smallBold">
                {overview.attendance.present} / {overview.attendance.total}
              </ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Late Today</ThemedText>
              <ThemedText type="smallBold">{overview.attendance.late}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Absent</ThemedText>
              <ThemedText type="smallBold">{overview.attendance.absent}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Open Jobs</ThemedText>
              <ThemedText type="smallBold">{overview.jobs.open}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Today&apos;s Collections</ThemedText>
              <ThemedText type="smallBold">{formatCurrency(overview.revenue.todayCollections)}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Month Revenue</ThemedText>
              <ThemedText type="smallBold">{formatCurrency(overview.revenue.monthRevenue)}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Outstanding</ThemedText>
              <ThemedText type="smallBold">{formatCurrency(overview.revenue.outstanding)}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Invoices This Month</ThemedText>
              <ThemedText type="smallBold">{overview.revenue.monthInvoiceCount}</ThemedText>
            </GlassCard>
          </View>

          {overview.jobs.byEmployee.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">Open Jobs by Employee</ThemedText>
              {overview.jobs.byEmployee.map((e) => (
                <View key={e.id} style={styles.rowBetween}>
                  <ThemedText type="small">{e.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{e.count}</ThemedText>
                </View>
              ))}
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">Recent Activity</ThemedText>
            {activity === null ? (
              <ActivityIndicator />
            ) : activity.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No recent activity.</ThemedText>
            ) : (
              activity.map((a) => (
                <View key={a.id} style={styles.activityRow}>
                  <ThemedText type="small">
                    <ThemedText type="smallBold">{a.staffName}</ThemedText> {a.action} for{' '}
                    <ThemedText type="smallBold">{a.customerName}</ThemedText> ({a.vehicleNumber})
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{formatDate(a.createdAt)}</ThemedText>
                </View>
              ))
            )}
          </ThemedView>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Layout.cardGap },
  card: { width: '47%', minHeight: Layout.minTouchTarget, padding: Spacing.three, gap: Spacing.one },
  section: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 36 },
  activityRow: { gap: 2, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
  flex1min: { width: '47%' },
  quickActionCard: { minHeight: Layout.minTouchTarget, padding: Spacing.three, gap: Spacing.one },
  fieldLabel: { marginTop: Spacing.one },
  remarkCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
});
