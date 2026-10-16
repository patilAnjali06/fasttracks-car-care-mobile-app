import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addIncentiveCredit,
  addIncentiveTarget,
  editIncentiveCredit,
  fetchEmployees,
  fetchIncentiveHistory,
  fetchIncentiveLedger,
  fetchIncentives,
  getErrorMessage,
  recordIncentivePayout,
  setIncentiveAmount,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { EmployeeListItem, IncentiveCredit, IncentiveHistoryEntry, IncentiveLedger, IncentiveRosterEntry } from '@/types/api';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Reads (roster, ledger): requireManagerOrOwner = [OWNER, STORE_MANAGER, HR,
// ACCOUNTING, CASHIER] (backend/src/middleware/auth.ts:83) — GET / and GET
// /:userId/ledger both use this exact middleware, re-verified 2026-09-21.
// Writes are narrower and NOT uniform across every write route — verified
// per-route, not applied as one blanket screen gate:
//   POST /targets, PUT /:userId (per-month amount)  -> requireCashierOrOwner
//   POST /credits, PATCH /credits/:id, POST /payouts -> requireCashierOrOwner
// Every write route in this file happens to use the same requireCashierOrOwner
// = ['CASHIER','OWNER'] pair, confirmed by reading each one individually —
// not assumed from the first route found. If a future route in this file
// uses a different gate, do not reuse WRITE_ROLES for it without re-checking.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING', 'CASHIER'];
const WRITE_ROLES = ['CASHIER', 'OWNER'];

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function IncentivesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const canWrite = WRITE_ROLES.includes(user?.role ?? '');

  const [roster, setRoster] = useState<IncentiveRosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [selected, setSelected] = useState<IncentiveRosterEntry | null>(null);
  const [ledger, setLedger] = useState<IncentiveLedger | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [preLedgerHistory, setPreLedgerHistory] = useState<IncentiveHistoryEntry[] | null>(null);
  const [addPersonQuery, setAddPersonQuery] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [isAddingCredit, setIsAddingCredit] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutNote, setPayoutNote] = useState('');
  const [isRecordingPayout, setIsRecordingPayout] = useState(false);

  // Edit an existing credit
  const [editingCreditId, setEditingCreditId] = useState<string | null>(null);
  const [editCreditAmount, setEditCreditAmount] = useState('');
  const [editCreditNote, setEditCreditNote] = useState('');
  const [isSavingCredit, setIsSavingCredit] = useState(false);

  // Add person to roster
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [isAddingPerson, setIsAddingPerson] = useState(false);

  const { month, year } = currentMonthYear();

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setRoster(await fetchIncentives(month, year));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load incentives.'));
    }
  }, [isAuthorized, month, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const onSave = async (userId: string) => {
    const amount = Number(amountInput);
    if (!amountInput.trim() || amount < 0) {
      setError('Enter a valid amount.');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await setIncentiveAmount(userId, month, year, { amount });
      setNotice('Incentive saved.');
      setEditingId(null);
      setAmountInput('');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save incentive.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onOpenLedger = async (entry: IncentiveRosterEntry) => {
    setSelected(entry);
    setLedger(null);
    setLedgerError(null);
    setPreLedgerHistory(null);
    setCreditAmount('');
    setCreditNote('');
    setPayoutAmount('');
    setPayoutNote('');
    setIsLoadingLedger(true);
    try {
      setLedger(await fetchIncentiveLedger(entry.userId));
      fetchIncentiveHistory(entry.userId).then(setPreLedgerHistory).catch(() => setPreLedgerHistory([]));
    } catch (err: any) {
      setLedgerError(getErrorMessage(err, 'Could not load the incentive ledger.'));
    } finally {
      setIsLoadingLedger(false);
    }
  };

  const reloadLedger = async () => {
    if (!selected) return;
    try {
      setLedger(await fetchIncentiveLedger(selected.userId));
    } catch (err: any) {
      setLedgerError(getErrorMessage(err, 'Could not refresh the ledger.'));
    }
  };

  const onAddCredit = async () => {
    if (!selected) return;
    const amount = Number(creditAmount);
    if (!creditAmount.trim() || !(amount > 0)) {
      setLedgerError('Enter a valid credit amount.');
      return;
    }
    setIsAddingCredit(true);
    setLedgerError(null);
    try {
      await addIncentiveCredit({ userId: selected.userId, amount, note: creditNote.trim() || undefined });
      setCreditAmount('');
      setCreditNote('');
      await reloadLedger();
      await load();
    } catch (err: any) {
      setLedgerError(getErrorMessage(err, 'Could not add the credit.'));
    } finally {
      setIsAddingCredit(false);
    }
  };

  const onStartEditCredit = (creditId: string, currentAmount: number, currentNote: string | null) => {
    setEditingCreditId(creditId);
    setEditCreditAmount(String(currentAmount));
    setEditCreditNote(currentNote ?? '');
  };

  const onSaveEditCredit = async () => {
    if (!editingCreditId) return;
    const amount = Number(editCreditAmount);
    if (!amount || amount <= 0) {
      setLedgerError('Enter a valid amount.');
      return;
    }
    setIsSavingCredit(true);
    setLedgerError(null);
    try {
      await editIncentiveCredit(editingCreditId, { amount, note: editCreditNote.trim() || undefined });
      setEditingCreditId(null);
      await reloadLedger();
    } catch (err: any) {
      setLedgerError(getErrorMessage(err, 'Could not save this credit.'));
    } finally {
      setIsSavingCredit(false);
    }
  };

  const openAddPerson = async () => {
    setShowAddPerson(true);
    setAddPersonQuery('');
    setError(null);
    if (!employees) {
      try {
        setEmployees(await fetchEmployees());
      } catch (err: any) {
        setError(getErrorMessage(err, 'Could not load the employee list.'));
      }
    }
  };

  const onAddPerson = async (userId: string) => {
    setIsAddingPerson(true);
    setError(null);
    try {
      await addIncentiveTarget(userId);
      setShowAddPerson(false);
      setNotice('Added to the incentive roster.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not add this person.'));
    } finally {
      setIsAddingPerson(false);
    }
  };

  const onRecordPayout = () => {
    if (!selected) return;
    const amount = Number(payoutAmount);
    if (!payoutAmount.trim() || !(amount > 0)) {
      setLedgerError('Enter a valid payout amount.');
      return;
    }
    Alert.alert(
      'Record this payout?',
      `This pays out ${formatCurrency(amount)} to ${selected.name} from their incentive balance. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Record payout',
          style: 'destructive',
          onPress: async () => {
            setIsRecordingPayout(true);
            setLedgerError(null);
            try {
              await recordIncentivePayout({ userId: selected.userId, amount, note: payoutNote.trim() || undefined });
              setPayoutAmount('');
              setPayoutNote('');
              await reloadLedger();
            } catch (err: any) {
              setLedgerError(getErrorMessage(err, 'Could not record the payout.'));
            } finally {
              setIsRecordingPayout(false);
            }
          },
        },
      ],
    );
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Incentives is only available to Owner, Store Manager, HR, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (selected) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: `${selected.name} — Ledger` }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setSelected(null)} style={styles.backButton} accessibilityLabel="Back to incentives roster">
            <ThemedText type="link">‹ Back to roster</ThemedText>
          </Pressable>

          {ledgerError && <ThemedText style={styles.error}>{ledgerError}</ThemedText>}

          {isLoadingLedger ? (
            <ActivityIndicator style={styles.spinner} />
          ) : ledger === null ? (
            ledgerError ? (
              <Pressable onPress={() => onOpenLedger(selected)} style={styles.button}>
                <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
              </Pressable>
            ) : null
          ) : (
            <>
              <GlassCard style={styles.card}>
                <ThemedText type="smallBold">Balance</ThemedText>
                <ThemedText type="title" style={styles.tabularNums}>{formatCurrency(ledger.balance)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                  Credited {formatCurrency(ledger.totalCredited)} · Paid {formatCurrency(ledger.totalPaid)}
                </ThemedText>
              </GlassCard>

              {canWrite && (
                <GlassCard style={styles.card}>
                  <ThemedText type="smallBold">Add credit</ThemedText>
                  <TextInput
                    value={creditAmount}
                    onChangeText={setCreditAmount}
                    placeholder="Amount"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <TextInput
                    value={creditNote}
                    onChangeText={setCreditNote}
                    placeholder="Note (optional)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <Pressable onPress={onAddCredit} disabled={isAddingCredit} style={styles.button}>
                    {isAddingCredit ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Add credit</ThemedText>}
                  </Pressable>
                </GlassCard>
              )}

              {canWrite && (
                <GlassCard style={styles.card}>
                  <ThemedText type="smallBold">Record payout</ThemedText>
                  {ledger.balance <= 0 && (
                    <ThemedText type="small" themeColor="textSecondary">Nothing to pay — balance is {formatCurrency(ledger.balance)}.</ThemedText>
                  )}
                  <TextInput
                    value={payoutAmount}
                    onChangeText={setPayoutAmount}
                    placeholder="Amount"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    editable={ledger.balance > 0}
                    style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement, opacity: ledger.balance > 0 ? 1 : 0.5 }]}
                  />
                  <TextInput
                    value={payoutNote}
                    onChangeText={setPayoutNote}
                    placeholder="Note (optional)"
                    placeholderTextColor={theme.textSecondary}
                    editable={ledger.balance > 0}
                    style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement, opacity: ledger.balance > 0 ? 1 : 0.5 }]}
                  />
                  <Pressable onPress={onRecordPayout} disabled={isRecordingPayout || ledger.balance <= 0} style={[styles.button, styles.payoutButton, (isRecordingPayout || ledger.balance <= 0) && styles.disabledButton]}>
                    {isRecordingPayout ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Record payout</ThemedText>}
                  </Pressable>
                </GlassCard>
              )}

              {(() => {
                type LedgerEntry = { kind: 'credit' | 'payout'; id: string; amount: number; note: string | null; by: string; when: string; edited: boolean; history: IncentiveCredit['history'] };
                const credits: LedgerEntry[] = ledger.credits.map((c) => ({
                  kind: 'credit', id: c.id, amount: c.amount, note: c.note, by: c.addedBy?.name ?? 'Unknown', when: c.addedAt,
                  edited: !!c.updatedAt && !!c.addedAt && c.updatedAt !== c.addedAt,
                  history: c.history ?? [],
                }));
                const payouts: LedgerEntry[] = ledger.payouts.map((p) => ({
                  kind: 'payout', id: p.id, amount: p.amount, note: p.note, by: p.paidBy?.name ?? 'Unknown', when: p.paidAt, edited: false, history: [],
                }));
                const entries = [...credits, ...payouts].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());

                return (
                  <>
                    <ThemedText type="smallBold" style={styles.sectionTitle}>Ledger</ThemedText>
                    {entries.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary">No incentive credits or payouts yet.</ThemedText>
                    ) : (
                      entries.map((e) => (
                        <View key={`${e.kind}-${e.id}`}>
                          <Pressable
                            onPress={() => canWrite && e.kind === 'credit' && onStartEditCredit(e.id, e.amount, e.note)}
                            disabled={!canWrite || e.kind !== 'credit'}
                          >
                            <View style={styles.ledgerRow}>
                              <ThemedText type="small" style={[styles.tabularNums, e.kind === 'credit' ? styles.creditAmount : styles.payoutAmount]}>
                                {e.kind === 'credit' ? '+' : '−'}{formatCurrency(e.amount)}
                              </ThemedText>
                              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>
                                {e.note || (e.kind === 'credit' ? 'Incentive added' : 'Paid out')}
                              </ThemedText>
                              {e.edited && (
                                <View style={styles.editedBadge}><ThemedText type="small" style={styles.editedBadgeLabel}>edited</ThemedText></View>
                              )}
                              <ThemedText type="small" themeColor="textSecondary">by {e.by}</ThemedText>
                              <ThemedText type="small" themeColor="textSecondary">{fmtDateTime(e.when)}</ThemedText>
                              {canWrite && e.kind === 'credit' && <ThemedText type="link">Edit</ThemedText>}
                            </View>
                          </Pressable>

                          {e.kind === 'credit' && editingCreditId === e.id && (
                            <View style={styles.editForm}>
                              <TextInput
                                value={editCreditAmount}
                                onChangeText={setEditCreditAmount}
                                placeholder="Amount"
                                placeholderTextColor={theme.textSecondary}
                                keyboardType="decimal-pad"
                                style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                              />
                              <TextInput
                                value={editCreditNote}
                                onChangeText={setEditCreditNote}
                                placeholder="Note"
                                placeholderTextColor={theme.textSecondary}
                                style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                              />
                              <View style={styles.editRow}>
                                <Pressable onPress={onSaveEditCredit} disabled={isSavingCredit} style={styles.button}>
                                  {isSavingCredit ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                                </Pressable>
                                <Pressable onPress={() => setEditingCreditId(null)} style={[styles.button, styles.cancelButton]}>
                                  <ThemedText type="small">Cancel</ThemedText>
                                </Pressable>
                              </View>
                            </View>
                          )}

                          {e.kind === 'credit' && e.history.length > 0 && (
                            <View style={styles.historyTrail}>
                              {e.history.map((h) => (
                                <ThemedText key={h.id} type="small" themeColor="textSecondary">
                                  {h.oldAmount != null ? formatCurrency(h.oldAmount) : '—'} → {formatCurrency(h.newAmount)} by {h.changedBy?.name ?? 'Unknown'}, {fmtDateTime(h.createdAt)}
                                </ThemedText>
                              ))}
                            </View>
                          )}
                        </View>
                      ))
                    )}
                  </>
                );
              })()}

              {preLedgerHistory != null && preLedgerHistory.length > 0 && (
                <View style={styles.preLedgerSection}>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>Pre-ledger history</ThemedText>
                  {preLedgerHistory.map((h) => (
                    <View key={h.id} style={styles.ledgerRow}>
                      <ThemedText type="small">{MONTH_NAMES[h.month - 1]} {h.year}</ThemedText>
                      <ThemedText type="small" style={styles.flex1}>{formatCurrency(h.amount)}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">by {h.awardedBy?.name ?? 'Unknown'}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showAddPerson) {
    const rosterIds = new Set((roster ?? []).map((r) => r.userId));
    const q = addPersonQuery.trim().toLowerCase();
    const candidates = (employees ?? []).filter((e) => !rosterIds.has(e.id) && (!q || e.name.toLowerCase().includes(q)));
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
        <Stack.Screen options={{ title: 'Add to Roster' }} />
        <Pressable onPress={() => setShowAddPerson(false)}><ThemedText type="link">← Cancel</ThemedText></Pressable>
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        <TextInput
          value={addPersonQuery}
          onChangeText={setAddPersonQuery}
          placeholder="Type a name…"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {employees === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : candidates.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {q ? `No employees match "${addPersonQuery}".` : 'Everyone is already on the roster.'}
          </ThemedText>
        ) : (
          candidates.map((e) => (
            <Pressable key={e.id} onPress={() => onAddPerson(e.id)} disabled={isAddingPerson}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold">{e.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{e.designation ?? e.role}</ThemedText>
                </View>
                {isAddingPerson && <ActivityIndicator size="small" />}
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Incentives' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="small" themeColor="textSecondary">Sales team + anyone manually added.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{MONTH_NAMES[month - 1]} {year}</ThemedText>
        {canWrite && (
          <Pressable onPress={openAddPerson} style={styles.newButton}><ThemedText style={styles.buttonLabel}>+ Add person to roster</ThemedText></Pressable>
        )}
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
        {roster === null ? (
          // Money screen: a failed fetch must show a clear retry, never a
          // spinner that never resolves and never a fallback empty roster.
          error ? (
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )
        ) : roster.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No one on the incentive roster.</ThemedText>
        ) : (
          roster.map((entry) => (
            <Pressable key={entry.userId} onPress={() => onOpenLedger(entry)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{entry.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{entry.role}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                    This month: {entry.thisMonth ? formatCurrency(entry.thisMonth.amount) : '—'} · Total: {formatCurrency(entry.runningTotal)}
                  </ThemedText>

                  {canWrite && (
                    editingId === entry.userId ? (
                      <View style={styles.editRow}>
                        <TextInput
                          value={amountInput}
                          onChangeText={setAmountInput}
                          placeholder="Amount"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="decimal-pad"
                          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <Pressable onPress={() => onSave(entry.userId)} disabled={isSaving} style={styles.button}>
                          {isSaving ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                        </Pressable>
                        <Pressable onPress={() => { setEditingId(null); setAmountInput(''); }} style={[styles.button, styles.cancelButton]}>
                          <ThemedText type="small">Cancel</ThemedText>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => { setEditingId(entry.userId); setAmountInput(entry.thisMonth ? String(entry.thisMonth.amount) : ''); }}
                        style={styles.editLink}
                      >
                        <ThemedText type="link">Set this month&apos;s amount</ThemedText>
                      </Pressable>
                    )
                  )}
                </View>
                <ThemedText type="link">Ledger ›</ThemedText>
              </ThemedView>
            </Pressable>
          ))
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  flex1: { flex: 1 },
  editLink: { marginTop: Spacing.one },
  editRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
  input: { height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15, flex: 1 },
  button: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  backButton: { marginBottom: Spacing.one, minHeight: 44, justifyContent: 'center' },
  card: { gap: Spacing.one, marginBottom: Spacing.two },
  formInput: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  payoutButton: { backgroundColor: '#B83030' },
  sectionTitle: { marginTop: Spacing.two },
  ledgerRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  editForm: { marginTop: Spacing.one, gap: Spacing.half },
  creditAmount: { color: '#15803d', fontWeight: '600' },
  payoutAmount: { color: '#b91c1c', fontWeight: '600' },
  editedBadge: { backgroundColor: 'rgba(180,83,9,0.1)', borderRadius: 4, paddingHorizontal: Spacing.one, paddingVertical: 1 },
  editedBadgeLabel: { color: '#b45309', fontSize: 10, fontWeight: '700' },
  historyTrail: { paddingLeft: Spacing.three, gap: 2, marginTop: 2 },
  preLedgerSection: { marginTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)', paddingTop: Spacing.two },
  disabledButton: { opacity: 0.5 },
});
