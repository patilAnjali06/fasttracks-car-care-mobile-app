import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchLoanRepayments, fetchMyLoans, fetchSalaryPayments, getErrorMessage, requestLoan } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { LoanOrAdvance, LoanRepayment, RepaymentMode, SalaryPaymentRecord } from '@/types/api';

// Self-view only. GET /loans scopes to the requester's own userId
// server-side (ADMIN_ROLES=[OWNER,STORE_MANAGER,CASHIER] only widen the
// query, they don't restrict it further) — no client role gate needed for
// viewing/creating one's own requests. The separate admin approve/reject
// queue ("finance-approvals") is explicitly out of this screen's scope.
//
// "Advance" IS this feature — corrected 2026-09-21. There is no separate
// Advance model or route; the dashboard's "My Finance" page (frontend/src/
// app/(dashboard)/dashboard/my-finance/page.tsx) calls this exact /loans
// API and labels every part of the UI "Advance" ("Request Advance", "Manage
// your salary advances"). "Loan" is only the backend's internal model name.
// A prior note here claimed Advances was removed from the product; that was
// wrong — it conflated the backend Loan model's naming with the (separate,
// genuinely gone) standalone Advance model/routes. See
// MOBILE_PERMISSIONS_PATTERN.md / screen-registry.ts for the correction.
const REPAYMENT_MODES: { key: RepaymentMode; label: string }[] = [
  { key: 'MONTHLY_N', label: 'Monthly, over N months' },
  { key: 'LUMP_NEXT_MONTH', label: 'Lump sum, next month' },
  { key: 'TBD', label: 'TBD (no auto-deduction)' },
  { key: 'CUSTOM', label: 'Custom per-month' },
];
const TENURE_MODES: RepaymentMode[] = ['MONTHLY_N', 'CUSTOM'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function statusColor(status: LoanOrAdvance['status']) {
  if (status === 'APPROVED' || status === 'COMPLETED') return '#167A48';
  if (status === 'REJECTED') return '#B83030';
  return '#A86018';
}

export default function MyFinanceScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const [tab, setTab] = useState<'salary' | 'loans'>('salary');

  const [salPayments, setSalPayments] = useState<SalaryPaymentRecord[]>([]);
  const [salYear, setSalYear] = useState(new Date().getFullYear());
  const [salLoading, setSalLoading] = useState(false);

  const loadSalaryPayments = useCallback(async () => {
    if (!user) return;
    setSalLoading(true);
    try {
      setSalPayments(await fetchSalaryPayments(user.id, salYear));
    } catch {
      // silently skip — matches the dashboard's own my-finance page
    } finally {
      setSalLoading(false);
    }
  }, [user, salYear]);

  useEffect(() => {
    if (tab === 'salary') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/tab-change, not a render loop
      loadSalaryPayments();
    }
  }, [tab, loadSalaryPayments]);

  const [loans, setLoans] = useState<LoanOrAdvance[] | null>(null);
  const [amount, setAmount] = useState('');
  const [repaymentMode, setRepaymentMode] = useState<RepaymentMode | null>(null);
  const [tenureMonths, setTenureMonths] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repayments, setRepayments] = useState<Record<string, LoanRepayment[]>>({});
  const [loadingRepaymentsId, setLoadingRepaymentsId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLoans(await fetchMyLoans());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load your finance records.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    if (tab === 'salary') await loadSalaryPayments();
    else await load();
    setIsRefreshing(false);
  };

  const needsTenure = repaymentMode != null && TENURE_MODES.includes(repaymentMode);

  const onSubmit = async () => {
    const amt = Number(amount);
    const tenure = Number(tenureMonths);
    if (!amt || amt <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!repaymentMode) {
      setError('Select a repayment mode.');
      return;
    }
    if (needsTenure && (!tenure || tenure < 1)) {
      setError('Enter the number of months.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await requestLoan({
        amount: amt,
        repaymentMode,
        ...(needsTenure ? { tenureMonths: tenure } : {}),
        notes: notes.trim() || undefined,
      });
      setAmount('');
      setRepaymentMode(null);
      setTenureMonths('');
      setNotes('');
      setNotice('Advance request submitted.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not submit the request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onToggleRepayments = async (loan: LoanOrAdvance) => {
    if (expandedId === loan.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(loan.id);
    if (repayments[loan.id]) return;
    setLoadingRepaymentsId(loan.id);
    setError(null);
    try {
      const rows = await fetchLoanRepayments(loan.id);
      setRepayments((prev) => ({ ...prev, [loan.id]: rows }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the repayment schedule.'));
    } finally {
      setLoadingRepaymentsId(null);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <Stack.Screen options={{ title: 'My Finance' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <View style={[styles.tabBar, { backgroundColor: theme.backgroundElement }]}>
          {(['salary', 'loans'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tabButton, { backgroundColor: tab === t ? theme.primary : 'transparent' }]}>
              <ThemedText type="small" style={tab === t ? styles.chipLabelActive : { color: theme.textSecondary }}>
                {t === 'salary' ? 'Salary' : 'Loans'}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {tab === 'salary' && (
          <>
            <View style={styles.yearRow}>
              <Pressable onPress={() => setSalYear((y) => y - 1)} style={[styles.yearButton, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">‹ {salYear - 1}</ThemedText>
              </Pressable>
              <ThemedText type="smallBold">{salYear}</ThemedText>
              <Pressable
                onPress={() => setSalYear((y) => y + 1)}
                disabled={salYear >= new Date().getFullYear()}
                style={[styles.yearButton, { backgroundColor: theme.backgroundElement, opacity: salYear >= new Date().getFullYear() ? 0.5 : 1 }]}>
                <ThemedText type="small" themeColor="textSecondary">{salYear + 1} ›</ThemedText>
              </Pressable>
            </View>

            {salLoading ? (
              <ActivityIndicator style={styles.spinner} />
            ) : (
              MONTH_NAMES.map((mName, idx) => {
                const mNum = idx + 1;
                const now2 = new Date();
                const isFuture = salYear > now2.getFullYear() || (salYear === now2.getFullYear() && mNum > now2.getMonth() + 1);
                const p = salPayments.find((s) => s.month === mNum);
                return (
                  <ThemedView key={mNum} type="backgroundElement" style={[styles.monthRow, { opacity: isFuture ? 0.4 : 1 }]}>
                    <View style={styles.flex1}>
                      <ThemedText type="smallBold">{mName} {salYear}</ThemedText>
                      {p && (
                        <ThemedText type="small" themeColor="textSecondary">
                          via {p.mode || 'Cash'} · confirmed by {p.paidBy?.name} · {new Date(p.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </ThemedText>
                      )}
                    </View>
                    {p ? (
                      <View style={styles.paidBadgeRow}>
                        <ThemedText type="smallBold" style={[styles.tabularNums, { color: '#15803d' }]}>
                          {formatCurrency(p.amount)}
                        </ThemedText>
                        <View style={styles.receivedPill}>
                          <ThemedText type="small" style={styles.receivedLabel}>✓ Received</ThemedText>
                        </View>
                      </View>
                    ) : isFuture ? (
                      <ThemedText type="small" themeColor="textSecondary">—</ThemedText>
                    ) : (
                      <View style={styles.pendingPill}>
                        <ThemedText type="small" style={styles.pendingLabel}>Pending</ThemedText>
                      </View>
                    )}
                  </ThemedView>
                );
              })
            )}
          </>
        )}

        {tab === 'loans' && (
      <>
        <GlassCard>
          <ThemedText type="smallBold">Request an advance</ThemedText>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="next"
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Repayment mode</ThemedText>
          <View style={styles.chipRow}>
            {REPAYMENT_MODES.map((m) => (
              <Pressable
                key={m.key}
                onPress={() => setRepaymentMode(m.key)}
                style={[styles.chip, { backgroundColor: repaymentMode === m.key ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={repaymentMode === m.key ? styles.chipLabelActive : undefined}>{m.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          {needsTenure && (
            <TextInput
              value={tenureMonths}
              onChangeText={setTenureMonths}
              placeholder="Months (N)"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              returnKeyType="next"
            />
          )}

          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="done"
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
            This is a proposal — management can adjust the amount, mode, or months when approving.
          </ThemedText>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
          <Pressable onPress={onSubmit} disabled={isSubmitting} style={styles.button}>
            {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Submit request</ThemedText>}
          </Pressable>
        </GlassCard>

        <ThemedText type="smallBold" style={styles.sectionTitle}>My advances</ThemedText>
        {loans === null ? (
          // Money screen: a failed fetch must show a clear retry, never an
          // indefinite spinner and never a fallback empty list — this app
          // has already shipped silent failures that looked exactly like
          // "nothing here."
          error ? (
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )
        ) : loans.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">None yet.</ThemedText>
        ) : (
          loans.map((item) => {
            const createdBy = item.history[0]?.changedBy ?? null;
            const nextDue = item.scheduleEntries.find((se) => {
              const now = new Date();
              return se.year > now.getFullYear() || (se.year === now.getFullYear() && se.month >= now.getMonth() + 1);
            });
            return (
              <Pressable key={item.id} onPress={() => onToggleRepayments(item)}>
                <ThemedView type="backgroundElement" style={styles.row}>
                  <View style={styles.headerRow}>
                    <View style={styles.flex1}>
                      <ThemedText type="smallBold" style={styles.tabularNums}>{formatCurrency(item.amount)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail" style={styles.tabularNums}>
                        {item.repaymentMode ? REPAYMENT_MODES.find((m) => m.key === item.repaymentMode)?.label : `${item.monthlyDeductionPercent.toFixed(1)}% / month`}
                        {item.tenureMonths ? ` · ${item.tenureMonths}mo` : ''}
                      </ThemedText>
                      {(item.status === 'APPROVED' || item.status === 'COMPLETED') && (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                          Remaining {formatCurrency(item.remainingAmount)}
                        </ThemedText>
                      )}
                      {createdBy && (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                          Recorded by {createdBy.name} on your behalf
                        </ThemedText>
                      )}
                      {item.status === 'APPROVED' && nextDue && (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                          Next due: {formatCurrency(nextDue.plannedAmount)} in {MONTH_SHORT[nextDue.month - 1]} {nextDue.year}
                        </ThemedText>
                      )}
                      {item.notes && (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} ellipsizeMode="tail">{item.notes}</ThemedText>
                      )}
                      {item.status === 'REJECTED' && item.rejectionReason && (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} ellipsizeMode="tail">Reason: {item.rejectionReason}</ThemedText>
                      )}
                    </View>
                    <ThemedText type="small" style={{ color: statusColor(item.status) }}>{item.status}</ThemedText>
                  </View>

                  {expandedId === item.id && (
                    <View style={styles.repaymentsSection}>
                      <ThemedText type="small" themeColor="textSecondary">Deduction history</ThemedText>
                      {loadingRepaymentsId === item.id ? (
                        <ActivityIndicator style={styles.spinner} />
                      ) : (repayments[item.id]?.length ?? 0) === 0 ? (
                        <ThemedText type="small" themeColor="textSecondary">No repayments recorded yet.</ThemedText>
                      ) : (
                        repayments[item.id].map((r) => (
                          <View key={r.id} style={styles.repaymentRow}>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{MONTH_SHORT[r.month - 1]} {r.year}</ThemedText>
                            <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(r.amountDeducted)}</ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>Remaining {formatCurrency(r.remainingAfter)}</ThemedText>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </ThemedView>
              </Pressable>
            );
          })
        )}
      </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#B83030', marginTop: Spacing.one },
  notice: { color: '#167A48', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  sectionTitle: { marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  repaymentsSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)', paddingTop: Spacing.two, gap: Spacing.one },
  repaymentRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.one },
  tabularNums: { fontVariant: ['tabular-nums'] },
  tabBar: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: Spacing.two, alignSelf: 'flex-start' },
  tabButton: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.one },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  yearButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.two },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  paidBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  receivedPill: { backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  receivedLabel: { color: '#15803d', fontWeight: '700' },
  pendingPill: { backgroundColor: 'rgba(232,168,40,0.15)', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  pendingLabel: { color: '#b45309', fontWeight: '600' },
});
