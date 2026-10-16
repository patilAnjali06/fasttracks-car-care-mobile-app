import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ackReminder, createReminderDefinition, deleteReminderDefinition, doneReminder, fetchEmployees,
  fetchMyReminders, fetchReminderDefinitions, getErrorMessage, snoozeReminder, updateReminderDefinition,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { EmployeeListItem, ReminderDefinition, ReminderOccurrence, ReminderOccurrenceStatus, ReminderRecurrenceType } from '@/types/api';

// Definition management (create/edit/delete WHO gets reminded about WHAT)
// — OWNER-only (requireOwner, backend/src/routes/reminders.ts), distinct
// from the ack/snooze/done occurrence actions below which any authenticated
// user has for their own reminders. CORRECTED 2026-09-28 (re-verification
// sweep): edit was previously deferred with a comment framing it as a minor
// "scope cut" — it isn't; the dashboard has a full working Edit button per
// definition (CreateReminderModal in edit mode, PATCH /definitions/:id).
// Added here the same way, reusing the create form with an editingDef state.
const RECURRENCE_TYPES: ReminderRecurrenceType[] = ['ONE_OFF', 'DAILY', 'WEEKLY', 'MONTHLY'];

const STATUS_COLOR: Record<ReminderOccurrenceStatus, string> = {
  PENDING: '#A86018',
  SNOOZED: '#3278B0',
  ACKNOWLEDGED: '#167A48',
  DONE: '#5A5A6A',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RemindersScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const [occurrences, setOccurrences] = useState<ReminderOccurrence[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showManage, setShowManage] = useState(false);
  const [definitions, setDefinitions] = useState<ReminderDefinition[] | null>(null);
  const [defError, setDefError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);

  const [showNewDef, setShowNewDef] = useState(false);
  const [editingDef, setEditingDef] = useState<ReminderDefinition | null>(null);
  const [defTitle, setDefTitle] = useState('');
  const [defDescription, setDefDescription] = useState('');
  const [defRecurrence, setDefRecurrence] = useState<ReminderRecurrenceType>('MONTHLY');
  const [defAnchorDate, setDefAnchorDate] = useState('');
  const [defLeadDays, setDefLeadDays] = useState('0');
  const [defTargets, setDefTargets] = useState<string[]>([]);
  const [isSavingDef, setIsSavingDef] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOccurrences(await fetchMyReminders());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load reminders.'));
    }
  }, []);

  const loadDefinitions = useCallback(async () => {
    setDefError(null);
    try {
      const [defs, emps] = await Promise.all([fetchReminderDefinitions(), employees ? Promise.resolve(employees) : fetchEmployees()]);
      setDefinitions(defs);
      setEmployees(emps);
    } catch (err: any) {
      setDefError(getErrorMessage(err, 'Could not load reminder definitions.'));
    }
  }, [employees]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    if (showManage) await loadDefinitions();
    else await load();
    setIsRefreshing(false);
  };

  const openManage = async () => {
    setShowManage(true);
    await loadDefinitions();
  };

  const resetDefForm = () => {
    setEditingDef(null);
    setDefTitle('');
    setDefDescription('');
    setDefRecurrence('MONTHLY');
    setDefAnchorDate('');
    setDefLeadDays('0');
    setDefTargets([]);
  };

  const startEditDefinition = (def: ReminderDefinition) => {
    setEditingDef(def);
    setDefTitle(def.title);
    setDefDescription(def.description ?? '');
    setDefRecurrence(def.recurrenceType);
    setDefAnchorDate(def.anchorDate.slice(0, 10));
    setDefLeadDays(String(def.leadDays));
    setDefTargets(def.targets.map((t) => t.user.id));
    setShowNewDef(true);
  };

  const toggleTarget = (id: string) => {
    setDefTargets((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const onSaveDefinition = async () => {
    if (!defTitle.trim() || !defAnchorDate.trim() || defTargets.length === 0) {
      setDefError('Title, anchor date (YYYY-MM-DD), and at least one target person are required.');
      return;
    }
    setIsSavingDef(true);
    setDefError(null);
    try {
      const payload = {
        title: defTitle.trim(),
        description: defDescription.trim() || undefined,
        recurrenceType: defRecurrence,
        anchorDate: defAnchorDate.trim(),
        leadDays: Number(defLeadDays) || 0,
        targetUserIds: defTargets,
      };
      if (editingDef) await updateReminderDefinition(editingDef.id, payload);
      else await createReminderDefinition(payload);
      resetDefForm();
      setShowNewDef(false);
      await loadDefinitions();
    } catch (err: any) {
      setDefError(getErrorMessage(err, editingDef ? 'Could not save this reminder.' : 'Could not create this reminder.'));
    } finally {
      setIsSavingDef(false);
    }
  };

  const onDeleteDefinition = (def: ReminderDefinition) => {
    Alert.alert('Delete reminder', `Delete "${def.title}"? This stops future occurrences for everyone on it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteReminderDefinition(def.id); await loadDefinitions(); } catch (err: any) { setDefError(getErrorMessage(err, 'Could not delete this reminder.')); }
      } },
    ]);
  };

  const act = async (id: string, action: 'ack' | 'snooze' | 'done') => {
    setBusyId(id);
    try {
      const updated =
        action === 'ack' ? await ackReminder(id) : action === 'snooze' ? await snoozeReminder(id) : await doneReminder(id);
      setOccurrences((prev) => prev?.map((o) => (o.id === id ? updated : o)) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update that reminder.'));
    } finally {
      setBusyId(null);
    }
  };

  if (showNewDef) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: editingDef ? 'Edit Reminder' : 'New Reminder' }} />
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => { setShowNewDef(false); resetDefForm(); }}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          <TextInput value={defTitle} onChangeText={setDefTitle} placeholder="Title *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={defDescription} onChangeText={setDefDescription} placeholder="Description (optional)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Recurrence</ThemedText>
          <View style={styles.chipRow}>
            {RECURRENCE_TYPES.map((r) => (
              <Pressable key={r} onPress={() => setDefRecurrence(r)} style={[styles.chip, { backgroundColor: defRecurrence === r ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={defRecurrence === r ? styles.actionLabel : undefined}>{r}</ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput value={defAnchorDate} onChangeText={setDefAnchorDate} placeholder="Anchor date (YYYY-MM-DD) *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={defLeadDays} onChangeText={setDefLeadDays} placeholder="Lead days (show reminder this many days early)" placeholderTextColor={theme.textSecondary} keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Remind (tap to select) *</ThemedText>
          <View style={styles.chipRow}>
            {(employees ?? []).map((e) => (
              <Pressable key={e.id} onPress={() => toggleTarget(e.id)} style={[styles.chip, { backgroundColor: defTargets.includes(e.id) ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={defTargets.includes(e.id) ? styles.actionLabel : undefined}>{e.name}</ThemedText>
              </Pressable>
            ))}
          </View>
          {defError && <ThemedText style={styles.error}>{defError}</ThemedText>}
          <Pressable onPress={onSaveDefinition} disabled={isSavingDef} style={[styles.actionButton, styles.fieldLabel]}>
            {isSavingDef ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.actionLabel}>{editingDef ? 'Save changes' : 'Create reminder'}</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showManage) {
    return (
      <>
        <Stack.Screen options={{ title: 'Manage Reminders' }} />
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <Pressable onPress={() => setShowManage(false)}><ThemedText type="small">← My reminders</ThemedText></Pressable>
          <Pressable onPress={() => setShowNewDef(true)} style={styles.actionButton}>
            <ThemedText style={styles.actionLabel}>+ New Reminder Definition</ThemedText>
          </Pressable>
          {defError && <ThemedText style={styles.error}>{defError}</ThemedText>}
          {definitions === null ? (
            <ActivityIndicator />
          ) : definitions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No reminder definitions.</ThemedText>
          ) : (
            definitions.map((def) => (
              <ThemedView key={def.id} type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">{def.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {def.recurrenceType} · lead {def.leadDays}d · {def.targets.length} {def.targets.length === 1 ? 'person' : 'people'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {def.targets.map((t) => t.user.name).join(', ')}
                </ThemedText>
                <View style={styles.chipRow}>
                  <Pressable onPress={() => startEditDefinition(def)}>
                    <ThemedText type="link">Edit</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => onDeleteDefinition(def)}>
                    <ThemedText type="small" style={{ color: '#B83030' }}>Delete</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ))
          )}
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Reminders' }} />
      {isOwner && (
        <Pressable onPress={openManage} style={styles.manageToggle}>
          <ThemedText type="link">Manage reminder definitions →</ThemedText>
        </Pressable>
      )}
      {occurrences === null ? (
        <ThemedView style={styles.center}>
          {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
        </ThemedView>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {occurrences.length === 0 && !error && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              No reminders.
            </ThemedText>
          )}

          {occurrences.map((occ) => {
            const isActionable = occ.status === 'PENDING' || occ.status === 'SNOOZED';
            const isBusy = busyId === occ.id;
            return (
              <ThemedView key={occ.id} type="backgroundElement" style={styles.card}>
                <View style={styles.cardTop}>
                  <ThemedText type="smallBold" style={styles.title} numberOfLines={2}>
                    {occ.definition.title}
                  </ThemedText>
                  <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[occ.status] }]}>
                    <ThemedText type="small" style={styles.statusText}>
                      {occ.status}
                    </ThemedText>
                  </View>
                </View>

                {occ.definition.description && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    {occ.definition.description}
                  </ThemedText>
                )}

                <ThemedText type="small" themeColor="textSecondary">
                  Due {formatDate(occ.dueDate)}
                  {occ.status === 'SNOOZED' && occ.snoozedUntil ? ` · snoozed until ${formatDate(occ.snoozedUntil)}` : ''}
                </ThemedText>

                {isActionable && (
                  <View style={styles.actions}>
                    <Pressable disabled={isBusy} onPress={() => act(occ.id, 'ack')} style={styles.actionButton}>
                      <ThemedText type="small" style={styles.actionLabel}>
                        Acknowledge
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      disabled={isBusy}
                      onPress={() => act(occ.id, 'snooze')}
                      style={[styles.actionButton, styles.actionButtonSecondary]}>
                      <ThemedText type="small">Snooze 4h</ThemedText>
                    </Pressable>
                    <Pressable
                      disabled={isBusy}
                      onPress={() => act(occ.id, 'done')}
                      style={[styles.actionButton, styles.actionButtonSecondary]}>
                      <ThemedText type="small">Done</ThemedText>
                    </Pressable>
                  </View>
                )}
              </ThemedView>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  fieldLabel: { marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  manageToggle: { padding: Spacing.three, paddingBottom: 0, minHeight: 36, justifyContent: 'center' },
  error: { color: '#B83030' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1 },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  statusText: { color: '#ffffff' },
  actions: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.one },
  actionButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    backgroundColor: '#7A1C2E',
  },
  actionButtonSecondary: { backgroundColor: 'rgba(127,127,127,0.2)' },
  actionLabel: { color: '#ffffff' },
});
