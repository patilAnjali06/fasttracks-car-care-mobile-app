import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ReplyThread } from '@/components/shared/reply-thread';
import { BottomTabInset, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import {
  completeRecurringTask, createTask, deleteTask, fetchEmployees, fetchMyCurrentRecurringTasks,
  fetchTask, fetchTasks, fetchWorkDoc, markNotificationsRead, replyToTaskThread, TASK_NOTIFICATION_TYPES,
  updateTask, updateTaskStatus,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/hooks/use-theme';
import type { EmployeeListItem, RecurringTaskCompletion, Task, TimesheetEntryReply, WorkDocReply } from '@/types/api';

const ADMIN_ROLES = ['OWNER', 'STORE_MANAGER'];

interface TaskThreadData {
  description: string;
  replies: Array<WorkDocReply | TimesheetEntryReply>;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function daysUntil(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

export default function TasksScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const myId = user?.id ?? '';
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Daily Tasks — always the viewer's own, no person filter. ──────────────
  const [dailyTasks, setDailyTasks] = useState<RecurringTaskCompletion[] | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const loadDaily = useCallback(async () => {
    try {
      const list = await fetchMyCurrentRecurringTasks();
      setDailyTasks(list.filter((c) => c.definition.recurrence === 'DAILY'));
    } catch {
      // Silent — daily tasks are a bonus section; a failed fetch here
      // shouldn't block the rest of the screen.
      setDailyTasks([]);
    }
  }, []);

  const tickDaily = async (completion: RecurringTaskCompletion) => {
    if (completion.status === 'COMPLETED') return;
    setCompletingId(completion.id);
    const previous = dailyTasks;
    setDailyTasks((list) => list?.map((c) => (c.id === completion.id ? { ...c, status: 'COMPLETED' } : c)) ?? list);
    try {
      const updated = await completeRecurringTask(completion.id);
      setDailyTasks((list) => list?.map((c) => (c.id === completion.id ? updated : c)) ?? list);
    } catch (err: any) {
      setDailyTasks(previous);
      showToast('error', err?.response?.data?.error ?? 'Could not mark complete.');
    } finally {
      setCompletingId(null);
    }
  };

  // ── Assigned Tasks — self by default; admins can view another person's. ───
  const [assigneeId, setAssigneeId] = useState('');
  useEffect(() => { if (myId) setAssigneeId(myId); }, [myId]);

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTasks = useCallback(async (forId: string) => {
    if (!forId) return;
    try {
      const list = await fetchTasks({ assignedToId: forId });
      setTasks(list);
    } catch (err: any) {
      showToast('error', err?.response?.data?.error ?? 'Failed to load tasks.');
    }
  }, []);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const loadAll = useCallback(async () => {
    await Promise.all([loadDaily(), loadTasks(assigneeId || myId)]);
  }, [loadDaily, loadTasks, assigneeId, myId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    loadTasks(assigneeId);
  }, [assigneeId, loadTasks]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    loadDaily();
  }, [loadDaily]);

  // Visiting Tasks marks all reply-notifications read at once, matching the dashboard.
  useEffect(() => { markNotificationsRead(TASK_NOTIFICATION_TYPES).catch(() => {}); }, []);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadAll();
    setIsRefreshing(false);
  };

  // Admins need the employee list for the assignee filter and the assign-task form.
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    fetchEmployees().then((list) => setEmployees(list.filter((e) => e.isActive))).catch(() => {});
  }, [isAdmin]);

  // Frontend ownership guard, mirroring the backend's assignee-only check.
  const canToggle = (task: Task) => task.assignedToId === myId;

  const toggleTask = async (task: Task) => {
    if (!canToggle(task) || !tasks) return;
    const next = task.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
    setBusyId(task.id);
    const previous = tasks;
    setTasks((ts) => ts?.map((t) => (t.id === task.id ? { ...t, status: next } : t)) ?? ts);
    try {
      const updated = await updateTaskStatus(task.id, next);
      setTasks((ts) => ts?.map((t) => (t.id === task.id ? updated : t)) ?? ts);
    } catch (err: any) {
      setTasks(previous);
      showToast('error', err?.response?.data?.error ?? 'Could not update the task.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Reply threads on tasks sourced from a work-doc note or timesheet entry ─
  const [threadOpenId, setThreadOpenId] = useState<string | null>(null);
  const [threadData, setThreadData] = useState<Record<string, TaskThreadData>>({});
  const [threadLoading, setThreadLoading] = useState<string | null>(null);
  const [replySending, setReplySending] = useState(false);

  const fetchThreadData = async (task: Task): Promise<TaskThreadData | null> => {
    if (task.sourceWorkDocId) {
      const doc = await fetchWorkDoc(task.sourceWorkDocId);
      return { description: doc.description, replies: doc.replies };
    }
    if (task.sourceTimesheetId && task.sourceEntryId) {
      const full = await fetchTask(task.id);
      return { description: full.title, replies: full.entryReplies ?? [] };
    }
    return null;
  };

  const toggleThread = async (task: Task) => {
    if (threadOpenId === task.id) { setThreadOpenId(null); return; }
    setThreadOpenId(task.id);
    if ((!task.sourceWorkDocId && !task.sourceTimesheetId) || threadData[task.id]) return;
    setThreadLoading(task.id);
    try {
      const data = await fetchThreadData(task);
      if (data) setThreadData((prev) => ({ ...prev, [task.id]: data }));
    } catch {
      // silent — thread section just stays empty
    } finally {
      setThreadLoading(null);
    }
  };

  const handleThreadReply = async (task: Task, message: string) => {
    if (!task.sourceWorkDocId && !task.sourceTimesheetId) return;
    setReplySending(true);
    try {
      await replyToTaskThread(task.id, message);
      const data = await fetchThreadData(task);
      if (data) setThreadData((prev) => ({ ...prev, [task.id]: data }));
    } finally {
      setReplySending(false);
    }
  };

  // ── Assign / edit form ─────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ title: '', description: '', assignedToId: '', date: localToday(), dueDate: '' });

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', description: '', assignedToId: assigneeId !== myId ? assigneeId : '', date: localToday(), dueDate: '' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm({
      title: task.title,
      description: task.description ?? '',
      assignedToId: task.assignedToId,
      date: task.date.slice(0, 10),
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = async () => {
    setFormError('');
    if (!form.title.trim()) { setFormError('Give the task a title.'); return; }
    if (!form.assignedToId) { setFormError('Choose who this is for.'); return; }
    if (!form.date) { setFormError('Pick a date for the task.'); return; }

    setSubmitting(true);
    try {
      if (editing) {
        const updated = await updateTask(editing.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          assignedToId: form.assignedToId,
          date: form.date,
          dueDate: form.dueDate || null,
        });
        if (updated.assignedToId === assigneeId) {
          setTasks((ts) => ts?.map((t) => (t.id === editing.id ? updated : t)) ?? ts);
        } else {
          setTasks((ts) => ts?.filter((t) => t.id !== editing.id) ?? ts);
        }
        showToast('success', 'Task updated.');
      } else {
        const created = await createTask({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          assignedToId: form.assignedToId,
          date: form.date,
          dueDate: form.dueDate || undefined,
        });
        if (created.assignedToId === assigneeId) {
          setTasks((ts) => [created, ...(ts ?? [])]);
        }
        showToast('success', 'Task assigned.');
      }
      setShowForm(false);
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? 'Could not save the task.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (task: Task) => {
    Alert.alert('Delete task', `Delete "${task.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBusyId(task.id);
          try {
            await deleteTask(task.id);
            setTasks((ts) => ts?.filter((t) => t.id !== task.id) ?? ts);
            showToast('success', 'Task deleted.');
          } catch (err: any) {
            showToast('error', err?.response?.data?.error ?? 'Could not delete the task.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const sortedTasks = useMemo(
    () => [...(tasks ?? [])].sort((a, b) => (a.status === 'COMPLETED' ? 1 : 0) - (b.status === 'COMPLETED' ? 1 : 0)),
    [tasks],
  );

  if (tasks === null) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {toast && (
          <View style={[styles.toast, { backgroundColor: toast.type === 'success' ? '#22c55e' : theme.danger }]}>
            <ThemedText type="small" style={styles.toastText}>{toast.msg}</ThemedText>
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>

          <View style={styles.header}>
            <ThemedText type="title">Tasks</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Tick things off as you go.</ThemedText>
          </View>

          {/* ── Daily Tasks ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>DAILY TASKS</ThemedText>
            {dailyTasks === null ? (
              <ActivityIndicator style={styles.sectionLoader} />
            ) : dailyTasks.length === 0 ? (
              <ThemedView type="backgroundElement" style={[styles.emptyCard, { borderColor: theme.border }]}>
                <ThemedText type="small" themeColor="textSecondary">Nothing daily for your role.</ThemedText>
              </ThemedView>
            ) : (
              <View style={styles.cardList}>
                {dailyTasks.map((c) => {
                  const busy = completingId === c.id;
                  const done = c.status === 'COMPLETED';
                  return (
                    <ThemedView key={c.id} type="backgroundElement" style={[styles.card, { borderColor: theme.border, opacity: busy ? 0.6 : 1 }]}>
                      <View style={styles.cardRow}>
                        <Pressable onPress={() => tickDaily(c)} disabled={busy || done} hitSlop={8}>
                          <View style={[styles.checkbox, { borderColor: theme.border, backgroundColor: done ? '#15803d' : 'transparent' }]}>
                            {done && <ThemedText type="small" style={styles.checkMark}>✓</ThemedText>}
                          </View>
                        </Pressable>
                        <View style={styles.flex1}>
                          <ThemedText
                            type="smallBold"
                            style={done ? { color: theme.textSecondary, textDecorationLine: 'line-through' } : undefined}>
                            {c.definition.title}
                          </ThemedText>
                          {c.definition.description ? (
                            <ThemedText type="small" themeColor="textSecondary">{c.definition.description}</ThemedText>
                          ) : null}
                        </View>
                      </View>
                    </ThemedView>
                  );
                })}
              </View>
            )}
          </View>

          {/* ── Assigned Tasks ──────────────────────────────────────────── */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>ASSIGNED TASKS</ThemedText>
              {isAdmin && (
                <Pressable
                  onPress={openCreate}
                  style={[styles.assignButton, { backgroundColor: theme.primary }]}>
                  <ThemedText type="smallBold" style={styles.assignButtonLabel}>+ Assign task</ThemedText>
                </Pressable>
              )}
            </View>

            {isAdmin && employees.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assigneeRow}>
                <Pressable
                  onPress={() => setAssigneeId(myId)}
                  style={[styles.assigneeChip, { borderColor: theme.border, backgroundColor: assigneeId === myId ? theme.primary : theme.background }]}>
                  <ThemedText type="small" style={assigneeId === myId ? styles.assigneeChipLabelActive : undefined}>Me</ThemedText>
                </Pressable>
                {employees.filter((e) => e.id !== myId).map((e) => (
                  <Pressable
                    key={e.id}
                    onPress={() => setAssigneeId(e.id)}
                    style={[styles.assigneeChip, { borderColor: theme.border, backgroundColor: assigneeId === e.id ? theme.primary : theme.background }]}>
                    <ThemedText type="small" style={assigneeId === e.id ? styles.assigneeChipLabelActive : undefined}>{e.name}</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {sortedTasks.length === 0 ? (
              <ThemedView type="backgroundElement" style={[styles.emptyCard, { borderColor: theme.border }]}>
                <ThemedText type="small">
                  {assigneeId === myId ? 'Nothing assigned to you.' : 'Nothing assigned to them.'}
                </ThemedText>
              </ThemedView>
            ) : (
              <View style={styles.cardList}>
                {sortedTasks.map((task) => {
                  const busy = busyId === task.id;
                  const done = task.status === 'COMPLETED';
                  const overdue = !done && task.dueDate ? daysUntil(task.dueDate) < 0 : false;
                  const toggleable = canToggle(task);
                  const hasThread = !!(task.sourceWorkDocId || task.sourceTimesheetId);

                  return (
                    <ThemedView
                      key={task.id}
                      type="backgroundElement"
                      style={[styles.card, { borderColor: overdue ? 'rgba(239,68,68,0.4)' : theme.border, opacity: busy ? 0.6 : 1 }]}>
                      <View style={styles.cardRow}>
                        <Pressable onPress={() => toggleTask(task)} disabled={busy || !toggleable} hitSlop={8}>
                          <View
                            style={[
                              styles.checkbox,
                              { borderColor: toggleable ? theme.border : theme.border, backgroundColor: done ? '#15803d' : 'transparent', opacity: toggleable ? 1 : 0.5 },
                            ]}>
                            {done && <ThemedText type="small" style={styles.checkMark}>✓</ThemedText>}
                          </View>
                        </Pressable>

                        <View style={styles.flex1}>
                          <ThemedText
                            type="smallBold"
                            style={done ? { color: theme.textSecondary, textDecorationLine: 'line-through' } : undefined}>
                            {task.title}
                          </ThemedText>

                          {task.description ? (
                            <ThemedText type="small" themeColor="textSecondary" style={styles.description}>{task.description}</ThemedText>
                          ) : null}

                          <View style={styles.metaRow}>
                            {isAdmin && assigneeId !== myId && (
                              <ThemedText type="small" themeColor="textSecondary">For <ThemedText type="smallBold">{task.assignedTo?.name}</ThemedText></ThemedText>
                            )}
                            {!isAdmin && task.assignedBy?.name && (
                              <ThemedText type="small" themeColor="textSecondary">From {task.assignedBy.name}</ThemedText>
                            )}
                            <ThemedText type="small" themeColor="textSecondary">{fmtDate(task.date)}</ThemedText>
                            {task.dueDate && (
                              <ThemedText type="small" style={overdue ? styles.overdueText : { color: theme.textSecondary }}>
                                Due {fmtDate(task.dueDate)}{overdue ? ' — overdue' : ''}
                              </ThemedText>
                            )}
                          </View>

                          {hasThread && (
                            <View style={styles.threadSection}>
                              <Pressable onPress={() => toggleThread(task)}>
                                <ThemedText type="smallBold" style={{ color: theme.primary }}>
                                  {threadOpenId === task.id ? 'Hide thread' : 'View / reply to thread'}
                                </ThemedText>
                              </Pressable>
                              {threadOpenId === task.id && (
                                threadLoading === task.id ? (
                                  <ActivityIndicator style={styles.threadLoader} />
                                ) : (
                                  <View style={[styles.threadBox, { backgroundColor: theme.background }]}>
                                    {threadData[task.id] && (
                                      <ThemedText type="small" themeColor="textSecondary" style={styles.threadQuote}>
                                        Re: &ldquo;{threadData[task.id].description}&rdquo;
                                      </ThemedText>
                                    )}
                                    <ReplyThread
                                      replies={threadData[task.id]?.replies ?? []}
                                      currentUserId={myId}
                                      onSend={(msg) => handleThreadReply(task, msg)}
                                      sending={replySending}
                                    />
                                  </View>
                                )
                              )}
                            </View>
                          )}

                          {isAdmin && (
                            <View style={styles.adminActionsRow}>
                              <Pressable onPress={() => openEdit(task)} disabled={busy} hitSlop={8} style={styles.iconButton}>
                                <ThemedText type="small" themeColor="textSecondary">Edit</ThemedText>
                              </Pressable>
                              <Pressable onPress={() => handleDelete(task)} disabled={busy} hitSlop={8} style={styles.iconButton}>
                                <ThemedText type="small" style={{ color: theme.danger }}>Delete</ThemedText>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      </View>
                    </ThemedView>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Assign / edit modal */}
      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)} presentationStyle="pageSheet">
        <ThemedView style={styles.flex1}>
          <SafeAreaView style={styles.flex1} edges={['top']}>
            <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
              <ThemedText type="subtitle">{editing ? 'Edit task' : 'Assign a task'}</ThemedText>
              <Pressable onPress={() => setShowForm(false)} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.sheetScroll}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Title</ThemedText>
              <TextInput
                value={form.title}
                onChangeText={(v) => setForm({ ...form, title: v })}
                placeholder="What needs doing?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              />

              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Details (optional)</ThemedText>
              <TextInput
                value={form.description}
                onChangeText={(v) => setForm({ ...form, description: v })}
                placeholder="Anything else they should know"
                placeholderTextColor={theme.textSecondary}
                multiline
                numberOfLines={3}
                style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              />

              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Assign to</ThemedText>
              {employees.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">Couldn't load the employee list — reload and try again.</ThemedText>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assigneeRow}>
                  {employees.map((e) => (
                    <Pressable
                      key={e.id}
                      onPress={() => setForm({ ...form, assignedToId: e.id })}
                      style={[styles.assigneeChip, { borderColor: theme.border, backgroundColor: form.assignedToId === e.id ? theme.primary : theme.background }]}>
                      <ThemedText type="small" style={form.assignedToId === e.id ? styles.assigneeChipLabelActive : undefined}>
                        {e.name}{e.employeeId ? ` (${e.employeeId})` : ''}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              <View style={styles.dateRow}>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Task date</ThemedText>
                  <TextInput
                    value={form.date}
                    onChangeText={(v) => setForm({ ...form, date: v })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  />
                </View>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Due (optional)</ThemedText>
                  <TextInput
                    value={form.dueDate}
                    onChangeText={(v) => setForm({ ...form, dueDate: v })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
                  />
                </View>
              </View>

              {formError ? <ThemedText type="small" style={[styles.formError, { color: theme.danger }]}>{formError}</ThemedText> : null}

              <View style={styles.formActionsRow}>
                <Pressable onPress={() => setShowForm(false)} style={[styles.formButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.formButton, { backgroundColor: theme.primary, opacity: submitting ? 0.7 : 1 }]}>
                  {submitting && <ActivityIndicator size="small" color="#ffffff" style={styles.submitSpinner} />}
                  <ThemedText type="smallBold" style={styles.assignButtonLabel}>{editing ? 'Save changes' : 'Assign'}</ThemedText>
                </Pressable>
              </View>
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex1: { flex: 1 },
  safeArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.three, gap: Spacing.four, paddingBottom: BottomTabInset + Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Spacing.half },
  toast: { position: 'absolute', top: Spacing.three, right: Spacing.three, left: Spacing.three, zIndex: 50, padding: Spacing.two, borderRadius: Radii.md },
  toastText: { color: '#ffffff', textAlign: 'center' },
  section: { gap: Spacing.two },
  sectionLabel: { letterSpacing: 0.5 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  sectionLoader: { marginTop: Spacing.four },
  emptyCard: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.four, alignItems: 'center' },
  cardList: { gap: Spacing.two },
  card: { borderRadius: Radii.lg, borderWidth: 1, padding: Spacing.three },
  cardRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  checkbox: { width: 22, height: 22, borderRadius: Radii.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkMark: { color: '#ffffff' },
  description: { marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  overdueText: { color: '#b91c1c', fontWeight: '600' },
  threadSection: { marginTop: Spacing.two },
  threadLoader: { marginTop: Spacing.two },
  threadBox: { marginTop: Spacing.two, padding: Spacing.two, borderRadius: Radii.md },
  threadQuote: { fontStyle: 'italic', marginBottom: Spacing.two },
  adminActionsRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.two, justifyContent: 'flex-end' },
  iconButton: { paddingVertical: Spacing.one },
  assigneeRow: { flexDirection: 'row' },
  assigneeChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Radii.pill, borderWidth: 1, marginRight: Spacing.two },
  assigneeChipLabelActive: { color: '#ffffff' },
  assignButton: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Radii.md },
  assignButtonLabel: { color: '#ffffff' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: 1 },
  sheetScroll: { padding: Spacing.three, gap: Spacing.one, paddingBottom: Spacing.six },
  fieldLabel: { marginBottom: Spacing.one, marginTop: Spacing.two },
  input: { borderWidth: 1, borderRadius: Radii.md, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  formError: { marginTop: Spacing.two },
  formActionsRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  formButton: { flex: 1, paddingVertical: Spacing.two, borderRadius: Radii.lg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.one },
  submitSpinner: { marginRight: Spacing.one },
});
