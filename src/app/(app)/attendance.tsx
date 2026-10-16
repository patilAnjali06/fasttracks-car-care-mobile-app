import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HERO_EXPANDED_HEIGHT, HeroHeader } from '@/components/home/hero-header';
import {
  AttendanceWidget,
  CustomersShortcut,
  MonthHistoryWidget,
  RemindersAndTasksWidget,
  TimesheetWidget,
} from '@/components/home/widgets';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  clockIn,
  fetchMyMonthlyAttendance,
  fetchMyMonthTimesheets,
  fetchMyReminders,
  fetchMyTasks,
  fetchTodayAttendance,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AttendanceRecord, ReminderOccurrence, Task, Timesheet } from '@/types/api';

function formatTime(iso: string | null) {
  if (!iso) return 'Not clocked in yet';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Home screen — rebuilt from a single flat list into a widget dashboard
 * (Part 4a of the nav redesign) behind a collapsing glass hero (Part 4c).
 * Data loading, role-scoping (Promise.allSettled per section so one denied
 * endpoint doesn't blank the rest), clock-in-only control, and the 2026-08
 * status-color fixes are carried over unchanged from the previous
 * attendance.tsx — only the presentation changed.
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [history, setHistory] = useState<AttendanceRecord[] | null>(null);
  const [timesheets, setTimesheets] = useState<Timesheet[] | null>(null);
  const [reminders, setReminders] = useState<ReminderOccurrence[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPunching, setIsPunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollY = useSharedValue(0);

  const load = useCallback(async () => {
    setError(null);
    const now = new Date();
    const [todayResult, historyResult, timesheetResult, reminderResult, taskResult] = await Promise.allSettled([
      fetchTodayAttendance(),
      fetchMyMonthlyAttendance(now.getMonth() + 1, now.getFullYear(), user?.id),
      fetchMyMonthTimesheets(now.getMonth() + 1, now.getFullYear()),
      fetchMyReminders(),
      fetchMyTasks(),
    ]);

    if (todayResult.status === 'fulfilled') {
      setRecord(todayResult.value.find((r) => r.userId === user?.id) ?? todayResult.value[0] ?? null);
    }
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    if (timesheetResult.status === 'fulfilled') setTimesheets(timesheetResult.value);
    else setTimesheets([]); // e.g. 403 for a role that can't use timesheets at all
    if (reminderResult.status === 'fulfilled') setReminders(reminderResult.value);
    if (taskResult.status === 'fulfilled') setTasks(taskResult.value);

    if (todayResult.status === 'rejected') {
      setError(todayResult.reason?.response?.data?.message ?? 'Could not load today’s attendance.');
    }
  }, [user?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load().finally(() => setIsLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const onPunch = async () => {
    setIsPunching(true);
    setError(null);
    try {
      const updated = await clockIn();
      setRecord(updated);
      setHistory((prev) => {
        if (!prev) return prev;
        const others = prev.filter((r) => r.date !== updated.date);
        return [updated, ...others].sort((a, b) => (a.date < b.date ? 1 : -1));
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not clock in.');
    } finally {
      setIsPunching(false);
    }
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  if (isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const pendingReminders = (reminders ?? []).filter((r) => r.status === 'PENDING' || r.status === 'SNOOZED');
  const openTasks = (tasks ?? []).filter((t) => t.status === 'PENDING' || t.status === 'ONGOING');
  const pendingTimesheets = (timesheets ?? []).filter((t) => t.status === 'DRAFT' || t.status === 'SUBMITTED');

  return (
    <ThemedView style={styles.container}>
      <HeroHeader
        scrollY={scrollY}
        record={record}
        clockInTime={formatTime(record?.clockIn ?? null)}
        onPressStatus={() => {
          /* Same screen — hero already sits above the detail widgets. */
        }}
      />
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          { paddingTop: HERO_EXPANDED_HEIGHT + insets.top + Spacing.three },
        ]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
        <ThemedText type="small" themeColor="textSecondary">
          Hi {user?.name ?? 'there'} · {user?.role}
        </ThemedText>

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <AttendanceWidget record={record} isPunching={isPunching} onClockIn={onPunch} />
        <MonthHistoryWidget history={history} />
        <TimesheetWidget pendingCount={pendingTimesheets.length} />
        <RemindersAndTasksWidget remindersCount={pendingReminders.length} tasksCount={openTasks.length} />
        <CustomersShortcut />
      </Animated.ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  error: { color: '#B83030' },
});
