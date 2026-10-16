import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { attendanceStatusColor, attendanceStatusLabel } from '@/constants/attendance-status';
import { Spacing } from '@/constants/theme';
import type { AttendanceRecord, ReminderOccurrence, Task, Timesheet } from '@/types/api';

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Each function below is one Home-screen widget card. Kept as plain,
 * independent components (not a generic "widget framework") — attendance.tsx
 * renders them as a simple stack/grid, so a future DASHBOARD_PARITY_PLAN.md
 * module is "write one more widget component + drop it in the render", not a
 * rewrite of the layout.
 */

export function AttendanceWidget({
  record,
  isPunching,
  onClockIn,
}: {
  record: AttendanceRecord | null;
  isPunching: boolean;
  onClockIn: () => void;
}) {
  return (
    <GlassCard>
      <ThemedText type="subtitle" style={{ color: attendanceStatusColor(record?.status), fontSize: 20 }}>
        {attendanceStatusLabel(record?.status)}
      </ThemedText>
      <View style={styles.row}>
        <ThemedText type="smallBold">Clock in</ThemedText>
        <ThemedText>{formatTime(record?.clockIn ?? null)}</ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText type="smallBold">Clock out</ThemedText>
        <ThemedText>{formatTime(record?.clockOut ?? null)}</ThemedText>
      </View>

      {/* Clock-out is device-only (biometric punch) by design — there is no
          manual clock-out control here or anywhere else in the app. */}
      {!record?.clockIn ? (
        <Pressable onPress={onClockIn} disabled={isPunching} style={[styles.button, { opacity: isPunching ? 0.5 : 1 }]}>
          {isPunching ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Clock in</ThemedText>}
        </Pressable>
      ) : !record?.clockOut ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.deviceNote}>
          Clock out at the office device — it isn&apos;t done from the app.
        </ThemedText>
      ) : null}
    </GlassCard>
  );
}

export function MonthHistoryWidget({ history }: { history: AttendanceRecord[] | null }) {
  return (
    <GlassCard>
      <ThemedText type="smallBold">This month</ThemedText>
      {!history || history.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No attendance recorded yet this month.
        </ThemedText>
      ) : (
        history.slice(0, 10).map((r) => (
          <View key={r.date} style={styles.row}>
            <ThemedText type="small">{formatDate(r.date)}</ThemedText>
            <ThemedText type="smallBold" style={{ color: attendanceStatusColor(r.status) }}>
              {attendanceStatusLabel(r.status)}
            </ThemedText>
          </View>
        ))
      )}
    </GlassCard>
  );
}

export function TimesheetWidget({ pendingCount }: { pendingCount: number }) {
  return (
    <Link href="/more/my-timesheet" asChild>
      <Pressable>
        <GlassCard>
          <ThemedText type="smallBold">My Timesheet ›</ThemedText>
          {pendingCount === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing pending this month.
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {pendingCount} entr{pendingCount === 1 ? 'y' : 'ies'} to submit
            </ThemedText>
          )}
        </GlassCard>
      </Pressable>
    </Link>
  );
}

export function RemindersAndTasksWidget({ remindersCount, tasksCount }: { remindersCount: number; tasksCount: number }) {
  return (
    <View style={styles.twoUp}>
      <Link href="/more/reminders" asChild>
        <Pressable style={styles.flex1}>
          <GlassCard>
            <ThemedText type="smallBold">Reminders</ThemedText>
            <ThemedText type="title" style={styles.count}>
              {remindersCount}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              pending
            </ThemedText>
          </GlassCard>
        </Pressable>
      </Link>

      <Link href="/tasks" asChild>
        <Pressable style={styles.flex1}>
          <GlassCard>
            <ThemedText type="smallBold">Tasks</ThemedText>
            <ThemedText type="title" style={styles.count}>
              {tasksCount}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              open
            </ThemedText>
          </GlassCard>
        </Pressable>
      </Link>
    </View>
  );
}

// One-tap Home shortcut for Customers — Tasks already had one via
// RemindersAndTasksWidget above; Customers didn't, despite being an
// equally primary, daily-use module now that the bottom tab bar only has
// Home/Calls. Moving Customers into the tab bar itself would mean
// relocating its route file into the (app) tab group, which risks the
// deep-link paths (including push-notification links) that were
// deliberately preserved by keeping it a root-stack sibling — a plain Home
// shortcut gets the same "no drawer needed" outcome without that risk.
export function CustomersShortcut() {
  return (
    <Link href="/customers" asChild>
      <Pressable>
        <GlassCard style={styles.row}>
          <ThemedText type="smallBold">Customers ›</ThemedText>
        </GlassCard>
      </Pressable>
    </Link>
  );
}

// Re-exported so a future widget can reuse the same helpers without importing
// from the screen file.
export { formatDate, formatTime };
export type { AttendanceRecord, ReminderOccurrence, Task, Timesheet };

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: {
    height: 52,
    borderRadius: Spacing.two,
    backgroundColor: '#7A1C2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  buttonLabel: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  deviceNote: { textAlign: 'center' },
  twoUp: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  count: { fontSize: 28, lineHeight: 32 },
});
