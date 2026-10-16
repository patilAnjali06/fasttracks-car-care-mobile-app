import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchMyLateRecords, fetchMyOvertime, fetchMyPayroll, fetchMyWarnings } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { LateRecord, PayrollResult } from '@/types/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface PayrollMonth extends PayrollResult {
  month: number;
  year: number;
  fetchFailed?: boolean;
}

function fmt(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
function localDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtShort(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function fmtFull(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

const PENALTY_COLOR: Record<string, string> = {
  WARNING: '#f59e0b', HALF_DAY: '#ef4444', FULL_DAY: '#dc2626', ONE_HALF_DAY: '#991b1b',
};
const PENALTY_LABEL: Record<string, string> = {
  WARNING: 'Warning', HALF_DAY: '½ Day Deducted', FULL_DAY: '1 Day Deducted', ONE_HALF_DAY: '1.5 Days Deducted',
};

export default function MySalaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const { user } = useAuth();

  const [history, setHistory] = useState<PayrollMonth[]>([]);
  const [currentPayroll, setCurrentPayroll] = useState<PayrollMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalWarnings, setTotalWarnings] = useState(0);
  const [lateCountMonth, setLateCountMonth] = useState(0);
  const [lateRecords, setLateRecords] = useState<LateRecord[]>([]);
  const [overtimeThisMonth, setOvertimeThisMonth] = useState<{ count: number; totalPay: number }>({ count: 0, totalPay: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const todayDate = now.getDate();

  const monthlySalary = user?.monthlySalary ?? 0;
  const salaryType = user?.salaryType ?? 'MONTHLY';
  const joiningDateStr = user?.joiningDate ?? null;

  const cycleStart = new Date(curYear, curMonth - 1, 1);
  const cycleEnd = new Date(curYear, curMonth, 0);
  const nextSalaryDate = todayDate === 1
    ? new Date(curYear, curMonth - 1, 1)
    : new Date(curMonth === 12 ? curYear + 1 : curYear, curMonth === 12 ? 0 : curMonth, 1);
  const daysInCurMonth = new Date(curYear, curMonth, 0).getDate();
  const dailyRateFallback = monthlySalary > 0 ? monthlySalary / daysInCurMonth : 0;

  const load = useCallback(async () => {
    if (!monthlySalary || !joiningDateStr) { setLoading(false); return; }
    setLoading(true);

    try {
      const [warnings, lates, overtime] = await Promise.all([
        fetchMyWarnings(),
        fetchMyLateRecords(curMonth, curYear),
        fetchMyOvertime(curMonth, curYear),
      ]);
      setTotalWarnings(warnings.length);
      setLateCountMonth(lates.length);
      setLateRecords(lates);
      const approvedOT = overtime.filter((r) => r.status === 'APPROVED');
      setOvertimeThisMonth({ count: approvedOT.length, totalPay: approvedOT.reduce((s, r) => s + (r.overtimePay ?? 0), 0) });
    } catch {
      // non-fatal — payroll still shows
    }

    const targets: { month: number; year: number }[] = [];
    for (let i = 0; i < 6; i++) {
      let m = curMonth - i;
      let y = curYear;
      if (m <= 0) { m += 12; y -= 1; }
      targets.push({ month: m, year: y });
    }

    const months = await Promise.all(
      targets.map(async ({ month, year }): Promise<PayrollMonth> => {
        try {
          const d = await fetchMyPayroll(user!.id, month, year);
          return { ...d, month, year };
        } catch {
          const start = new Date(year, month - 1, 1);
          const end = new Date(year, month, 0);
          return {
            month, year,
            monthlySalary: 0, presentDays: 0, absentDays: 0, halfDays: 0, leaveDays: 0,
            earnedSalary: 0, absentDeduction: 0, halfDayDeduction: 0, lateDeduction: 0,
            lateCount: 0, carriedLates: 0, lateFullDays: 0, lateHalfDays: 0, lateCarryForward: 0,
            carriedLateDeduction: 0, totalOvertimePay: 0, totalLoanDeduction: 0, loanDeductions: [],
            totalDeductions: 0, netSalary: 0, finalSalaryOverride: null,
            cycleStart: start.toISOString().split('T')[0], cycleEnd: end.toISOString().split('T')[0],
            dailyRate: 0, payableDays: 0, fetchFailed: true,
          };
        }
      }),
    );
    months.sort((a, b) => (b.year !== a.year ? b.year - a.year : b.month - a.month));
    setHistory(months);
    setCurrentPayroll(months.find((m) => m.month === curMonth && m.year === curYear) ?? null);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const cur = currentPayroll;
  const curFetchFailed = cur?.fetchFailed === true;
  const curDeductions = cur && !curFetchFailed ? cur.totalDeductions : 0;
  const curNet = cur && !curFetchFailed ? cur.netSalary : monthlySalary;
  const curPresent = cur?.presentDays ?? 0;
  const curAbsent = cur?.absentDays ?? 0;
  const curHalf = cur?.halfDays ?? 0;
  const curLeave = cur?.leaveDays ?? 0;
  const curLoanDeductions = cur?.loanDeductions ?? [];
  const curDailyRate = cur?.dailyRate ?? dailyRateFallback;

  if (!monthlySalary || !joiningDateStr) {
    return (
      <>
        <Stack.Screen options={{ title: 'My Salary' }} />
        <ThemedView style={styles.center}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Your salary hasn&apos;t been configured yet. Contact your manager if you think this is a mistake.
          </ThemedText>
        </ThemedView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'My Salary' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>

        {/* ── HERO SALARY CARD ─────────────────────────────────────────── */}
        <View style={[styles.hero, { backgroundColor: theme.primary }]}>
          <View style={styles.heroHeaderRow}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <ThemedText type="smallBold" style={styles.avatarText}>{initialsOf(user?.name ?? '')}</ThemedText>
            </View>
            <View style={styles.flex1}>
              <ThemedText type="subtitle" style={styles.heroName}>{user?.name ?? '—'}</ThemedText>
              {user?.designation ? <ThemedText type="small" style={styles.heroSubtext}>{user.designation}</ThemedText> : null}
              <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <ThemedText type="small" style={styles.badgeText}>{salaryType}</ThemedText>
              </View>
            </View>
          </View>

          <View style={styles.heroSalarySection}>
            <ThemedText type="small" style={styles.heroLabel}>MONTHLY SALARY</ThemedText>
            <ThemedText type="title" style={styles.heroSalary}>{fmt(monthlySalary)}</ThemedText>
          </View>

          <View style={styles.heroStatsRow}>
            <View style={[styles.heroStatBox, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <ThemedText type="small" style={styles.heroLabel}>CURRENT CYCLE</ThemedText>
              <ThemedText type="smallBold" style={styles.heroWhite}>{fmtShort(cycleStart)} – {fmtShort(cycleEnd)}</ThemedText>
              <ThemedText type="small" style={styles.heroSubtext}>Joined {fmtFull(localDate(joiningDateStr))}</ThemedText>
            </View>
            <View style={[styles.heroStatBox, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <ThemedText type="small" style={styles.heroLabel}>NEXT SALARY DATE</ThemedText>
              <ThemedText type="smallBold" style={styles.heroGreen}>{fmtFull(nextSalaryDate)}</ThemedText>
              <ThemedText type="small" style={styles.heroSubtext}>
                {Math.max(0, Math.ceil((nextSalaryDate.getTime() - now.getTime()) / 86400000))} days away
              </ThemedText>
            </View>
          </View>
        </View>

        {/* ── CURRENT MONTH BREAKDOWN ──────────────────────────────────── */}
        <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
          <View style={styles.monthHeaderRow}>
            <ThemedText type="smallBold">{MONTH_NAMES[curMonth - 1]} {curYear}</ThemedText>
            {loading && <ActivityIndicator size="small" />}
          </View>

          <View style={styles.statsGrid}>
            {[
              { label: 'Present', value: curPresent, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
              { label: 'Absent', value: curAbsent, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
              { label: 'Half Day', value: curHalf, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
              { label: 'Leave', value: curLeave, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
            ].map((s) => (
              <View key={s.label} style={[styles.statBox, { backgroundColor: s.bg }]}>
                <ThemedText type="smallBold" style={[styles.statValue, { color: s.color }]}>{s.value}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.statLabel}>{s.label}</ThemedText>
              </View>
            ))}
          </View>

          {curFetchFailed && (
            <View style={[styles.failBanner, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <ThemedText type="small" style={styles.failBannerText}>
                Couldn&apos;t load this month&apos;s payroll — the figures below are not real. Pull to refresh to try again.
              </ThemedText>
            </View>
          )}

          <View style={[styles.deductionsRow, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.smallUpper}>DEDUCTIONS</ThemedText>
              <ThemedText type="smallBold" style={[styles.deductionsValue, { color: curDeductions > 0 ? '#ef4444' : theme.textSecondary }]}>
                {curDeductions > 0 ? `– ${fmt(curDeductions)}` : '₹0'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {fmt(curDailyRate)}/day{curDeductions > 0 ? ` × ${curAbsent + curHalf * 0.5} deducted days` : ''}
              </ThemedText>
            </View>
            <View style={[styles.flex1, styles.netColumn]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.smallUpper}>NET PAYABLE</ThemedText>
              <ThemedText type="title" style={styles.netValue}>{fmt(curNet)}</ThemedText>
              {cur?.earnedSalary != null && cur.earnedSalary !== monthlySalary ? (
                <ThemedText type="small" themeColor="textSecondary">
                  earned {fmt(cur.earnedSalary)} ({cur.payableDays ?? '?'} days) · gross {fmt(monthlySalary)}
                  {overtimeThisMonth.totalPay > 0 ? ` + ${fmt(overtimeThisMonth.totalPay)} OT` : ''}
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  of {fmt(monthlySalary)} gross{overtimeThisMonth.totalPay > 0 ? ` + ${fmt(overtimeThisMonth.totalPay)} OT` : ''}
                </ThemedText>
              )}
              {cur?.absentDeduction != null && cur.absentDeduction > 0 && (
                <ThemedText type="small" style={styles.redText}>-{fmt(cur.absentDeduction)} absent</ThemedText>
              )}
              {cur?.halfDayDeduction != null && cur.halfDayDeduction > 0 && (
                <ThemedText type="small" style={styles.redText}>-{fmt(cur.halfDayDeduction)} half days</ThemedText>
              )}
              {cur?.lateDeduction != null && cur.lateDeduction > 0 && (
                <ThemedText type="small" style={styles.redText}>-{fmt(cur.lateDeduction)} lates</ThemedText>
              )}
            </View>
          </View>
        </ThemedView>

        {/* ── TOWARD YOUR ADVANCES ─────────────────────────────────────── */}
        {curLoanDeductions.length > 0 && (
          <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.smallUpper}>TOWARD YOUR ADVANCES</ThemedText>
            {curLoanDeductions.map((d) => (
              <Pressable key={d.loanId} onPress={() => router.push('/more/my-finance')} style={[styles.loanRow, { backgroundColor: theme.background }]}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                  Remaining after this: {fmt(d.remainingAfter)}
                </ThemedText>
                <ThemedText type="smallBold" style={[styles.redText, styles.tabularNums]}>-{fmt(d.amount)}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {/* ── OVERTIME + WARNINGS ───────────────────────────────────────── */}
        <View style={styles.twoColRow}>
          <ThemedView type="backgroundElement" style={[styles.halfCard, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.smallUpper}>OVERTIME THIS MONTH</ThemedText>
            <ThemedText type="smallBold" style={[styles.overtimeValue, { color: overtimeThisMonth.totalPay > 0 ? '#22c55e' : theme.textSecondary }]}>
              {overtimeThisMonth.totalPay > 0 ? `+ ${fmt(overtimeThisMonth.totalPay)}` : '₹0'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {overtimeThisMonth.count} approved session{overtimeThisMonth.count !== 1 ? 's' : ''}
            </ThemedText>
          </ThemedView>
          <ThemedView
            type="backgroundElement"
            style={[styles.halfCard, { borderColor: totalWarnings >= 5 ? '#fca5a5' : theme.border, backgroundColor: totalWarnings >= 5 ? 'rgba(239,68,68,0.06)' : undefined }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.smallUpper}>TOTAL WARNINGS</ThemedText>
            <ThemedText type="smallBold" style={[styles.overtimeValue, { color: totalWarnings >= 5 ? '#ef4444' : totalWarnings > 0 ? '#f59e0b' : theme.textSecondary }]}>
              {totalWarnings}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {totalWarnings === 0 ? 'No warnings on record' : totalWarnings >= 5 ? 'High — manager alerted' : 'Cumulative, never reset'}
            </ThemedText>
          </ThemedView>
        </View>

        {/* ── LATE ARRIVALS THIS MONTH ─────────────────────────────────── */}
        {lateCountMonth > 0 && (
          <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border, padding: 0, overflow: 'hidden' }]}>
            <View style={[styles.lateHeaderRow, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Late Arrivals This Cycle</ThemedText>
              <View style={styles.lateCountBadge}>
                <ThemedText type="small" style={styles.lateCountText}>{lateCountMonth}× late</ThemedText>
              </View>
            </View>
            {lateRecords.map((lr, i) => {
              const color = PENALTY_COLOR[lr.penaltyApplied] ?? '#991b1b';
              const label = PENALTY_LABEL[lr.penaltyApplied] ?? lr.penaltyApplied;
              return (
                <View key={lr.id} style={[styles.lateRow, i > 0 && { borderTopWidth: 1, borderColor: theme.border }]}>
                  <View>
                    <ThemedText type="small">Late #{i + 1}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{fmtFull(localDate(lr.date))}</ThemedText>
                  </View>
                  <View style={[styles.penaltyChip, { backgroundColor: `${color}18` }]}>
                    <ThemedText type="small" style={{ color }}>{label}</ThemedText>
                  </View>
                </View>
              );
            })}
          </ThemedView>
        )}

        {/* ── SALARY HISTORY ───────────────────────────────────────────── */}
        <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border, padding: 0, overflow: 'hidden' }]}>
          <View style={[styles.historyHeader, { borderColor: theme.border }]}>
            <ThemedText type="smallBold">Salary History</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Last 6 months</ThemedText>
          </View>
          {loading ? (
            <ActivityIndicator style={styles.historyLoader} />
          ) : (
            history.map((row, i) => {
              const isActive = row.month === curMonth && row.year === curYear;
              return (
                <View
                  key={`${row.year}-${row.month}`}
                  style={[
                    styles.historyRow,
                    i > 0 && { borderTopWidth: 1, borderColor: theme.border },
                    isActive && { backgroundColor: 'rgba(128,19,34,0.04)' },
                  ]}>
                  <View style={styles.historyTopRow}>
                    <View>
                      <ThemedText type="small" style={styles.historyMonth}>{MONTH_NAMES[row.month - 1]} {row.year}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                        {fmtShort(localDate(row.cycleStart))} – {fmtShort(localDate(row.cycleEnd))}
                      </ThemedText>
                      {isActive && <ThemedText type="small" style={{ color: theme.primary }}>Current</ThemedText>}
                    </View>
                    <View style={styles.historyRight}>
                      {row.fetchFailed ? (
                        <ThemedText type="small" style={styles.redText}>Couldn&apos;t load</ThemedText>
                      ) : (
                        <ThemedText type="smallBold" style={styles.tabularNums}>{fmt(row.netSalary)}</ThemedText>
                      )}
                      {isActive ? (
                        <View style={styles.pendingBadge}><ThemedText type="small" style={styles.pendingText}>Pending</ThemedText></View>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">—</ThemedText>
                      )}
                    </View>
                  </View>
                  <View style={styles.historyMetaRow}>
                    <ThemedText type="small" themeColor="textSecondary">✓ {row.presentDays} present</ThemedText>
                    {row.halfDays > 0 && <ThemedText type="small" themeColor="textSecondary">{row.halfDays} half</ThemedText>}
                    {row.totalDeductions > 0 && <ThemedText type="small" style={styles.redText}>– {fmt(row.totalDeductions)}</ThemedText>}
                  </View>
                </View>
              );
            })
          )}
        </ThemedView>

      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  centerText: { textAlign: 'center' },
  content: { padding: Spacing.three, gap: Spacing.three },
  flex1: { flex: 1 },
  tabularNums: { fontVariant: ['tabular-nums'] },
  redText: { color: '#ef4444' },

  hero: { borderRadius: Radii.lg, padding: Spacing.four, gap: Spacing.three },
  heroHeaderRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff' },
  heroName: { color: '#ffffff' },
  heroSubtext: { color: 'rgba(255,255,255,0.6)' },
  heroWhite: { color: '#ffffff' },
  heroGreen: { color: '#86efac' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radii.pill, marginTop: Spacing.one },
  badgeText: { color: '#ffffff' },
  heroSalarySection: { gap: 2 },
  heroLabel: { color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 },
  heroSalary: { color: '#ffffff', fontSize: 36, lineHeight: 42 },
  heroStatsRow: { flexDirection: 'row', gap: Spacing.two },
  heroStatBox: { flex: 1, borderRadius: Radii.md, padding: Spacing.two, gap: 2 },

  card: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  monthHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsGrid: { flexDirection: 'row', gap: Spacing.two },
  statBox: { flex: 1, borderRadius: Radii.md, paddingVertical: Spacing.two, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20 },
  statLabel: { fontSize: 10 },
  failBanner: { borderRadius: Radii.md, padding: Spacing.two },
  failBannerText: { color: '#fca5a5' },
  deductionsRow: { flexDirection: 'row', borderRadius: Radii.md, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  netColumn: { alignItems: 'flex-end' },
  smallUpper: { letterSpacing: 0.5, fontSize: 10 },
  deductionsValue: { fontSize: 22 },
  netValue: { fontSize: 26 },

  loanRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Radii.md, padding: Spacing.two },

  twoColRow: { flexDirection: 'row', gap: Spacing.two },
  halfCard: { flex: 1, borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.three, gap: 2 },
  overtimeValue: { fontSize: 20 },

  lateHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: 1 },
  lateCountBadge: { backgroundColor: 'rgba(245,158,11,0.12)', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radii.pill },
  lateCountText: { color: '#b45309' },
  lateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three },
  penaltyChip: { paddingHorizontal: Spacing.two, paddingVertical: 4, borderRadius: Radii.pill },

  historyHeader: { padding: Spacing.three, borderBottomWidth: 1 },
  historyLoader: { padding: Spacing.four },
  historyRow: { padding: Spacing.three, gap: Spacing.one },
  historyTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  historyMonth: { fontWeight: '600' },
  historyRight: { alignItems: 'flex-end', gap: 2 },
  historyMetaRow: { flexDirection: 'row', gap: Spacing.three },
  pendingBadge: { backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Radii.pill },
  pendingText: { color: '#b45309' },
});
