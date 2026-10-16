import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchMyOvertime, getErrorMessage, setOvertimeActualHours, submitOvertime } from '@/lib/api';
import type { OvertimeRequest } from '@/types/api';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', label: 'Pending' },
  APPROVED: { bg: 'rgba(34,197,94,0.12)', color: '#15803d', label: 'Approved' },
  REJECTED: { bg: 'rgba(239,68,68,0.12)', color: '#b91c1c', label: 'Rejected' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

// Self-view only — GET /overtime/my is scoped by req.user.userId server-side,
// no spoofable param, so there is no client-side role gate to apply here.
export default function OvertimeScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [requests, setRequests] = useState<OvertimeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [actualHoursDraft, setActualHoursDraft] = useState<Record<string, string>>({});
  const [loggingId, setLoggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await fetchMyOvertime());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load your overtime requests.'));
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

  const onSubmit = async () => {
    const requestedHours = Number(hours);
    if (!date || !hours || !reason.trim()) {
      setError('All fields are required.');
      return;
    }
    if (!requestedHours || requestedHours < 0.5 || requestedHours > 12) {
      setError('Hours must be between 0.5 and 12.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitOvertime({ date, requestedHours, reason: reason.trim(), isUrgent });
      setHours('');
      setReason('');
      setIsUrgent(false);
      setNotice('Overtime request submitted successfully.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to submit request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onLogActualHours = (r: OvertimeRequest) => {
    const draft = Number(actualHoursDraft[r.id]);
    if (!draft || draft <= 0) {
      setError('Enter valid hours.');
      return;
    }
    Alert.alert(
      'Update Actual Hours',
      `Enter the actual overtime hours worked on ${fmtDate(r.date)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setLoggingId(r.id);
            setError(null);
            setNotice(null);
            try {
              await setOvertimeActualHours(r.id, draft);
              setActualHoursDraft((prev) => ({ ...prev, [r.id]: '' }));
              setNotice('Actual hours updated. Overtime pay calculated.');
              await load();
            } catch (err: any) {
              setError(getErrorMessage(err, 'Failed to update.'));
            } finally {
              setLoggingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex1}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <Stack.Screen options={{ title: 'Overtime' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <GlassCard>
          <ThemedText type="smallBold">Request overtime</ThemedText>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="next"
          />
          <TextInput
            value={hours}
            onChangeText={setHours}
            placeholder="Requested hours (max 12)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="next"
          />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="done"
          />
          <View style={styles.urgentRow}>
            <ThemedText type="small">Urgent</ThemedText>
            <Switch value={isUrgent} onValueChange={setIsUrgent} accessibilityLabel="Mark this request urgent" />
          </View>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
          <Pressable onPress={onSubmit} disabled={isSubmitting} style={styles.button}>
            {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Submit request</ThemedText>}
          </Pressable>
        </GlassCard>

        {requests === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : requests.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText type="small" themeColor="textSecondary">No overtime requests yet.</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Tap &quot;Request&quot; to submit one.</ThemedText>
          </View>
        ) : (
          (['PENDING', 'APPROVED', 'REJECTED'] as const).map((groupStatus) => {
            const group = requests.filter((r) => r.status === groupStatus);
            if (group.length === 0) return null;
            return (
              <View key={groupStatus}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  {STATUS[groupStatus].label} ({group.length})
                </ThemedText>
                {group.map((r) => (
                  <ThemedView key={r.id} type="backgroundElement" style={styles.row}>
                    <View style={styles.headerRow}>
                      <View style={styles.flex1}>
                        <View style={styles.badgeRow}>
                          <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{fmtDate(r.date)}</ThemedText>
                          {r.isUrgent && (
                            <View style={styles.urgentBadge}>
                              <ThemedText type="small" style={styles.urgentBadgeLabel}>URGENT</ThemedText>
                            </View>
                          )}
                        </View>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} ellipsizeMode="tail">
                          {r.reason}
                        </ThemedText>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: STATUS[r.status].bg }]}>
                        <ThemedText type="small" style={{ color: STATUS[r.status].color }}>{STATUS[r.status].label}</ThemedText>
                      </View>
                    </View>

                    <View style={styles.hoursRow}>
                      <ThemedText type="small" themeColor="textSecondary">{r.requestedHours}h requested</ThemedText>
                      {r.actualHours != null && (
                        <ThemedText type="small" style={styles.actualHoursLabel}>{r.actualHours}h actual</ThemedText>
                      )}
                      {r.overtimePay != null && (
                        <ThemedText type="smallBold" style={styles.overtimePayLabel}>{fmtCurrency(r.overtimePay)} earned</ThemedText>
                      )}
                    </View>

                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <ThemedText type="small" style={styles.error}>Reason: {r.rejectionReason}</ThemedText>
                    )}

                    {r.status === 'APPROVED' && r.actualHours == null && (
                      <View style={styles.logRow}>
                        <TextInput
                          value={actualHoursDraft[r.id] ?? ''}
                          onChangeText={(v) => setActualHoursDraft((prev) => ({ ...prev, [r.id]: v }))}
                          placeholder="e.g. 2.5"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="decimal-pad"
                          style={[styles.logInput, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <Pressable
                          onPress={() => onLogActualHours(r)}
                          disabled={loggingId === r.id}
                          style={styles.logButton}
                        >
                          {loggingId === r.id ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                          ) : (
                            <ThemedText style={styles.buttonLabel}>Log</ThemedText>
                          )}
                        </Pressable>
                      </View>
                    )}

                    <ThemedText type="small" themeColor="textSecondary" style={styles.submittedFooter}>
                      Submitted {fmtDateTime(r.createdAt)}
                    </ThemedText>
                  </ThemedView>
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.two },
  multiline: { height: 80, textAlignVertical: 'top', paddingTop: Spacing.two },
  urgentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
  error: { color: '#B83030', marginTop: Spacing.one },
  notice: { color: '#167A48', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  sectionTitle: { marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  logRow: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.two, alignItems: 'center' },
  logInput: { flex: 1, height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15 },
  logButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  urgentBadge: { backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 999, paddingHorizontal: Spacing.one, paddingVertical: 2 },
  urgentBadgeLabel: { color: '#b91c1c', fontSize: 11, fontWeight: '700' },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 3, borderRadius: 999 },
  hoursRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.one },
  actualHoursLabel: { color: '#22c55e' },
  overtimePayLabel: { color: '#22c55e' },
  submittedFooter: { marginTop: Spacing.one },
  emptyState: { alignItems: 'center', gap: Spacing.half, paddingVertical: Spacing.four },
});
