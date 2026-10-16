import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  approveOvertime, fetchEmployees, fetchOvertimeRequests, getErrorMessage,
  rejectOvertime, setOvertimeActualHours,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import type { EmployeeListItem, PendingOvertimeRequest } from '@/types/api';

// Two different gates, matching the dashboard's own split exactly (frontend/
// src/app/(dashboard)/dashboard/overtime-approval/page.tsx):
//
// VIEW: dashboard's `isManager = role OWNER/STORE_MANAGER || hasPerm(
// 'overtime_approval')` — a per-employee-overridable tab-permission
// boolean (backend/src/lib/tabRegistry.ts roleDefaults: OWNER, STORE_MANAGER,
// HR, INVENTORY_MANAGER), read here via hasTab() the same way.
//
// ACT (approve/reject/actual-hours): backend's actual enforcement is
// requireManagerOrOwner = [OWNER, STORE_MANAGER, HR, ACCOUNTING, CASHIER]
// (backend/src/middleware/auth.ts:83) — a DIFFERENT array than the tab
// permission's role defaults (INVENTORY_MANAGER can view via the tab
// default but their approve/reject calls would 403 "Access denied."
// server-side; ACCOUNTING/CASHIER can act but aren't in the tab's role
// defaults unless individually overridden). This is a real, documented
// mismatch in the dashboard itself (tabRegistry.ts's own comments), not
// something to silently "fix" by unifying the two arrays — mobile
// replicates the same two independent gates so the two apps behave
// identically, including in the edge cases where they disagree.
//
// The underlying list fetch (GET /overtime, via fetchOvertimeRequests)
// itself has a THIRD, narrower gate: only OWNER/STORE_MANAGER get every
// employee's requests; any other role (including ACCOUNTING/CASHIER who
// CAN act) gets back only their own — same limitation the dashboard's
// own page.tsx has (it calls this exact endpoint too), not fixed here.
const ACT_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING', 'CASHIER'];

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Founder', STORE_MANAGER: 'Store Manager', SALES: 'Sales',
  TECHNICIAN: 'Technician', TECH_TEAM: 'Tech Team', SOCIAL_MEDIA: 'Social Media',
  STAFF: 'Staff', INVENTORY_MANAGER: 'Inventory Manager', ACCOUNTING: 'Accounting',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTs(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED';

export default function OvertimeApprovalScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { status: permStatus, hasTab } = usePermissions();
  const isAuthorized = user?.role === 'OWNER' || user?.role === 'STORE_MANAGER'
    || (permStatus === 'ready' && hasTab('overtime_approval'));
  const canAct = ACT_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<Tab>('PENDING');
  const [requests, setRequests] = useState<PendingOvertimeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actualHoursId, setActualHoursId] = useState<string | null>(null);
  const [actualHoursInput, setActualHoursInput] = useState('');

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [reqs, emps] = await Promise.all([
        fetchOvertimeRequests({ status: tab, userId: employeeFilter ?? undefined }),
        employees ? Promise.resolve(employees) : fetchEmployees(),
      ]);
      setRequests(reqs);
      setEmployees(emps);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load data.'));
    }
  }, [isAuthorized, tab, employeeFilter, employees]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / tab or filter change
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const onApprove = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await approveOvertime(id);
      setNotice('Request approved.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to approve.'));
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await rejectOvertime(id, rejectReason.trim() || undefined);
      setNotice('Request rejected.');
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to reject.'));
    } finally {
      setBusyId(null);
    }
  };

  const onSaveActualHours = async (id: string) => {
    const hours = Number(actualHoursInput);
    if (!hours || hours <= 0) {
      setError('Enter valid hours.');
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await setOvertimeActualHours(id, hours);
      setActualHoursId(null);
      setActualHoursInput('');
      setNotice('Actual hours saved. Overtime pay calculated.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to update.'));
    } finally {
      setBusyId(null);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">Access restricted to managers.</ThemedText>
      </ThemedView>
    );
  }

  const filterName = employeeFilter ? employees?.find((e) => e.id === employeeFilter)?.name : null;
  const pendingCount = tab === 'PENDING' ? (requests ?? []).length : null;
  const urgentCount = tab === 'PENDING' ? (requests ?? []).filter((r) => r.isUrgent).length : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Overtime Approval' }} />
      {(!!pendingCount || !!urgentCount) && (
        <View style={styles.countRow}>
          {!!pendingCount && (
            <View style={styles.pendingCountBadge}>
              <ThemedText type="small" style={styles.pendingCountLabel}>{pendingCount} pending</ThemedText>
            </View>
          )}
          {!!urgentCount && (
            <View style={styles.urgentCountBadge}>
              <ThemedText type="small" style={styles.urgentCountLabel}>{urgentCount} urgent</ThemedText>
            </View>
          )}
        </View>
      )}
      <View style={styles.tabRow}>
        {(['PENDING', 'APPROVED', 'REJECTED'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabChip, { backgroundColor: tab === t ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={tab === t ? styles.tabLabelActive : undefined}>{t.charAt(0) + t.slice(1).toLowerCase()}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => setShowFilter((v) => !v)} style={styles.filterToggle}>
        <ThemedText type="small" themeColor="textSecondary">
          {filterName ? `Filtered: ${filterName} (tap to change)` : 'Filter by employee'}
        </ThemedText>
      </Pressable>
      {showFilter && (
        <View style={styles.chipRow}>
          <Pressable onPress={() => { setEmployeeFilter(null); setShowFilter(false); }} style={[styles.chip, { backgroundColor: !employeeFilter ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={!employeeFilter ? styles.tabLabelActive : undefined}>All</ThemedText>
          </Pressable>
          {(employees ?? []).map((e) => (
            <Pressable key={e.id} onPress={() => { setEmployeeFilter(e.id); setShowFilter(false); }} style={[styles.chip, { backgroundColor: employeeFilter === e.id ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={employeeFilter === e.id ? styles.tabLabelActive : undefined}>{e.name}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
        {requests === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : requests.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No {tab.toLowerCase()} overtime requests.</ThemedText>
        ) : (
          requests.map((r) => {
            const rowUrgent = r.isUrgent && (r.status ?? 'PENDING') === 'PENDING';
            return (
            <ThemedView
              key={r.id}
              type="backgroundElement"
              style={[styles.row, rowUrgent && { backgroundColor: 'rgba(239,68,68,0.04)', borderWidth: 1, borderColor: '#fca5a5' }]}
            >
              <View style={styles.flex1}>
                <View style={styles.badgeRow}>
                  <ThemedText type="smallBold">{r.user.name}</ThemedText>
                  <View style={styles.roleBadge}>
                    <ThemedText type="small" themeColor="textSecondary">{ROLE_LABELS[r.user.role] ?? r.user.role}</ThemedText>
                  </View>
                  {rowUrgent && (
                    <View style={styles.urgentBadge}>
                      <ThemedText type="small" style={styles.urgentBadgeLabel}>URGENT</ThemedText>
                    </View>
                  )}
                </View>
                <ThemedText type="smallBold">{fmtDate(r.date)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{r.reason}</ThemedText>
                <View style={styles.hoursRow}>
                  <ThemedText type="small" themeColor="textSecondary">{r.requestedHours}h requested</ThemedText>
                  {r.actualHours != null && <ThemedText type="small" style={styles.actualLabel}>{r.actualHours}h actual</ThemedText>}
                  {r.overtimePay != null && <ThemedText type="smallBold" style={styles.actualLabel}>{fmtCurrency(r.overtimePay)}</ThemedText>}
                </View>
                {r.rejectionReason && (
                  <ThemedView type="background" style={styles.rejectionBanner}>
                    <ThemedText type="small" style={styles.error}>Rejection reason: {r.rejectionReason}</ThemedText>
                  </ThemedView>
                )}
                <ThemedText type="small" themeColor="textSecondary" style={styles.timestampLine}>
                  Requested {fmtTs(r.createdAt)}{r.approvedAt ? ` · Processed ${fmtTs(r.approvedAt)}` : ''}
                </ThemedText>

                {tab === 'PENDING' && canAct && (
                  rejectingId === r.id ? (
                    <View style={styles.editBlock}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Rejecting {r.user.name}&apos;s request for {fmtDate(r.date)}.
                      </ThemedText>
                      <TextInput
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        placeholder="Provide a reason for rejection..."
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <View style={styles.actions}>
                        <Pressable onPress={() => onReject(r.id)} disabled={busyId === r.id} style={[styles.button, styles.rejectButton]}>
                          <ThemedText style={styles.buttonLabel}>Confirm Reject</ThemedText>
                        </Pressable>
                        <Pressable onPress={() => { setRejectingId(null); setRejectReason(''); }} style={[styles.button, styles.cancelButton]}>
                          <ThemedText type="small">Cancel</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <Pressable onPress={() => onApprove(r.id)} disabled={busyId === r.id} style={[styles.button, styles.approveButton]}>
                        <ThemedText style={styles.buttonLabel}>Approve</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => setRejectingId(r.id)} disabled={busyId === r.id} style={[styles.button, styles.rejectButton]}>
                        <ThemedText style={styles.buttonLabel}>Reject</ThemedText>
                      </Pressable>
                      {busyId === r.id && <ActivityIndicator size="small" />}
                    </View>
                  )
                )}

                {tab === 'APPROVED' && (
                  <View style={[styles.statusPill, styles.statusPillApproved]}>
                    <ThemedText type="small" style={styles.statusPillLabelApproved}>Approved</ThemedText>
                  </View>
                )}
                {tab === 'REJECTED' && (
                  <View style={[styles.statusPill, styles.statusPillRejected]}>
                    <ThemedText type="small" style={styles.statusPillLabelRejected}>Rejected</ThemedText>
                  </View>
                )}

                {tab === 'APPROVED' && canAct && r.actualHours == null && (
                  actualHoursId === r.id ? (
                    <View style={styles.editBlock}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Actual overtime hours for {fmtDate(r.date)}.
                      </ThemedText>
                      <TextInput
                        value={actualHoursInput}
                        onChangeText={setActualHoursInput}
                        placeholder="e.g. 2.5"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="decimal-pad"
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <View style={styles.actions}>
                        <Pressable onPress={() => onSaveActualHours(r.id)} disabled={busyId === r.id} style={[styles.button, styles.approveButton]}>
                          {busyId === r.id ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                        </Pressable>
                        <Pressable onPress={() => { setActualHoursId(null); setActualHoursInput(''); }} style={[styles.button, styles.cancelButton]}>
                          <ThemedText type="small">Cancel</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable onPress={() => setActualHoursId(r.id)} style={styles.linkButton}>
                      <ThemedText type="link">+ Actual hrs</ThemedText>
                    </Pressable>
                  )
                )}
              </View>
            </ThemedView>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginTop: Spacing.one, marginHorizontal: Spacing.three },
  notice: { color: '#167A48', marginTop: Spacing.one, marginHorizontal: Spacing.three },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  flex1: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one, alignItems: 'center' },
  button: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  approveButton: { backgroundColor: '#167A48' },
  rejectButton: { backgroundColor: '#B83030' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  tabRow: { flexDirection: 'row', gap: Spacing.one, padding: Spacing.three, paddingBottom: 0 },
  tabChip: { flex: 1, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  tabLabelActive: { color: '#ffffff', fontWeight: '600' },
  filterToggle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, minHeight: 36, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  input: { height: 42, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.one },
  editBlock: { gap: Spacing.one, marginTop: Spacing.one },
  linkButton: { marginTop: Spacing.one, minHeight: 40, justifyContent: 'center' },
  tabularNums: { fontVariant: ['tabular-nums'] },
  countRow: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, flexWrap: 'wrap' },
  pendingCountBadge: { backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  pendingCountLabel: { color: '#b45309', fontWeight: '700' },
  urgentCountBadge: { backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  urgentCountLabel: { color: '#b91c1c', fontWeight: '700' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  roleBadge: { backgroundColor: 'rgba(127,127,127,0.12)', borderRadius: 999, paddingHorizontal: Spacing.one, paddingVertical: 1 },
  urgentBadge: { backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 999, paddingHorizontal: Spacing.one, paddingVertical: 1 },
  urgentBadgeLabel: { color: '#ef4444', fontSize: 11, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  actualLabel: { color: '#22c55e' },
  rejectionBanner: { borderRadius: Spacing.two, padding: Spacing.two },
  timestampLine: { fontSize: 11 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: 999, marginTop: Spacing.one },
  statusPillApproved: { backgroundColor: 'rgba(34,197,94,0.12)' },
  statusPillLabelApproved: { color: '#15803d' },
  statusPillRejected: { backgroundColor: 'rgba(239,68,68,0.12)' },
  statusPillLabelRejected: { color: '#b91c1c' },
});
