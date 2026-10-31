import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { fmtDate } from '@/components/applications/application-format';
import { getAvatarColor, getInitials } from '@/components/employees/employee-format';
import { ErrorBanner } from '@/components/overview/parts';
import { ThemedText } from '@/components/themed-text';
import { Card, Skeleton } from '@/components/ui';
import { FontWeights, Radii } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchOnboardingChecklist, fetchOnboardingOverview, getErrorMessage, setOnboardingTaskDone } from '@/lib/api';
import type { OnboardingChecklist, OnboardingOverviewItem, OnboardingTask } from '@/types/api';

const DONE_COLOR = '#167A48';
const TWO_COLS_MIN = 560;
const THREE_COLS_MIN = 900;

function ProgressBar({ done, total }: { done: number; total: number }) {
  const theme = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={[styles.track, { backgroundColor: theme.border }]}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: pct === 100 ? DONE_COLOR : theme.primary }]} />
    </View>
  );
}

type Props = {
  /** Pre-selects a person's checklist (from an Overview drill-down or Applications). */
  initialUserId?: string;
  refreshKey: number;
};

// Dashboard OnboardingTab: "Onboarding checklists currently in progress" as a
// 1 / 2 / 3 column card grid. Tapping a card opens that person's checklist.
export function ChecklistTab({ initialUserId, refreshKey }: Props) {
  const [items, setItems] = useState<OnboardingOverviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialUserId || null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await fetchOnboardingOverview());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load onboarding checklists.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and on pull-to-refresh
    load();
  }, [load, refreshKey]);

  if (selected) {
    return (
      <ChecklistDetail
        userId={selected}
        onBack={() => { setSelected(null); load(); }}
      />
    );
  }

  const cols = width >= THREE_COLS_MIN ? 3 : width >= TWO_COLS_MIN ? 2 : 1;
  const rows: OnboardingOverviewItem[][] = [];
  for (let i = 0; i < (items?.length ?? 0); i += cols) rows.push((items ?? []).slice(i, i + cols));

  return (
    <View style={styles.stack} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ThemedText themeColor="textMuted" style={styles.small}>Onboarding checklists currently in progress.</ThemedText>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!error && items === null ? <Card padding="md"><Skeleton height={14} width="60%" /><Skeleton height={8} /></Card> : null}
      {items && items.length === 0 ? <Card padding="md"><ThemedText themeColor="textMuted" style={styles.body}>No onboarding checklists in progress.</ThemedText></Card> : null}
      {rows.map((row, r) => (
        <View key={r} style={styles.gridRow}>
          {row.map((c) => (
            <Pressable key={c.id} onPress={() => setSelected(c.userId)} accessibilityRole="button" accessibilityLabel={`Open ${c.user.name}'s checklist`} style={({ pressed }) => [styles.cell, pressed && { opacity: 0.7 }]}>
              <Card padding="md" style={styles.cell}>
                <View style={styles.person}>
                  <View style={[styles.avatar, { backgroundColor: getAvatarColor(c.user.name) }]}>
                    <ThemedText style={styles.initials}>{getInitials(c.user.name)}</ThemedText>
                  </View>
                  <View style={styles.flex1}>
                    <ThemedText style={styles.name} numberOfLines={1}>{c.user.name}</ThemedText>
                    <ThemedText themeColor="textMuted" style={styles.small} numberOfLines={1}>{c.user.designation || c.user.employeeId || '—'}</ThemedText>
                  </View>
                </View>
                <ProgressBar done={c.completedTasks} total={c.totalTasks} />
                <ThemedText themeColor="textMuted" style={styles.small}>{`${c.completedTasks}/${c.totalTasks} tasks · started ${fmtDate(c.createdAt)}`}</ThemedText>
              </Card>
            </Pressable>
          ))}
          {Array.from({ length: cols - row.length }).map((_, k) => <View key={`pad-${k}`} style={styles.cell} />)}
        </View>
      ))}
    </View>
  );
}

// The existing per-person checklist (task toggling), unchanged in behaviour.
// Phase 2 replaces it with the dashboard's OnboardingDetailModal.
function ChecklistDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const theme = useTheme();
  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChecklist(await fetchOnboardingChecklist(userId));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the onboarding checklist.'));
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  const patchTask = (taskId: string, patch: Partial<OnboardingTask>) =>
    setChecklist((c) => (c ? { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) } : c));

  const toggle = async (task: OnboardingTask) => {
    const next = !task.isDone;
    setToggleError(null);
    patchTask(task.id, { isDone: next }); // optimistic; reverted if the server refuses
    try {
      setChecklist(await setOnboardingTaskDone(task.id, next));
    } catch (err: unknown) {
      patchTask(task.id, { isDone: task.isDone });
      setToggleError(getErrorMessage(err, 'Could not update the task.'));
    }
  };

  const done = checklist?.tasks.filter((t) => t.isDone).length ?? 0;
  const total = checklist?.tasks.length ?? 0;
  const complete = total > 0 && done === total;

  return (
    <View style={styles.stack}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <ThemedText style={[styles.small, { color: theme.primary }]}>← All onboarding</ThemedText>
      </Pressable>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!error && !checklist ? <Card padding="md"><Skeleton height={16} width="50%" /><Skeleton height={8} /></Card> : null}
      {checklist ? (
        <>
          <Card padding="md">
            <ThemedText style={styles.name}>{checklist.user.name}</ThemedText>
            <ThemedText themeColor="textMuted" style={styles.small}>{[checklist.user.designation, checklist.user.employeeId].filter(Boolean).join(' · ') || '—'}</ThemedText>
            <ThemedText themeColor="textMuted" style={styles.small}>{`Started ${fmtDate(checklist.createdAt)} by ${checklist.createdBy.name}`}</ThemedText>
            <ProgressBar done={done} total={total} />
            <ThemedText style={[styles.small, complete && { color: DONE_COLOR }]}>
              {complete ? `Onboarding complete${checklist.completedAt ? ` · ${fmtDate(checklist.completedAt)}` : ''}` : `${done}/${total} tasks done`}
            </ThemedText>
          </Card>
          {toggleError ? <ErrorBanner message={toggleError} /> : null}
          {checklist.tasks.length === 0 ? <ThemedText themeColor="textMuted" style={styles.small}>This checklist has no tasks.</ThemedText> : null}
          {checklist.tasks.map((task) => (
            <Card key={task.id} padding="sm">
              <View style={styles.task}>
                <Pressable
                  onPress={() => toggle(task)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: task.isDone }}
                  hitSlop={10}
                  style={[styles.checkbox, { borderColor: task.isDone ? DONE_COLOR : theme.textSecondary, backgroundColor: task.isDone ? DONE_COLOR : 'transparent' }]}>
                  {task.isDone ? <ThemedText style={styles.check}>✓</ThemedText> : null}
                </Pressable>
                <View style={styles.flex1}>
                  <ThemedText style={[styles.name, task.isDone && styles.struck]}>{task.title}</ThemedText>
                  {task.description ? <ThemedText themeColor="textMuted" style={styles.small}>{task.description}</ThemedText> : null}
                  {task.responsible ? <ThemedText themeColor="textMuted" style={styles.small}>{`Responsible: ${task.responsible}`}</ThemedText> : null}
                  {task.isDone && task.doneAt ? <ThemedText themeColor="textMuted" style={styles.small}>{`Done ${fmtDate(task.doneAt)}`}</ThemedText> : null}
                </View>
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  gridRow: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1 },
  flex1: { flex: 1, minWidth: 0 },
  body: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 18 },
  name: { fontSize: 14, lineHeight: 20, fontFamily: FontWeights.semiBold },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontSize: 13, lineHeight: 16, fontFamily: FontWeights.bold },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 8 },
  fill: { height: '100%', borderRadius: 4 },
  back: { minHeight: 44, justifyContent: 'center' },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: { width: 26, height: 26, borderRadius: Radii.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  check: { color: '#fff', fontSize: 16, lineHeight: 20, fontFamily: FontWeights.bold },
  struck: { textDecorationLine: 'line-through' },
});
