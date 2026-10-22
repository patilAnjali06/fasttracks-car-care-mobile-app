import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchOnboardingChecklist,
  fetchOnboardingOverview,
  getErrorMessage,
  setOnboardingTaskDone,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { OnboardingChecklist, OnboardingOverviewItem, OnboardingTask } from '@/types/api';

// Whole /hr router is router.use(verifyToken, requireHROrOwner) =
// OWNER/STORE_MANAGER/HR/ACCOUNTING (backend/src/routes/hr.ts,
// middleware/auth.ts) — a static role check, so this is the static-role
// pattern (see leave-requests.tsx), not usePermissions().
const ONBOARDING_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

const DONE_COLOR = '#167A48';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const theme = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={[styles.barTrack, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: pct === 100 ? DONE_COLOR : theme.primary }]} />
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GlassCard>
      <ThemedText style={styles.error}>{message}</ThemedText>
      <Pressable onPress={onRetry} style={styles.button}>
        <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
      </Pressable>
    </GlassCard>
  );
}

function ChecklistDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [checklist, setChecklist] = useState<OnboardingChecklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChecklist(await fetchOnboardingChecklist(userId));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the onboarding checklist.'));
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const patchTask = (taskId: string, patch: Partial<OnboardingTask>) =>
    setChecklist((c) => (c ? { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) } : c));

  const toggle = async (task: OnboardingTask) => {
    const next = !task.isDone;
    setToggleError(null);
    // Optimistic — flip locally, revert just this task if the server refuses.
    patchTask(task.id, { isDone: next });
    try {
      setChecklist(await setOnboardingTaskDone(task.id, next));
    } catch (err: any) {
      patchTask(task.id, { isDone: task.isDone });
      setToggleError(getErrorMessage(err, 'Could not update the task.'));
    }
  };

  const done = checklist?.tasks.filter((t) => t.isDone).length ?? 0;
  const total = checklist?.tasks.length ?? 0;
  const isComplete = total > 0 && done === total;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      <Pressable onPress={onBack} style={styles.backLink}>
        <ThemedText type="small">← All onboarding</ThemedText>
      </Pressable>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : checklist === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <>
          <GlassCard>
            <ThemedText type="smallBold">{checklist.user.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[checklist.user.designation, checklist.user.employeeId].filter(Boolean).join(' · ') || '—'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Started {fmtDate(checklist.createdAt)} by {checklist.createdBy.name}
            </ThemedText>
            <View style={styles.barWrap}>
              <ProgressBar done={done} total={total} />
            </View>
            <ThemedText type="small" style={isComplete ? { color: DONE_COLOR } : undefined}>
              {isComplete
                ? `Onboarding complete${checklist.completedAt ? ` · ${fmtDate(checklist.completedAt)}` : ''}`
                : `${done}/${total} tasks done`}
            </ThemedText>
          </GlassCard>

          {toggleError && <ThemedText style={styles.error}>{toggleError}</ThemedText>}

          {checklist.tasks.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">This checklist has no tasks.</ThemedText>
          ) : (
            checklist.tasks.map((task) => (
              <ThemedView key={task.id} type="backgroundElement" style={styles.row}>
                <Pressable
                  onPress={() => toggle(task)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: task.isDone }}
                  hitSlop={8}
                  style={[
                    styles.checkbox,
                    { borderColor: task.isDone ? DONE_COLOR : theme.textSecondary, backgroundColor: task.isDone ? DONE_COLOR : 'transparent' },
                  ]}>
                  {task.isDone && <ThemedText style={styles.checkMark}>✓</ThemedText>}
                </Pressable>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" style={task.isDone ? styles.struck : undefined}>{task.title}</ThemedText>
                  {task.description ? (
                    <ThemedText type="small" themeColor="textSecondary">{task.description}</ThemedText>
                  ) : null}
                  {task.responsible ? (
                    <ThemedText type="small" themeColor="textSecondary">Responsible: {task.responsible}</ThemedText>
                  ) : null}
                  {task.isDone && task.doneAt ? (
                    <ThemedText type="small" themeColor="textSecondary">Done {fmtDate(task.doneAt)}</ThemedText>
                  ) : null}
                </View>
              </ThemedView>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const allowed = ONBOARDING_ROLES.includes(user?.role ?? '');

  const [items, setItems] = useState<OnboardingOverviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await fetchOnboardingOverview());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load onboarding checklists.'));
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [allowed, load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  if (!allowed) {
    return (
      <View style={[styles.content, styles.flex1]}>
        <Stack.Screen options={{ title: 'Onboarding' }} />
        <ThemedText type="small" themeColor="textSecondary">
          Onboarding is available to Owner, Store Manager, HR and Accounting roles only.
        </ThemedText>
      </View>
    );
  }

  if (selectedUserId) {
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Onboarding' }} />
        <ChecklistDetail
          userId={selectedUserId}
          onBack={() => {
            setSelectedUserId(null);
            load();
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Onboarding' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="small" themeColor="textSecondary">Onboarding checklists currently in progress.</ThemedText>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No onboarding checklists in progress.</ThemedText>
        ) : (
          items.map((c) => (
            <Pressable key={c.id} onPress={() => setSelectedUserId(c.userId)}>
              <ThemedView type="backgroundElement" style={styles.overviewRow}>
                <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{c.user.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                  {c.user.designation || c.user.employeeId || '—'}
                </ThemedText>
                <ProgressBar done={c.completedTasks} total={c.totalTasks} />
                <ThemedText type="small" themeColor="textSecondary">
                  {c.completedTasks}/{c.totalTasks} tasks · started {fmtDate(c.createdAt)}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  spinner: { marginTop: Spacing.three },
  error: { color: '#B83030', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barWrap: { marginVertical: Spacing.two },
  overviewRow: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, minHeight: Layout.minTouchTarget },
  row: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.three },
  checkbox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkMark: { color: '#ffffff', fontWeight: '700', fontSize: 16, lineHeight: 20 },
  struck: { textDecorationLine: 'line-through' },
});
