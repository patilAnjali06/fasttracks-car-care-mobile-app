import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  approveLoan, createLoanAdmin, fetchEmployees, fetchLoanRepayments, fetchLoans,
  getErrorMessage, rejectLoan, updateLoan,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import type { EmployeeListItem, Loan, LoanRepayment } from '@/types/api';

// View/edit (list, create-admin, PATCH edit): ADMIN_ROLES=[OWNER,
// STORE_MANAGER,CASHIER] (backend/src/routes/loans.ts, re-verified
// 2026-09-27 — this is the actual server gate for GET/POST /admin/PATCH
// /:id, distinct from and NARROWER than the dashboard frontend's own
// canEdit array which incorrectly also includes ACCOUNTING — an ACCOUNTING
// user there would see working Edit/+New Loan buttons that then 403
// server-side, so mobile intentionally follows the backend, not the
// dashboard's frontend array, for this gate). Approve/reject: narrower
// still, [OWNER,STORE_MANAGER] only (loans.ts PATCH /:id/approve|reject) —
// even CASHIER, who can view/create/edit, cannot decide — with a
// server-side block on self-approval and on a STORE_MANAGER acting on
// another STORE_MANAGER's request; those 403s are surfaced via
// getErrorMessage, never predicted here.
//
// Sub-tab VISIBILITY (which of Loans/Active a user sees) is a separate,
// per-employee-overridable System A tab-permission pair on the dashboard
// (finance_approvals_loans_tab / finance_approvals_active_tab, plain
// booleans, no view_only/full_access mode — confirmed no such mode exists
// for this screen in backend/src/lib/tabRegistry.ts) — read via hasTab()
// below so a per-employee override in the dashboard's Configure page is
// honored here too, not just the static role gates above which only cover
// the actions themselves.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'CASHIER'];
const DECIDE_ROLES = ['OWNER', 'STORE_MANAGER'];

const REPAYMENT_MODE_OPTIONS: { key: 'MONTHLY_N' | 'LUMP_NEXT_MONTH' | 'TBD' | 'CUSTOM'; label: string }[] = [
  { key: 'MONTHLY_N', label: 'Monthly, over N months' },
  { key: 'LUMP_NEXT_MONTH', label: 'Lump sum, next month' },
  { key: 'TBD', label: 'TBD (no auto-deduction)' },
  { key: 'CUSTOM', label: 'Custom per-month' },
];

const LOAN_FILTERS = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', ''] as const;

const LOAN_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', label: 'Pending' },
  APPROVED: { bg: 'rgba(34,197,94,0.12)', color: '#15803d', label: 'Approved' },
  REJECTED: { bg: 'rgba(239,68,68,0.12)', color: '#b91c1c', label: 'Rejected' },
  COMPLETED: { bg: 'rgba(99,102,241,0.12)', color: '#4338ca', label: 'Completed' },
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Mirrors backend's buildEvenSchedule() exactly (paise-integer math, last
// month absorbs the remainder) — seeds the CUSTOM editor's starting grid.
function nextMonthFrom(year: number, month: number): { month: number; year: number } {
  const m = month + 1;
  return m > 12 ? { month: m - 12, year: year + 1 } : { month: m, year };
}
function buildEvenSplitPreview(amount: number, tenureMonths: number): { month: number; year: number; plannedAmount: number }[] {
  const amountPaise = Math.round(amount * 100);
  const perMonthPaise = Math.floor(amountPaise / tenureMonths);
  const entries: { month: number; year: number; plannedAmount: number }[] = [];
  const now = new Date();
  let { month, year } = nextMonthFrom(now.getFullYear(), now.getMonth() + 1);
  let running = 0;
  for (let i = 0; i < tenureMonths; i++) {
    const isLast = i === tenureMonths - 1;
    const planPaise = isLast ? amountPaise - running : perMonthPaise;
    entries.push({ month, year, plannedAmount: planPaise / 100 });
    running += planPaise;
    const next = nextMonthFrom(year, month);
    month = next.month;
    year = next.year;
  }
  return entries;
}

function csvCell(value: string | number): string {
  const s = String(value);
  // Guard against CSV/formula injection: text beginning with = + - @ (or a
  // leading tab/CR) is executed as a formula by Excel/Sheets. Only string
  // values can carry this, so prefix them with ' to keep them plain text;
  // numeric values (including negatives) are left untouched.
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
async function shareCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, '﻿' + csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
}

export default function FinanceApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { status: permStatus, hasTab } = usePermissions();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const canEdit = isAuthorized; // ADMIN_ROLES gate — view/create/edit, not decide
  const canDecide = DECIDE_ROLES.includes(user?.role ?? '');
  const canSeeLoansTab = permStatus === 'ready' && hasTab('finance_approvals_loans_tab');
  const canSeeActiveTab = permStatus === 'ready' && hasTab('finance_approvals_active_tab');

  const [tab, setTab] = useState<'loans' | 'active'>('loans');
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repayments, setRepayments] = useState<Record<string, LoanRepayment[]>>({});
  const [loadingRepaymentsId, setLoadingRepaymentsId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loanFilter, setLoanFilter] = useState<typeof LOAN_FILTERS[number]>('PENDING');
  const [isExporting, setIsExporting] = useState(false);

  // New Advance form
  const [showNewForm, setShowNewForm] = useState(false);
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newMode, setNewMode] = useState<'MONTHLY_N' | 'LUMP_NEXT_MONTH' | 'TBD' | 'CUSTOM' | ''>('');
  const [newTenure, setNewTenure] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [customSchedule, setCustomSchedule] = useState<{ month: number; year: number; plannedAmount: number }[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Inline edit — matches dashboard's Edit modal fields exactly (amount,
  // remainingAmount, monthlyDeductionAmount, status, notes). Mode/tenure are
  // create-only on the dashboard too — its edit modal has no mode field.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editRemaining, setEditRemaining] = useState('');
  const [editMonthly, setEditMonthly] = useState('');
  const [editStatus, setEditStatus] = useState<Loan['status']>('APPROVED');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setLoans(await fetchLoans());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load loan requests.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  // Default to whichever sub-tab this user's per-employee overrides
  // actually grant — mirrors the dashboard's own tab-visibility filter.
  useEffect(() => {
    if (permStatus !== 'ready') return;
    if (tab === 'loans' && !canSeeLoansTab && canSeeActiveTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default-tab correction once permissions resolve
      setTab('active');
    } else if (tab === 'active' && !canSeeActiveTab && canSeeLoansTab) {
      setTab('loans');
    }
  }, [permStatus, canSeeLoansTab, canSeeActiveTab, tab]);

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
      await approveLoan(id);
      setNotice('Loan approved.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not approve this loan.'));
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id: string) => {
    if (!rejectReason.trim()) {
      setError('Enter a rejection reason.');
      return;
    }
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await rejectLoan(id, rejectReason.trim());
      setNotice('Loan rejected.');
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not reject this loan.'));
    } finally {
      setBusyId(null);
    }
  };

  const openNewForm = async () => {
    setShowNewForm(true);
    setError(null);
    if (!employees) {
      try {
        setEmployees(await fetchEmployees());
      } catch (err: any) {
        setError(getErrorMessage(err, 'Could not load the employee list.'));
      }
    }
  };

  const newAmountNum = Number(newAmount) || 0;
  const newTenureNum = Number(newTenure) || 0;
  const showTenureField = newMode === 'MONTHLY_N' || newMode === 'CUSTOM';
  const showDerivedMonthly = newMode === 'MONTHLY_N' && newAmountNum > 0 && newTenureNum > 0;

  // Reseed the CUSTOM grid only when N actually changes (or amount changes
  // before any manual edit) — not on every keystroke, so overrides aren't
  // silently wiped mid-edit. Matches dashboard's LoanModal effect exactly.
  useEffect(() => {
    if (newMode !== 'CUSTOM' || !newAmountNum || newTenureNum < 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived-schedule reset, mirrors dashboard
      setCustomSchedule([]);
      return;
    }
    setCustomSchedule((prev) => (prev.length === newTenureNum ? prev : buildEvenSplitPreview(newAmountNum, newTenureNum)));
  }, [newMode, newTenureNum, newAmountNum]);

  const customTotal = customSchedule.reduce((s, e) => s + e.plannedAmount, 0);
  const customDiff = Math.round((newAmountNum - customTotal) * 100) / 100;
  const canSaveNew = !!newEmployeeId && !!newAmount && !!newMode && (!showTenureField || newTenureNum >= 1)
    && (newMode === 'CUSTOM' ? customSchedule.length === newTenureNum : true);

  const onCreateLoan = async () => {
    if (!canSaveNew) { setError('Fill in employee, amount, and repayment mode.'); return; }
    setIsCreating(true);
    setError(null);
    try {
      await createLoanAdmin({
        userId: newEmployeeId,
        amount: newAmountNum,
        repaymentMode: newMode,
        tenureMonths: showTenureField ? newTenureNum : undefined,
        scheduleEntries: newMode === 'CUSTOM' ? customSchedule.map((e) => e.plannedAmount) : undefined,
        notes: newNotes.trim() || undefined,
      });
      setShowNewForm(false);
      setNewEmployeeId('');
      setNewAmount('');
      setNewMode('');
      setNewTenure('');
      setNewNotes('');
      setCustomSchedule([]);
      setNotice('Advance created and approved.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not record this advance.'));
    } finally {
      setIsCreating(false);
    }
  };

  const openEdit = (loan: Loan) => {
    setEditingId(loan.id);
    setEditAmount(String(loan.amount));
    setEditRemaining(String(loan.remainingAmount ?? 0));
    setEditMonthly(String(loan.monthlyDeductionAmount ?? 0));
    setEditStatus(loan.status);
    setEditNotes(loan.notes ?? '');
    setError(null);
  };

  const onSaveEdit = async (id: string) => {
    const amount = Number(editAmount);
    if (!amount) {
      setError('Enter a valid amount.');
      return;
    }
    setIsSavingEdit(true);
    setError(null);
    try {
      await updateLoan(id, {
        amount,
        remainingAmount: Number(editRemaining),
        monthlyDeductionAmount: Number(editMonthly),
        status: editStatus,
        notes: editNotes.trim() || undefined,
      });
      setEditingId(null);
      setNotice('Advance updated.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save these changes.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Finance Approvals is only available to Owner, Store Manager, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  // Money-specific requirement: a failed fetch shows an error, never an
  // empty/zero list — `loans === null` (not-yet-loaded) is distinct from
  // `loans === []` (genuinely none), and `error` renders regardless of which
  // state `loans` is in, so a failure is never silently indistinguishable
  // from "no advances outstanding."
  const allActiveLoans = (loans ?? []).filter((l) => l.status === 'APPROVED' && l.remainingAmount > 0);
  const q = search.trim().toLowerCase();
  const activeLoans = q ? allActiveLoans.filter((l) => l.user.name.toLowerCase().includes(q)) : allActiveLoans;
  const totalActiveRemaining = activeLoans.reduce((s, l) => s + l.remainingAmount, 0);
  const pendingCount = (loans ?? []).filter((l) => l.amount > 0 && l.status === 'PENDING').length;
  const filteredLoans = (loans ?? []).filter((l) => l.amount > 0 && (!loanFilter || l.status === loanFilter));
  const visibleLoans = tab === 'loans' ? filteredLoans : activeLoans;

  const onExportActiveCsv = async () => {
    setIsExporting(true);
    try {
      const rows: (string | number)[][] = [
        ['Type', 'Employee', 'Total Given', 'Paid Back', 'Still Owes / Amount', 'Monthly Cut', 'Since', 'Notes / Reason'],
        ...activeLoans.map((l) => [
          'Loan', l.user.name, l.amount, l.amount - l.remainingAmount, l.remainingAmount,
          l.monthlyDeductionAmount > 0 ? l.monthlyDeductionAmount : 'TBD',
          l.requestedAt ? fmtDate(l.requestedAt) : '', l.notes || '',
        ]),
      ];
      await shareCsv(`finance-active-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not export this list.'));
    } finally {
      setIsExporting(false);
    }
  };

  const onToggleRepayments = async (loanId: string) => {
    if (expandedId === loanId) { setExpandedId(null); return; }
    setExpandedId(loanId);
    if (repayments[loanId]) return;
    setLoadingRepaymentsId(loanId);
    setError(null);
    try {
      setRepayments((prev) => ({ ...prev, [loanId]: undefined as any }));
      const rows = await fetchLoanRepayments(loanId);
      setRepayments((prev) => ({ ...prev, [loanId]: rows }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the repayment schedule.'));
    } finally {
      setLoadingRepaymentsId(null);
    }
  };

  if (showNewForm) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
        <Stack.Screen options={{ title: 'New Advance' }} />
        <Pressable onPress={() => setShowNewForm(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>
        <ThemedText type="smallBold" style={styles.fieldLabel}>Employee</ThemedText>
        {employees === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <View style={styles.chipRow}>
            {employees.map((e) => (
              <Pressable key={e.id} onPress={() => setNewEmployeeId(e.id)} style={[styles.chip, { backgroundColor: newEmployeeId === e.id ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={newEmployeeId === e.id ? styles.tabLabelActive : undefined}>{e.name}</ThemedText>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          value={newAmount}
          onChangeText={setNewAmount}
          placeholder="Total Advance Amount (₹) *"
          placeholderTextColor={theme.textSecondary}
          keyboardType="decimal-pad"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        <ThemedText type="smallBold" style={styles.fieldLabel}>Repayment Mode</ThemedText>
        <View style={styles.chipRow}>
          {REPAYMENT_MODE_OPTIONS.map((m) => (
            <Pressable key={m.key} onPress={() => setNewMode(m.key)} style={[styles.chip, { backgroundColor: newMode === m.key ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={newMode === m.key ? styles.tabLabelActive : undefined}>{m.label}</ThemedText>
            </Pressable>
          ))}
        </View>

        {showTenureField && (
          <TextInput
            value={newTenure}
            onChangeText={setNewTenure}
            placeholder="Months (N) *"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        )}

        {showDerivedMonthly && (
          <ThemedView type="backgroundElement" style={styles.previewBanner}>
            <ThemedText type="small" style={{ color: '#2563eb' }}>
              ≈ {formatCurrency(newAmountNum / newTenureNum)}/month for {newTenureNum} months
            </ThemedText>
          </ThemedView>
        )}

        {newMode === 'CUSTOM' && customSchedule.length > 0 && (
          <View style={styles.fieldLabel}>
            <View style={styles.scheduleHeaderRow}>
              <ThemedText type="small" themeColor="textSecondary">Per-Month Schedule (editable)</ThemedText>
              <Pressable onPress={() => setCustomSchedule(buildEvenSplitPreview(newAmountNum, newTenureNum))}>
                <ThemedText type="link">Reset to even split</ThemedText>
              </Pressable>
            </View>
            {customSchedule.map((entry, i) => (
              <View key={i} style={styles.scheduleRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.scheduleMonth}>
                  {MONTH_NAMES[entry.month - 1]} {entry.year}
                </ThemedText>
                <TextInput
                  value={String(entry.plannedAmount)}
                  onChangeText={(t) => {
                    const v = Number(t) || 0;
                    setCustomSchedule((prev) => prev.map((row, ri) => (ri === i ? { ...row, plannedAmount: v } : row)));
                  }}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </View>
            ))}
            {Math.abs(customDiff) > 0.004 && (
              <ThemedView type="backgroundElement" style={styles.warningBanner}>
                <ThemedText type="small" style={{ color: '#b45309' }}>
                  Schedule totals {formatCurrency(customTotal)} but loan is {formatCurrency(newAmountNum)} ({customDiff > 0 ? `${formatCurrency(customDiff)} short` : `${formatCurrency(-customDiff)} over`})
                </ThemedText>
              </ThemedView>
            )}
          </View>
        )}

        <TextInput
          value={newNotes}
          onChangeText={setNewNotes}
          placeholder="Notes (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, styles.fieldLabel, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        <Pressable onPress={onCreateLoan} disabled={isCreating || !canSaveNew} style={[styles.button, styles.approveButton, styles.fieldLabel, { opacity: canSaveNew ? 1 : 0.6 }]}>
          {isCreating ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Create Advance</ThemedText>}
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Finance Approvals' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.tabRow}>
          {canSeeActiveTab && (
            <Pressable onPress={() => setTab('active')} style={[styles.tabChip, { backgroundColor: tab === 'active' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={tab === 'active' ? styles.tabLabelActive : undefined}>Active</ThemedText>
            </Pressable>
          )}
          {canSeeLoansTab && (
            <Pressable onPress={() => setTab('loans')} style={[styles.tabChip, { backgroundColor: tab === 'loans' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={tab === 'loans' ? styles.tabLabelActive : undefined}>Loans</ThemedText>
              {pendingCount > 0 && (
                <View style={styles.pendingBadge}>
                  <ThemedText type="small" style={styles.pendingBadgeLabel}>{pendingCount}</ThemedText>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {canEdit && (
          <Pressable onPress={openNewForm} style={styles.newButton}><ThemedText style={styles.buttonLabel}>+ New Loan</ThemedText></Pressable>
        )}

        {tab === 'active' && (
          <>
            <ThemedView type="backgroundElement" style={styles.summaryCard}>
              <ThemedText type="small" themeColor="textSecondary">ACTIVE ADVANCES</ThemedText>
              <ThemedText type="title" style={styles.summaryCount}>{activeLoans.length}</ThemedText>
              <ThemedText type="small" style={{ color: '#b45309' }}>{formatCurrency(totalActiveRemaining)} outstanding</ThemedText>
            </ThemedView>
            <View style={styles.searchRow}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search employee name…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onExportActiveCsv} disabled={isExporting} style={[styles.exportButton, { borderColor: theme.border }]}>
                {isExporting ? <ActivityIndicator size="small" /> : <ThemedText type="small">CSV</ThemedText>}
              </Pressable>
            </View>
          </>
        )}

        {tab === 'loans' && (
          <View style={styles.chipRow}>
            {LOAN_FILTERS.map((f) => (
              <Pressable key={f || 'all'} onPress={() => setLoanFilter(f)} style={[styles.chip, { backgroundColor: loanFilter === f ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={loanFilter === f ? styles.tabLabelActive : undefined}>
                  {f || 'All'}{f === 'PENDING' && pendingCount > 0 ? ` (${pendingCount})` : ''}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
        {loans === null ? (
          error ? null : <ActivityIndicator style={styles.spinner} />
        ) : visibleLoans.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {tab === 'loans'
              ? (loanFilter ? `No ${loanFilter.toLowerCase()} loan requests.` : 'No loan requests.')
              : (q ? `No active loans match "${search}".` : 'No active loans.')}
          </ThemedText>
        ) : (
          visibleLoans.map((loan) => {
            const st = LOAN_STATUS[loan.status] ?? LOAN_STATUS.PENDING;
            return (
            <ThemedView key={loan.id} type="backgroundElement" style={styles.row}>
              <View style={styles.headerRow}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail" style={styles.tabularNums}>{loan.user.name} · {formatCurrency(loan.amount)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail" style={styles.tabularNums}>
                    {loan.user.role.replace(/_/g, ' ')}
                    {loan.status === 'APPROVED' ? ` · Remaining ${formatCurrency(loan.remainingAmount ?? 0)}` : ''}
                    {' · '}Monthly: {loan.monthlyDeductionAmount > 0 ? formatCurrency(loan.monthlyDeductionAmount) : 'TBD'}
                    {loan.monthlyDeductionPercent > 0 ? ` (${loan.monthlyDeductionPercent.toFixed(1)}%)` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Requested: {fmtDate(loan.requestedAt)}</ThemedText>
                  {loan.notes && <ThemedText type="small" themeColor="textSecondary">{loan.notes}</ThemedText>}
                  {loan.status === 'REJECTED' && loan.rejectionReason && (
                    <ThemedText type="small" style={styles.error}>Reason: {loan.rejectionReason}</ThemedText>
                  )}
                  {loan.status === 'APPROVED' && loan.approvedBy && loan.approvedAt && (
                    <ThemedText type="small" themeColor="textSecondary">Approved by {loan.approvedBy.name} on {fmtDate(loan.approvedAt)}</ThemedText>
                  )}
                </View>
                <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                  <ThemedText type="small" style={{ color: st.color }}>{st.label}</ThemedText>
                </View>
              </View>

              {canDecide && loan.status === 'PENDING' && (
                <View style={styles.actions}>
                  {rejectingId === loan.id ? (
                    <View style={styles.flex1}>
                      <TextInput
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        placeholder="Rejection reason"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <View style={styles.actions}>
                        <Pressable
                          onPress={() => onReject(loan.id)}
                          disabled={busyId === loan.id}
                          style={[styles.button, styles.rejectButton]}
                        >
                          <ThemedText style={styles.buttonLabel}>Confirm reject</ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => { setRejectingId(null); setRejectReason(''); }}
                          style={[styles.button, styles.cancelButton]}
                        >
                          <ThemedText type="small">Cancel</ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => onApprove(loan.id)}
                        disabled={busyId === loan.id}
                        style={[styles.button, styles.approveButton]}
                      >
                        <ThemedText style={styles.buttonLabel}>Approve</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => setRejectingId(loan.id)}
                        disabled={busyId === loan.id}
                        style={[styles.button, styles.rejectButton]}
                      >
                        <ThemedText style={styles.buttonLabel}>Reject</ThemedText>
                      </Pressable>
                      {busyId === loan.id && <ActivityIndicator size="small" />}
                    </>
                  )}
                </View>
              )}

              {canEdit && (
                editingId === loan.id ? (
                  <View style={styles.editBlock}>
                    <TextInput value={editAmount} onChangeText={setEditAmount} placeholder="Amount (₹)" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                    <TextInput value={editRemaining} onChangeText={setEditRemaining} placeholder="Remaining Amount (₹)" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                    <TextInput value={editMonthly} onChangeText={setEditMonthly} placeholder="Monthly Deduction (₹, 0 = TBD)" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                    <View style={styles.chipRow}>
                      {(['APPROVED', 'PENDING', 'COMPLETED', 'REJECTED'] as const).map((s) => (
                        <Pressable key={s} onPress={() => setEditStatus(s)} style={[styles.chip, { backgroundColor: editStatus === s ? theme.primary : theme.background }]}>
                          <ThemedText type="small" style={editStatus === s ? styles.tabLabelActive : undefined}>{LOAN_STATUS[s]?.label ?? s}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput value={editNotes} onChangeText={setEditNotes} placeholder="Notes" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                    <View style={styles.actions}>
                      <Pressable onPress={() => onSaveEdit(loan.id)} disabled={isSavingEdit} style={[styles.button, styles.approveButton]}>
                        {isSavingEdit ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save Changes</ThemedText>}
                      </Pressable>
                      <Pressable onPress={() => setEditingId(null)} style={[styles.button, styles.cancelButton]}>
                        <ThemedText type="small">Cancel</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => openEdit(loan)} style={styles.repaymentsToggle}>
                    <ThemedText type="link">Edit</ThemedText>
                  </Pressable>
                )
              )}

              {tab === 'active' && (
                <View>
                  <Pressable onPress={() => onToggleRepayments(loan.id)} style={styles.repaymentsToggle}>
                    <ThemedText type="link">{expandedId === loan.id ? 'Hide repayments' : 'View repayments'}</ThemedText>
                  </Pressable>
                  {expandedId === loan.id && (
                    loadingRepaymentsId === loan.id || repayments[loan.id] === undefined ? (
                      <ActivityIndicator style={styles.spinner} />
                    ) : repayments[loan.id].length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">No repayments recorded yet.</ThemedText>
                    ) : (
                      repayments[loan.id].map((r) => (
                        <View key={r.id} style={styles.repaymentRow}>
                          <ThemedText type="small" themeColor="textSecondary">{r.month}/{r.year}</ThemedText>
                          <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(r.amountDeducted)}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>Remaining {formatCurrency(r.remainingAfter)}</ThemedText>
                        </View>
                      ))
                    )
                  )}
                </View>
              )}
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
  error: { color: '#B83030', marginTop: Spacing.one },
  notice: { color: '#167A48', marginTop: Spacing.one },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  flex1: { flex: 1 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one, alignItems: 'center' },
  button: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  approveButton: { backgroundColor: '#167A48' },
  rejectButton: { backgroundColor: '#B83030' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  input: { height: 42, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.one },
  tabRow: { flexDirection: 'row', gap: Spacing.one },
  tabChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four, minHeight: 36, justifyContent: 'center' },
  tabLabelActive: { color: '#ffffff', fontWeight: '600' },
  repaymentsToggle: { marginTop: Spacing.one, minHeight: 44, justifyContent: 'center' },
  repaymentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.one, marginTop: Spacing.half },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  editBlock: { gap: Spacing.one, marginTop: Spacing.two },
  previewBanner: { borderRadius: Spacing.two, padding: Spacing.two, marginTop: Spacing.two },
  scheduleHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.two },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  scheduleMonth: { width: 100 },
  warningBanner: { borderRadius: Spacing.two, padding: Spacing.two, marginTop: Spacing.two },
  pendingBadge: { marginLeft: Spacing.one, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 999, paddingHorizontal: Spacing.one, paddingVertical: 1 },
  pendingBadgeLabel: { color: '#ffffff', fontWeight: '700', fontSize: 11 },
  summaryCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  summaryCount: { fontSize: 28, lineHeight: 32 },
  searchRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  exportButton: { height: 42, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: 999 },
});
