import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchApplications, getErrorMessage, setApplicationStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Application, ApplicationStatus } from '@/types/api';

// Whole /applications router is router.use(verifyToken, requireHROrOwner) =
// OWNER/STORE_MANAGER/HR/ACCOUNTING (backend/src/routes/applications.ts,
// middleware/auth.ts) — a static role check, same pattern as onboarding.tsx.
const APPLICATION_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

// Matches the backend's STATUSES array exactly (applications.ts).
const STATUSES: ApplicationStatus[] = ['APPLIED', 'AI_SCREENING', 'AI_INTERVIEW', 'ASSESSMENT', 'MANAGER_INTERVIEW', 'SELECTED', 'REJECTED'];

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  APPLIED: 'Applied',
  AI_SCREENING: 'AI Screening',
  AI_INTERVIEW: 'AI Interview',
  ASSESSMENT: 'Assessment',
  MANAGER_INTERVIEW: 'Manager Interview',
  SELECTED: 'Selected',
  REJECTED: 'Rejected',
};

function statusColor(status: ApplicationStatus) {
  if (status === 'SELECTED') return '#167A48';
  if (status === 'REJECTED') return '#B83030';
  if (status === 'APPLIED') return '#8A8A8E';
  return '#A86018';
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <View style={[styles.badge, { backgroundColor: statusColor(status) }]}>
      <ThemedText type="small" style={styles.badgeLabel}>{STATUS_LABELS[status]}</ThemedText>
    </View>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{String(value)}</ThemedText>
    </View>
  );
}

export default function ApplicationsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const allowed = APPLICATION_ROLES.includes(user?.role ?? '');

  const [filter, setFilter] = useState<ApplicationStatus | null>(null);
  const [items, setItems] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Server returns newest first (orderBy createdAt desc).
      setItems(await fetchApplications(filter ?? undefined));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load applications.'));
    }
  }, [filter]);

  useEffect(() => {
    if (!allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / filter change
    load();
  }, [allowed, load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const patchItem = (id: string, patch: Partial<Application>) =>
    setItems((list) => (list ? list.map((a) => (a.id === id ? { ...a, ...patch } : a)) : list));

  const applyStatus = async (app: Application, next: ApplicationStatus) => {
    const previous = app.status;
    setActionError(null);
    setNotice(null);
    setUpdating(true);
    // Optimistic — revert to the previous status if the server refuses.
    patchItem(app.id, { status: next });
    try {
      const { application, message } = await setApplicationStatus(app.id, next);
      patchItem(app.id, { status: application.status, convertedUserId: application.convertedUserId });
      if (message) setNotice(message);
    } catch (err: any) {
      patchItem(app.id, { status: previous });
      setActionError(getErrorMessage(err, 'Could not update the status.'));
    } finally {
      setUpdating(false);
    }
  };

  const onPickStatus = (app: Application, next: ApplicationStatus) => {
    if (next === app.status || updating) return;
    if (next === 'SELECTED') {
      Alert.alert(
        'Select this applicant?',
        `Marking ${app.name} as Selected creates a candidate record in the Onboarding module, and the application can't be moved to another stage afterwards.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Select', onPress: () => applyStatus(app, next) },
        ],
      );
      return;
    }
    applyStatus(app, next);
  };

  if (!allowed) {
    return (
      <View style={[styles.content, styles.flex1]}>
        <Stack.Screen options={{ title: 'Applications' }} />
        <ThemedText type="small" themeColor="textSecondary">
          Applications is available to Owner, Store Manager, HR and Accounting roles only.
        </ThemedText>
      </View>
    );
  }

  const selected = selectedId ? items?.find((a) => a.id === selectedId) ?? null : null;

  if (selected) {
    const converted = !!selected.convertedUserId;
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Applications' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable
            onPress={() => { setSelectedId(null); setActionError(null); setNotice(null); }}
            style={styles.backLink}>
            <ThemedText type="small">← All applications</ThemedText>
          </Pressable>

          <GlassCard>
            <ThemedText type="smallBold">{selected.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{selected.roleApplied || 'No role specified'}</ThemedText>
            <View style={styles.badgeRow}><StatusBadge status={selected.status} /></View>
            <Field label="Email" value={selected.email} />
            <Field label="Phone" value={selected.phone} />
            <Field label="Department" value={selected.department} />
            <Field label="Date of birth" value={selected.dateOfBirth ? fmtDate(selected.dateOfBirth) : selected.age} />
            <Field label="Fresher" value={selected.fresher === null ? null : selected.fresher ? 'Yes' : 'No'} />
            <Field label="Current address" value={selected.currentAddress} />
            <Field label="Permanent address" value={selected.permanentAddress} />
            <Field label="Notes" value={selected.notes} />
            <Field label="Applied" value={fmtDate(selected.createdAt)} />
            <Field label="Added by" value={selected.createdBy?.name} />
          </GlassCard>

          <ThemedText type="smallBold">Change status</ThemedText>
          {converted ? (
            <ThemedText type="small" themeColor="textSecondary">
              This applicant has been converted to a candidate — track further progress from the Onboarding module.
            </ThemedText>
          ) : (
            <View style={styles.chipRow}>
              {STATUSES.map((s) => (
                <Pressable
                  key={s}
                  disabled={updating}
                  onPress={() => onPickStatus(selected, s)}
                  style={[styles.chip, { backgroundColor: selected.status === s ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={selected.status === s ? styles.chipLabelActive : undefined}>{STATUS_LABELS[s]}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}
          {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Applications' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Pressable onPress={() => setFilter(null)} style={[styles.chip, styles.chipGap, { backgroundColor: filter === null ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={filter === null ? styles.chipLabelActive : undefined}>All</ThemedText>
          </Pressable>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setFilter(s)} style={[styles.chip, styles.chipGap, { backgroundColor: filter === s ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={filter === s ? styles.chipLabelActive : undefined}>{STATUS_LABELS[s]}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

        {error ? (
          <GlassCard>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </GlassCard>
        ) : items === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {filter ? `No ${STATUS_LABELS[filter].toLowerCase()} applications.` : 'No applications yet.'}
          </ThemedText>
        ) : (
          items.map((a) => (
            <Pressable key={a.id} onPress={() => { setSelectedId(a.id); setActionError(null); setNotice(null); }}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{a.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                    {a.roleApplied || 'No role specified'} · {fmtDate(a.createdAt)}
                  </ThemedText>
                </View>
                <StatusBadge status={a.status} />
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
  notice: { color: '#167A48', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipGap: { marginRight: Spacing.one },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four },
  badgeLabel: { color: '#ffffff', fontWeight: '600' },
  badgeRow: { flexDirection: 'row', marginVertical: Spacing.one },
  field: { marginTop: Spacing.one },
});
