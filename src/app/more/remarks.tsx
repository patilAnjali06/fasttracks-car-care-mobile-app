import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createStaffRemark,
  deleteStaffRemark,
  fetchAllStaffRemarks,
  fetchEmployees,
  fetchMyStaffRemarks,
  getErrorMessage,
  replyToRemark,
  updateStaffRemark,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  EmployeeListItem,
  MyRemark,
  RemarkCategory,
  RemarkRating,
  RemarkReply,
  RemarkVisibility,
  StaffRemark,
} from '@/types/api';

// This is a role-DEPENDENT screen, so — unlike most other screens in this
// registry — it carries no `visibleToRoles`: everyone gets the entry, and
// the fork happens here client-side based on the signed-in user's role.
//
// Backend (backend/src/routes/remarks.ts, verified 2026-09-20):
//   - POST/GET /remarks, PATCH/DELETE /remarks/:id  → requireOwner
//   - GET /remarks/mine                              → verifyToken only,
//     self-scoped server-side to the caller's own VISIBLE_TO_EMPLOYEE rows
//     (employeeId always comes from the JWT, never a query param)
//   - POST /remarks/:id/reply                        → verifyToken only;
//     OWNER may reply to any remark, the remark's own subject may reply
//     only when it is VISIBLE_TO_EMPLOYEE — both checks enforced server-side
const CATEGORIES: RemarkCategory[] = [
  'ATTENDANCE',
  'PUNCTUALITY',
  'SALES',
  'CUSTOMER_HANDLING',
  'BEHAVIOUR',
  'TEAMWORK',
  'INITIATIVE',
  'OTHER',
];

const CATEGORY_LABELS: Record<RemarkCategory, string> = {
  ATTENDANCE: 'Attendance',
  PUNCTUALITY: 'Punctuality',
  SALES: 'Sales',
  CUSTOMER_HANDLING: 'Customer Handling',
  BEHAVIOUR: 'Behaviour',
  TEAMWORK: 'Teamwork',
  INITIATIVE: 'Initiative',
  OTHER: 'Other',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ReplyThread({ replies }: { replies: RemarkReply[] }) {
  if (replies.length === 0) return null;
  return (
    <View style={styles.replyThread}>
      {replies.map((r) => (
        <View key={r.id} style={styles.replyRow}>
          <ThemedText type="small" themeColor="textSecondary">
            <ThemedText type="smallBold">{r.author.name}</ThemedText> · {formatDate(r.createdAt)}
          </ThemedText>
          <ThemedText type="small">{r.body}</ThemedText>
        </View>
      ))}
    </View>
  );
}

function ReplyComposer({ onSend, busy }: { onSend: (body: string) => Promise<void>; busy: boolean }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  return (
    <View style={styles.composerRow}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Write a reply…"
        placeholderTextColor={theme.textSecondary}
        style={[styles.composerInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <Pressable
        disabled={busy || !text.trim()}
        onPress={async () => {
          const body = text.trim();
          if (!body) return;
          setText('');
          await onSend(body);
        }}
        style={styles.composerButton}>
        {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.composerButtonLabel}>Send</ThemedText>}
      </Pressable>
    </View>
  );
}

// ── Self view — read-only remarks made about the current user, with a reply
// box when the remark itself allows one (every /mine row is already
// VISIBLE_TO_EMPLOYEE, per the server query, so any of them can be replied
// to — matching canReply's dashboard rule for the remark's own subject). ──
function SelfRemarksView() {
  const insets = useSafeAreaInsets();
  const [remarks, setRemarks] = useState<MyRemark[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRemarks(await fetchMyStaffRemarks());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load your remarks.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const sendReply = async (remarkId: string, body: string) => {
    setBusyId(remarkId);
    try {
      const reply = await replyToRemark(remarkId, body);
      setRemarks((prev) => prev?.map((r) => (r.id === remarkId ? { ...r, replies: [...r.replies, reply] } : r)) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that reply.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'My Remarks' }} />
      {remarks === null ? (
        <ThemedView style={styles.center}>{error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}</ThemedView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {remarks.length === 0 && !error && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>No remarks on your profile yet.</ThemedText>
          )}
          {remarks.map((r) => (
            <ThemedView key={r.id} type="backgroundElement" style={styles.card}>
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.ratingPill,
                    { backgroundColor: r.rating === 'POSITIVE' ? '#167A48' : '#B83030' },
                  ]}>
                  <ThemedText type="small" style={styles.ratingText}>
                    {r.rating === 'POSITIVE' ? 'Positive' : 'Negative'}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">{CATEGORY_LABELS[r.category]}</ThemedText>
              </View>
              <ThemedText type="small">{r.note}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{formatDate(r.createdAt)}</ThemedText>
              <ReplyThread replies={r.replies} />
              <ReplyComposer busy={busyId === r.id} onSend={(body) => sendReply(r.id, body)} />
            </ThemedView>
          ))}
        </ScrollView>
      )}
    </>
  );
}

// ── Owner view — create/edit/list remarks across all employees ────────────
function OwnerRemarksView() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [remarks, setRemarks] = useState<StaffRemark[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters — matches dashboard's employeeFilter/categoryFilter/
  // ratingFilter/visibilityFilter (frontend/src/app/(dashboard)/dashboard/
  // remarks/page.tsx), all client-side over the already-fetched full list.
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RemarkCategory | ''>('');
  const [ratingFilter, setRatingFilter] = useState<RemarkRating | ''>('');
  const [visibilityFilter, setVisibilityFilter] = useState<RemarkVisibility | ''>('');

  // Add-remark form
  const [showForm, setShowForm] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [rating, setRating] = useState<RemarkRating>('POSITIVE');
  const [category, setCategory] = useState<RemarkCategory>('OTHER');
  const [visibility, setVisibility] = useState<RemarkVisibility>('PRIVATE');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [all, emps] = await Promise.all([fetchAllStaffRemarks(), fetchEmployees()]);
      setRemarks(all);
      setEmployees(emps);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load remarks.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEmployeeId('');
    setRating('POSITIVE');
    setCategory('OTHER');
    setVisibility('PRIVATE');
    setNote('');
  };

  const startEdit = (r: StaffRemark) => {
    setEditingId(r.id);
    setEmployeeId(r.employeeId);
    setRating(r.rating);
    setCategory(r.category);
    setVisibility(r.visibility);
    setNote(r.note);
    setShowForm(true);
  };

  const onSubmit = async () => {
    if (!editingId && !employeeId) {
      setError('Choose an employee first.');
      return;
    }
    if (!note.trim()) {
      setError('A note is required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await updateStaffRemark(editingId, { rating, category, visibility, note: note.trim() });
        setNotice('Remark updated.');
      } else {
        await createStaffRemark({ employeeId, rating, category, visibility, note: note.trim() });
        setNotice('Remark added.');
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save this remark.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await deleteStaffRemark(id);
      setRemarks((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not delete this remark.'));
    } finally {
      setBusyId(null);
    }
  };

  const sendReply = async (remarkId: string, body: string) => {
    setBusyId(remarkId);
    try {
      const reply = await replyToRemark(remarkId, body);
      setRemarks((prev) => prev?.map((r) => (r.id === remarkId ? { ...r, replies: [...r.replies, reply] } : r)) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that reply.'));
    } finally {
      setBusyId(null);
    }
  };

  const employeeName = useMemo(() => {
    const map: Record<string, string> = {};
    employees.forEach((e) => (map[e.id] = e.name));
    return map;
  }, [employees]);

  // Staff-history rollup — matches dashboard's "Staff with remarks" chip row
  // + per-employee Positive/Negative history popup (StaffHistoryModal,
  // frontend/src/app/(dashboard)/dashboard/remarks/page.tsx, read 2026-09-24).
  // Built as an in-page section rather than a modal, per mobile convention.
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);
  const staffSummary = useMemo(() => {
    const map: Record<string, { name: string; positive: number; negative: number }> = {};
    (remarks ?? []).forEach((r) => {
      const name = employeeName[r.employeeId] ?? r.employee.name;
      if (!map[r.employeeId]) map[r.employeeId] = { name, positive: 0, negative: 0 };
      if (r.rating === 'POSITIVE') map[r.employeeId].positive += 1;
      else map[r.employeeId].negative += 1;
    });
    return Object.entries(map).map(([id, v]) => ({ employeeId: id, ...v }));
  }, [remarks, employeeName]);
  const historyRemarks = useMemo(
    () => (remarks ?? []).filter((r) => r.employeeId === historyEmployeeId),
    [remarks, historyEmployeeId]
  );

  const filteredRemarks = useMemo(() => (remarks ?? []).filter((r) =>
    (!employeeFilter || r.employeeId === employeeFilter) &&
    (!categoryFilter || r.category === categoryFilter) &&
    (!ratingFilter || r.rating === ratingFilter) &&
    (!visibilityFilter || r.visibility === visibilityFilter)
  ), [remarks, employeeFilter, categoryFilter, ratingFilter, visibilityFilter]);

  return (
    <>
      <Stack.Screen options={{ title: 'Remarks' }} />
      {remarks === null ? (
        <ThemedView style={styles.center}>{error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}</ThemedView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

          <Pressable onPress={() => (showForm ? resetForm() : setShowForm(true))} style={styles.addButton}>
            <ThemedText style={styles.addButtonLabel}>{showForm ? 'Cancel' : '+ Add remark'}</ThemedText>
          </Pressable>

          {showForm && (
            <GlassCard style={styles.formCard}>
              {!editingId && (
                <>
                  <ThemedText type="small" themeColor="textSecondary">Employee</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                    {employees.map((e) => (
                      <Pressable
                        key={e.id}
                        onPress={() => setEmployeeId(e.id)}
                        style={[styles.chip, employeeId === e.id && styles.chipSelected]}>
                        <ThemedText type="small">{e.name}</ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}

              <ThemedText type="small" themeColor="textSecondary">Rating</ThemedText>
              <View style={styles.chipRowStatic}>
                {(['POSITIVE', 'NEGATIVE'] as RemarkRating[]).map((r) => (
                  <Pressable key={r} onPress={() => setRating(r)} style={[styles.chip, rating === r && styles.chipSelected]}>
                    <ThemedText type="small">{r === 'POSITIVE' ? 'Positive' : 'Negative'}</ThemedText>
                  </Pressable>
                ))}
              </View>

              <ThemedText type="small" themeColor="textSecondary">Category</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {CATEGORIES.map((c) => (
                  <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipSelected]}>
                    <ThemedText type="small">{CATEGORY_LABELS[c]}</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>

              <ThemedText type="small" themeColor="textSecondary">Visibility</ThemedText>
              <View style={styles.chipRowStatic}>
                {(['PRIVATE', 'VISIBLE_TO_EMPLOYEE'] as RemarkVisibility[]).map((v) => (
                  <Pressable key={v} onPress={() => setVisibility(v)} style={[styles.chip, visibility === v && styles.chipSelected]}>
                    <ThemedText type="small">{v === 'PRIVATE' ? 'Private' : 'Visible to employee'}</ThemedText>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[styles.noteInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              <Pressable onPress={onSubmit} disabled={isSaving} style={styles.saveButton}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.saveButtonLabel}>{editingId ? 'Save changes' : 'Add remark'}</ThemedText>}
              </Pressable>
            </GlassCard>
          )}

          {staffSummary.length > 0 && (
            <View style={styles.historySection}>
              <ThemedText type="smallBold">Staff with remarks — tap for full history</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {staffSummary.map((s) => (
                  <Pressable
                    key={s.employeeId}
                    onPress={() => setHistoryEmployeeId((cur) => (cur === s.employeeId ? null : s.employeeId))}
                    style={[styles.chip, historyEmployeeId === s.employeeId && styles.chipSelected]}>
                    <ThemedText type="small">{s.name} ({s.positive}+/{s.negative}-)</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {historyEmployeeId && (
            <ThemedView type="backgroundElement" style={styles.historyCard}>
              <View style={styles.cardTop}>
                <ThemedText type="smallBold" style={styles.flex1}>
                  History — {employeeName[historyEmployeeId] ?? historyRemarks[0]?.employee.name}
                </ThemedText>
                <Pressable onPress={() => setHistoryEmployeeId(null)}>
                  <ThemedText type="link">Close</ThemedText>
                </Pressable>
              </View>
              {(['POSITIVE', 'NEGATIVE'] as RemarkRating[]).map((ratingGroup) => {
                const rows = historyRemarks.filter((r) => r.rating === ratingGroup);
                if (rows.length === 0) return null;
                return (
                  <View key={ratingGroup} style={styles.historyColumn}>
                    <ThemedText type="small" style={ratingGroup === 'POSITIVE' ? styles.positiveLabel : styles.negativeLabel}>
                      {ratingGroup === 'POSITIVE' ? 'Positive' : 'Negative'} ({rows.length})
                    </ThemedText>
                    {rows.map((r) => (
                      <View key={r.id} style={styles.historyRow}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {CATEGORY_LABELS[r.category]} · {formatDate(r.createdAt)}
                        </ThemedText>
                        <ThemedText type="small">{r.note}</ThemedText>
                        <ReplyThread replies={r.replies} />
                      </View>
                    ))}
                  </View>
                );
              })}
            </ThemedView>
          )}

          <ThemedText type="smallBold">Filters</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            <Pressable onPress={() => setEmployeeFilter('')} style={[styles.chip, !employeeFilter && styles.chipSelected]}>
              <ThemedText type="small">All employees</ThemedText>
            </Pressable>
            {employees.map((e) => (
              <Pressable key={e.id} onPress={() => setEmployeeFilter((cur) => (cur === e.id ? '' : e.id))} style={[styles.chip, employeeFilter === e.id && styles.chipSelected]}>
                <ThemedText type="small">{e.name}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            <Pressable onPress={() => setCategoryFilter('')} style={[styles.chip, !categoryFilter && styles.chipSelected]}>
              <ThemedText type="small">All categories</ThemedText>
            </Pressable>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategoryFilter((cur) => (cur === c ? '' : c))} style={[styles.chip, categoryFilter === c && styles.chipSelected]}>
                <ThemedText type="small">{CATEGORY_LABELS[c]}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.chipRowStatic}>
            <Pressable onPress={() => setRatingFilter('')} style={[styles.chip, !ratingFilter && styles.chipSelected]}>
              <ThemedText type="small">All ratings</ThemedText>
            </Pressable>
            {(['POSITIVE', 'NEGATIVE'] as RemarkRating[]).map((r) => (
              <Pressable key={r} onPress={() => setRatingFilter((cur) => (cur === r ? '' : r))} style={[styles.chip, ratingFilter === r && styles.chipSelected]}>
                <ThemedText type="small">{r === 'POSITIVE' ? 'Positive' : 'Negative'}</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={styles.chipRowStatic}>
            <Pressable onPress={() => setVisibilityFilter('')} style={[styles.chip, !visibilityFilter && styles.chipSelected]}>
              <ThemedText type="small">All visibility</ThemedText>
            </Pressable>
            {(['PRIVATE', 'VISIBLE_TO_EMPLOYEE'] as RemarkVisibility[]).map((v) => (
              <Pressable key={v} onPress={() => setVisibilityFilter((cur) => (cur === v ? '' : v))} style={[styles.chip, visibilityFilter === v && styles.chipSelected]}>
                <ThemedText type="small">{v === 'PRIVATE' ? 'Private' : 'Visible to employee'}</ThemedText>
              </Pressable>
            ))}
          </View>

          {filteredRemarks.length === 0 && !error && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>No remarks match these filters.</ThemedText>
          )}

          {filteredRemarks.map((r) => (
            <ThemedView key={r.id} type="backgroundElement" style={styles.card}>
              <View style={styles.cardTop}>
                <ThemedText type="smallBold" style={styles.flex1}>{employeeName[r.employeeId] ?? r.employee.name}</ThemedText>
                <View style={[styles.ratingPill, { backgroundColor: r.rating === 'POSITIVE' ? '#167A48' : '#B83030' }]}>
                  <ThemedText type="small" style={styles.ratingText}>{r.rating === 'POSITIVE' ? 'Positive' : 'Negative'}</ThemedText>
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {CATEGORY_LABELS[r.category]} · {r.visibility === 'PRIVATE' ? 'Private' : 'Visible to employee'}
              </ThemedText>
              <ThemedText type="small">{r.note}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{formatDate(r.createdAt)}</ThemedText>
              <ReplyThread replies={r.replies} />
              <ReplyComposer busy={busyId === r.id} onSend={(body) => sendReply(r.id, body)} />
              <View style={styles.actionsRow}>
                <Pressable onPress={() => startEdit(r)} style={styles.smallAction}>
                  <ThemedText type="link">Edit</ThemedText>
                </Pressable>
                <Pressable disabled={busyId === r.id} onPress={() => onDelete(r.id)} style={styles.smallAction}>
                  <ThemedText style={styles.deleteLabel}>Delete</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ))}
        </ScrollView>
      )}
    </>
  );
}

export default function RemarksScreen() {
  const { user } = useAuth();
  return user?.role === 'OWNER' ? <OwnerRemarksView /> : <SelfRemarksView />;
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  flex1: { flex: 1 },
  ratingPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  ratingText: { color: '#ffffff' },
  replyThread: { gap: Spacing.one, marginTop: Spacing.one, paddingTop: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.25)' },
  replyRow: { gap: 2 },
  composerRow: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one, alignItems: 'center' },
  composerInput: { flex: 1, height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15 },
  composerButton: { height: 40, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  composerButtonLabel: { color: '#ffffff', fontWeight: '600' },
  addButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E' },
  addButtonLabel: { color: '#ffffff', fontWeight: '600' },
  formCard: { gap: Spacing.one },
  chipRow: { flexDirection: 'row' },
  chipRowStatic: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.2)', marginRight: Spacing.one },
  chipSelected: { backgroundColor: '#7A1C2E' },
  noteInput: { minHeight: 70, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15, marginTop: Spacing.one, textAlignVertical: 'top' },
  saveButton: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  saveButtonLabel: { color: '#ffffff', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  smallAction: { paddingVertical: 2 },
  deleteLabel: { color: '#B83030' },
  historySection: { gap: Spacing.one },
  historyCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  historyColumn: { gap: Spacing.one },
  positiveLabel: { color: '#167A48', fontWeight: '600' },
  negativeLabel: { color: '#B83030', fontWeight: '600' },
  historyRow: { gap: 2, paddingVertical: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
});
