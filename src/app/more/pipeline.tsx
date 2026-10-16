import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchEmployees, fetchJobsPipeline, getErrorMessage, updateJobStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { EmployeeListItem, PipelineJob, PipelineResponse, PipelineStatus } from '@/types/api';

const PRIORITIES: { value: string; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'VIP', label: 'VIP' },
  { value: 'HOT', label: 'Hot' },
];

// GET /jobs/pipeline — requireManagerOrOwner (backend/src/middleware/
// auth.ts:83 = [OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER]). This is a
// Kanban board on the dashboard; mobile renders it as a grouped-by-status
// scrollable list instead of a literal drag-and-drop board, which doesn't
// translate to a phone screen — status change is a "Move to…" picker per
// job instead of a drag gesture, hitting the same PUT /jobs/:id/status
// write (requireJobAccess = [OWNER,STORE_MANAGER,SALES,STAFF,TECHNICIAN] —
// narrower than this screen's own VIEW_ROLES, so the move UI is only shown
// when the signed-in user's role is also in that write-gate list).
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING', 'CASHIER'];
// Intersection of VIEW_ROLES and the write route's requireJobAccess
// ([OWNER,STORE_MANAGER,SALES,STAFF,TECHNICIAN]) — HR/ACCOUNTING/CASHIER
// can view the pipeline but would 403 trying to move a job.
const WRITE_ROLES = ['OWNER', 'STORE_MANAGER'];

const STATUS_ORDER: PipelineStatus[] = [
  'NEW_ENQUIRY', 'QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'FOLLOW_UP_NEEDED', 'COMPLETED', 'CANCELLED',
];

const STATUS_LABEL: Record<PipelineStatus, string> = {
  NEW_ENQUIRY: 'New Enquiry',
  QUOTED: 'Quoted',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In Progress',
  FOLLOW_UP_NEEDED: 'Follow-up Needed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function formatCurrency(n: number | null) {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function PipelineScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const canMove = WRITE_ROLES.includes(user?.role ?? '');

  const [pipeline, setPipeline] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [movingJobId, setMovingJobId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  // Client-side search + filters, same AND-combined logic the dashboard
  // applies over the same unfiltered GET /jobs/pipeline response — no
  // query params on the endpoint, so nothing to send server-side.
  const [search, setSearch] = useState('');
  const [staffList, setStaffList] = useState<EmployeeListItem[]>([]);
  const [staffFilter, setStaffFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [p, staff] = await Promise.all([fetchJobsPipeline(), fetchEmployees()]);
      setPipeline(p);
      setStaffList(staff);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the pipeline.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const matchesFilters = useCallback((job: PipelineJob) => {
    if (staffFilter && job.assignedTo?.id !== staffFilter) return false;
    if (priorityFilter && job.priority !== priorityFilter) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const haystack = [job.customerName, job.vehicleNumber, job.vehicleBrand].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }, [search, staffFilter, priorityFilter]);

  const filteredPipeline = useMemo(() => {
    if (!pipeline) return null;
    const result = {} as PipelineResponse;
    for (const status of STATUS_ORDER) {
      result[status] = (pipeline[status] ?? []).filter(matchesFilters);
    }
    return result;
  }, [pipeline, matchesFilters]);

  const onMoveJob = async (job: PipelineJob, fromStatus: PipelineStatus, toStatus: PipelineStatus) => {
    if (toStatus === fromStatus) { setMovingJobId(null); return; }
    setBusyJobId(job.id);
    setError(null);
    // Optimistic move — same UX intent as the dashboard's drag reorder.
    setPipeline((prev) => {
      if (!prev) return prev;
      const fromJobs = (prev[fromStatus] ?? []).filter((j) => j.id !== job.id);
      const toJobs = [job, ...(prev[toStatus] ?? [])];
      return { ...prev, [fromStatus]: fromJobs, [toStatus]: toJobs };
    });
    setMovingJobId(null);
    try {
      await updateJobStatus(job.id, toStatus);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not move this job.'));
      await load();
    } finally {
      setBusyJobId(null);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Pipeline is only available to Owner, Store Manager, HR, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pipeline' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {pipeline === null || filteredPipeline === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer, vehicle number, brand"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setStaffFilter(null)} style={[styles.chip, { backgroundColor: staffFilter === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={staffFilter === null ? styles.chipLabelActive : undefined}>All staff</ThemedText>
            </Pressable>
            {staffList.map((s) => (
              <Pressable key={s.id} onPress={() => setStaffFilter(s.id)} style={[styles.chip, { backgroundColor: staffFilter === s.id ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={staffFilter === s.id ? styles.chipLabelActive : undefined}>{s.name}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setPriorityFilter(null)} style={[styles.chip, { backgroundColor: priorityFilter === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={priorityFilter === null ? styles.chipLabelActive : undefined}>All priorities</ThemedText>
            </Pressable>
            {PRIORITIES.map((p) => (
              <Pressable key={p.value} onPress={() => setPriorityFilter(p.value)} style={[styles.chip, { backgroundColor: priorityFilter === p.value ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={priorityFilter === p.value ? styles.chipLabelActive : undefined}>{p.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          {STATUS_ORDER.map((status) => {
            const jobs = filteredPipeline[status] ?? [];
            return (
              <View key={status} style={styles.section}>
                <ThemedText type="smallBold">{STATUS_LABEL[status]} ({jobs.length})</ThemedText>
                {jobs.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">No jobs.</ThemedText>
                ) : (
                  jobs.map((job) => (
                    <ThemedView key={job.id} type="backgroundElement" style={styles.row}>
                      <ThemedText type="smallBold">{job.customerName}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {[job.vehicleBrand, job.vehicleModel, job.vehicleNumber].filter(Boolean).join(' · ') || 'No vehicle'}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatCurrency(job.finalAmount ?? job.quotedAmount)} · {job.paymentStatus}
                        {job.assignedTo ? ` · ${job.assignedTo.name}` : ''}
                      </ThemedText>
                      {canMove && (
                        movingJobId === job.id ? (
                          <View style={styles.chipScrollerInline}>
                            {STATUS_ORDER.filter((s) => s !== status).map((s) => (
                              <Pressable key={s} onPress={() => onMoveJob(job, status, s)} disabled={busyJobId === job.id} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                                <ThemedText type="small">{STATUS_LABEL[s]}</ThemedText>
                              </Pressable>
                            ))}
                            <Pressable onPress={() => setMovingJobId(null)} style={styles.chip}>
                              <ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable onPress={() => setMovingJobId(job.id)} disabled={busyJobId === job.id}>
                            {busyJobId === job.id ? <ActivityIndicator size="small" /> : <ThemedText type="link">Move to…</ThemedText>}
                          </Pressable>
                        )
                      )}
                    </ThemedView>
                  ))
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  section: { gap: Spacing.two },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  chipScroller: { flexDirection: 'row' },
  chipScrollerInline: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, marginRight: Spacing.one },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
});
