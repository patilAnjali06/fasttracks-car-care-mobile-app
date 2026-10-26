import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccessCard, ACCESS_ACTION_LABELS, ACTION_LOG_LABELS, ActionCard, DateFilter } from '@/components/audit-trail/audit-ui';
import { GlassCard } from '@/components/home/glass-card';
import { SelectField } from '@/components/meta-ads/ads-ui';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchActionLog, fetchDocumentAccessLog, fetchEmployees, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { ActionLogEntry, DocumentAccessEntry } from '@/types/api';

// Read-only. The action-log and identity-documents/views routes are
// requireHROrOwner = OWNER/STORE_MANAGER/HR/ACCOUNTING, and the dashboard page
// is those four roles only (no hr_module override — it carries ID-number and
// approval data), so this is a static role check, same as onboarding.tsx.
const AUDIT_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

// The server caps both logs at 200 rows, newest first.
const SERVER_CAP = 200;

type TabKey = 'documents' | 'actions';
type Person = { id: string; name: string };

function Filters({ children, onClear, show }: { children: React.ReactNode; onClear: () => void; show: boolean }) {
  const theme = useTheme();
  return (
    <GlassCard>
      <View style={styles.filters}>{children}</View>
      {show && (
        <Pressable onPress={onClear} hitSlop={8} style={styles.clear}>
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: '600' }}>Clear filters</ThemedText>
        </Pressable>
      )}
    </GlassCard>
  );
}

function ListState({ error, retry, rows, empty, cap, capLabel, children }: {
  error: string | null; retry: () => void; rows: unknown[] | null; empty: string; capLabel: string; cap: number; children: React.ReactNode;
}) {
  if (error) {
    return (
      <GlassCard>
        <ThemedText style={styles.error}>{error}</ThemedText>
        <Pressable onPress={retry} style={styles.retry}>
          <ThemedText style={styles.btnLabel}>Retry</ThemedText>
        </Pressable>
      </GlassCard>
    );
  }
  if (rows === null) return <ActivityIndicator style={styles.spinner} />;
  if (rows.length === 0) return <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>{empty}</ThemedText>;
  return (
    <>
      {children}
      {rows.length >= cap && (
        <ThemedText type="small" themeColor="textSecondary">
          Showing the most recent {cap} matching {capLabel} — narrow the filters to see older ones.
        </ThemedText>
      )}
    </>
  );
}

// "Document Access Log" — every document view / reveal.
function DocumentAccessLog({ employees, refreshSignal, onSettled }: { employees: Person[]; refreshSignal: number; onSettled: () => void }) {
  const [employeeId, setEmployeeId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('all');
  const [rows, setRows] = useState<DocumentAccessEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchDocumentAccessLog({
        employeeId: employeeId === 'all' ? undefined : employeeId,
        from: from || undefined,
        to: to || undefined,
        action: action === 'all' ? undefined : action,
      }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to fetch audit log.'));
    } finally {
      onSettled();
    }
  }, [employeeId, from, to, action, onSettled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / filter change / pull-to-refresh
    load();
  }, [load, refreshSignal]);

  const filtersOn = employeeId !== 'all' || !!from || !!to || action !== 'all';
  const clear = () => { setEmployeeId('all'); setFrom(''); setTo(''); setAction('all'); };

  return (
    <View style={styles.stack}>
      <Filters show={filtersOn} onClear={clear}>
        <SelectField label="Employee" value={employeeId} onChange={setEmployeeId}
          options={[{ v: 'all', t: 'All employees' }, ...employees.map((e) => ({ v: e.id, t: e.name }))]} />
        <View style={styles.dates}>
          <DateFilter label="From" value={from} onChange={setFrom} />
          <DateFilter label="To" value={to} onChange={setTo} />
        </View>
        <SelectField label="Action" value={action} onChange={setAction}
          options={[{ v: 'all', t: 'All actions' }, ...Object.entries(ACCESS_ACTION_LABELS).map(([v, t]) => ({ v, t }))]} />
      </Filters>
      <ListState error={error} retry={load} rows={rows} empty="No document access events match these filters." cap={SERVER_CAP} capLabel="events">
        {(rows ?? []).map((r) => <AccessCard key={r.id} row={r} />)}
      </ListState>
    </View>
  );
}

// "Action Log" — every hiring / discipline / letter decision HR made.
function ActionLog({ employees, refreshSignal, onSettled }: { employees: Person[]; refreshSignal: number; onSettled: () => void }) {
  const [employeeId, setEmployeeId] = useState('all');
  const [actorId, setActorId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actionType, setActionType] = useState('all');
  const [rows, setRows] = useState<ActionLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await fetchActionLog({
        employeeId: employeeId === 'all' ? undefined : employeeId,
        actorId: actorId === 'all' ? undefined : actorId,
        from: from || undefined,
        to: to || undefined,
        actionType: actionType === 'all' ? undefined : actionType,
      }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to fetch action log.'));
    } finally {
      onSettled();
    }
  }, [employeeId, actorId, from, to, actionType, onSettled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / filter change / pull-to-refresh
    load();
  }, [load, refreshSignal]);

  const people = employees.map((e) => ({ v: e.id, t: e.name }));
  const filtersOn = employeeId !== 'all' || actorId !== 'all' || !!from || !!to || actionType !== 'all';
  const clear = () => { setEmployeeId('all'); setActorId('all'); setFrom(''); setTo(''); setActionType('all'); };

  return (
    <View style={styles.stack}>
      <Filters show={filtersOn} onClear={clear}>
        <SelectField label="Employee / Candidate" value={employeeId} onChange={setEmployeeId} options={[{ v: 'all', t: 'Everyone' }, ...people]} />
        <SelectField label="Actor (HR staff)" value={actorId} onChange={setActorId} options={[{ v: 'all', t: 'Anyone' }, ...people]} />
        <View style={styles.dates}>
          <DateFilter label="From" value={from} onChange={setFrom} />
          <DateFilter label="To" value={to} onChange={setTo} />
        </View>
        <SelectField label="Action type" value={actionType} onChange={setActionType}
          options={[{ v: 'all', t: 'All actions' }, ...Object.entries(ACTION_LOG_LABELS).map(([v, t]) => ({ v, t }))]} />
      </Filters>
      <ListState error={error} retry={load} rows={rows} empty="No HR actions match these filters." cap={SERVER_CAP} capLabel="actions">
        {(rows ?? []).map((r) => <ActionCard key={r.id} row={r} />)}
      </ListState>
    </View>
  );
}

export default function AuditTrailScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const allowed = AUDIT_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<TabKey>('documents');
  const [employees, setEmployees] = useState<Person[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    // The pickers are a convenience — if the employee list can't load they stay
    // empty (as on the dashboard) and the logs still work unfiltered.
    fetchEmployees()
      .then((list) => setEmployees(list.filter((e) => e.isActive).map((e) => ({ id: e.id, name: e.name }))))
      .catch(() => setEmployees([]));
  }, [allowed]);

  const onSettled = useCallback(() => setIsRefreshing(false), []);
  const onRefresh = () => { setIsRefreshing(true); setRefreshSignal((n) => n + 1); };

  if (!allowed) {
    return (
      <View style={[styles.content, styles.flex1]}>
        <Stack.Screen options={{ title: 'Audit Trail' }} />
        <ThemedText type="small" themeColor="textSecondary">
          Audit Trail is available to Owner, Store Manager, HR and Accounting roles only.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Audit Trail' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="small" themeColor="textSecondary">
          Document Access Log — every document view/reveal — and the HR Action Log — every hiring/discipline/letter decision HR made.
        </ThemedText>

        <View style={styles.tabs}>
          {([['documents', 'Document Access Log'], ['actions', 'Action Log']] as [TabKey, string][]).map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, { backgroundColor: tab === key ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={tab === key ? styles.tabActive : undefined}>{label}</ThemedText>
            </Pressable>
          ))}
        </View>

        {tab === 'documents'
          ? <DocumentAccessLog employees={employees} refreshSignal={refreshSignal} onSettled={onSettled} />
          : <ActionLog employees={employees} refreshSignal={refreshSignal} onSettled={onSettled} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  tabs: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  tab: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.four },
  tabActive: { color: '#ffffff', fontWeight: '600' },
  stack: { gap: Layout.cardGap },
  filters: { gap: Spacing.three },
  dates: { flexDirection: 'row', gap: Spacing.two },
  clear: { alignSelf: 'flex-start', marginTop: Spacing.three },
  spinner: { marginTop: Spacing.three },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  error: { color: '#B83030' },
  retry: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  btnLabel: { color: '#ffffff', fontWeight: '600' },
});
