import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchCallCapabilities,
  fetchCustomerJobs,
  fetchCustomerProfile,
  fetchEmployees,
  getErrorMessage,
  initiateCall,
  markJobCardWalkout,
  reassignJobCard,
  updateJobCardStatus,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import type { CustomerProfile, EmployeeListItem, JobCard, JobCardStatus } from '@/types/api';

// Status/walkout/reassign actions added 2026-09-24 (full-parity pass) —
// job cards were previously view-only here. Gated by getCJMode's
// view_only/sales_mode/full_access modes (backend/src/routes/
// job_cards.ts), mirrored via usePermissions().tabMode('customers_jobs'),
// same dynamic-permission pattern already used for invoices/CRM. Reassign
// is additionally OWNER/STORE_MANAGER-only server-side. RELEASED requires
// an already-fully-paid invoice and READY requires a job-card list already
// printed — both enforced server-side; a failure surfaces via
// getErrorMessage rather than being predicted client-side.
const WALKOUT_REASONS: { value: string; label: string }[] = [
  { value: 'PRICE_TOO_HIGH', label: 'Price Too High' },
  { value: 'THINKING_IT_OVER', label: 'Thinking It Over' },
  { value: 'WENT_ELSEWHERE', label: 'Went Elsewhere' },
  { value: 'SERVICE_NOT_OFFERED', label: 'Service Not Offered' },
  { value: 'WAIT_TOO_LONG', label: 'Wait Too Long' },
  { value: 'OTHER', label: 'Other' },
];

const JOB_STATUS_COLOR: Record<JobCardStatus, string> = {
  IN_PROGRESS: '#3278B0',
  READY: '#167A48',
  RELEASED: '#5A5A6A',
  WALKED_OUT: '#B83030',
};

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { tabMode } = usePermissions();
  const cjMode = tabMode('customers_jobs');
  const canWrite = cjMode !== null && cjMode !== 'view_only';
  const canReassign = ['OWNER', 'STORE_MANAGER'].includes(user?.role ?? '');

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [jobs, setJobs] = useState<JobCard[] | null>(null);
  const [canCall, setCanCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [walkoutJobId, setWalkoutJobId] = useState<string | null>(null);
  const [walkoutReason, setWalkoutReason] = useState('');
  const [walkoutNote, setWalkoutNote] = useState('');
  const [reassignJobId, setReassignJobId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profileResult, jobsResult] = await Promise.all([fetchCustomerProfile(id), fetchCustomerJobs(id)]);
      setProfile(profileResult);
      setJobs(jobsResult);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load this customer.'));
    }
    fetchCallCapabilities()
      .then((caps) => setCanCall(caps.canInitiate))
      .catch(() => setCanCall(false));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onCall = async () => {
    setIsCalling(true);
    setError(null);
    try {
      await initiateCall(id);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not start that call.'));
    } finally {
      setIsCalling(false);
    }
  };

  const onSetStatus = (jobId: string, status: JobCardStatus) => {
    Alert.alert(
      status === 'READY' ? 'Mark ready?' : 'Release car?',
      status === 'READY' ? 'The customer will be notified this vehicle is ready.' : 'This releases the vehicle to the customer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status === 'READY' ? 'Mark ready' : 'Release',
          onPress: async () => {
            setBusyJobId(jobId);
            setError(null);
            try {
              await updateJobCardStatus(jobId, status);
              await load();
            } catch (err: any) {
              setError(getErrorMessage(err, 'Could not update this job.'));
            } finally {
              setBusyJobId(null);
            }
          },
        },
      ]
    );
  };

  const onConfirmWalkout = async (jobId: string) => {
    if (!walkoutReason) return;
    setBusyJobId(jobId);
    setError(null);
    try {
      await markJobCardWalkout(jobId, walkoutReason, walkoutNote.trim() || undefined);
      setWalkoutJobId(null);
      setWalkoutReason('');
      setWalkoutNote('');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not mark this job walked out.'));
    } finally {
      setBusyJobId(null);
    }
  };

  const openReassign = async (jobId: string) => {
    setReassignJobId(jobId);
    if (!employees) {
      try { setEmployees(await fetchEmployees()); } catch (err: any) { setError(getErrorMessage(err, 'Could not load the employee list.')); }
    }
  };

  const onReassign = async (jobId: string, handledById: string) => {
    setBusyJobId(jobId);
    setError(null);
    try {
      await reassignJobCard(jobId, handledById);
      setReassignJobId(null);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not reassign this job.'));
    } finally {
      setBusyJobId(null);
    }
  };

  if (!profile) {
    return (
      <ThemedView style={styles.center}>
        {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
      </ThemedView>
    );
  }

  const { customer, stats, vehicles } = profile;

  return (
    <>
      <Stack.Screen options={{ title: customer.name }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.title}>
              {customer.name}
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              {customer.phone}
              {customer.email ? ` · ${customer.email}` : ''}
            </ThemedText>
          </View>
          {canCall && (
            <Pressable onPress={onCall} disabled={isCalling} style={styles.callButton}>
              {isCalling ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.callLabel}>Call</ThemedText>}
            </Pressable>
          )}
        </View>

        <ThemedView type="backgroundElement" style={styles.statsCard}>
          <View style={styles.statRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Total spent
            </ThemedText>
            <ThemedText type="smallBold">{formatCurrency(stats.totalSpent)}</ThemedText>
          </View>
          <View style={styles.statRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Visits
            </ThemedText>
            <ThemedText type="smallBold">{stats.visitCount}</ThemedText>
          </View>
          <View style={styles.statRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Outstanding
            </ThemedText>
            <ThemedText type="smallBold">{formatCurrency(stats.outstandingAmount)}</ThemedText>
          </View>
          <View style={styles.statRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Customer since
            </ThemedText>
            <ThemedText type="smallBold">{formatDate(stats.customerSince)}</ThemedText>
          </View>
        </ThemedView>

        {vehicles.length > 0 && (
          <View style={styles.section}>
            <ThemedText type="smallBold">Vehicles</ThemedText>
            {vehicles.map((v) => (
              <ThemedText key={v.registration} themeColor="textSecondary">
                {v.registration} — {[v.make, v.model].filter(Boolean).join(' ') || 'Unknown model'}
              </ThemedText>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <ThemedText type="smallBold">Jobs</ThemedText>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {jobs?.length === 0 && (
            <ThemedText themeColor="textSecondary">No job cards for this customer yet.</ThemedText>
          )}
          {jobs?.map((job) => (
            <ThemedView key={job.id} type="backgroundElement" style={styles.jobRow}>
              <Pressable onPress={() => router.push(`/customers/job/${job.id}`)}>
                <View style={styles.jobTop}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.jobTitle}>
                    {job.reasonForVisit}
                  </ThemedText>
                  <View style={[styles.statusPill, { backgroundColor: JOB_STATUS_COLOR[job.status] }]}>
                    <ThemedText type="small" style={styles.statusText}>
                      {job.status.replace('_', ' ')}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {job.jobNumber} · {job.vehicle?.vehicleNumber ?? 'No vehicle'} · {formatDate(job.createdAt)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">Handled by {job.handledBy.name}</ThemedText>
                <ThemedText type="link">View details ›</ThemedText>
              </Pressable>

              {canWrite && job.status !== 'RELEASED' && job.status !== 'WALKED_OUT' && (
                walkoutJobId === job.id ? (
                  <View style={styles.actionBlock}>
                    <ThemedText type="small" themeColor="textSecondary">Why did the customer walk out?</ThemedText>
                    <View style={styles.chipRow}>
                      {WALKOUT_REASONS.map((r) => (
                        <Pressable
                          key={r.value}
                          onPress={() => setWalkoutReason(r.value)}
                          disabled={busyJobId === job.id}
                          style={[styles.chip, { backgroundColor: walkoutReason === r.value ? theme.primary : undefined }]}
                        >
                          <ThemedText type="small" style={walkoutReason === r.value ? styles.chipLabelActive : undefined}>{r.label}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={walkoutNote}
                      onChangeText={setWalkoutNote}
                      placeholder="Optional note..."
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                    />
                    <View style={styles.jobActions}>
                      <Pressable onPress={() => onConfirmWalkout(job.id)} disabled={busyJobId === job.id || !walkoutReason}>
                        <ThemedText type="link">{busyJobId === job.id ? '…' : 'Confirm Walked Out'}</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => { setWalkoutJobId(null); setWalkoutReason(''); setWalkoutNote(''); }}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                    </View>
                  </View>
                ) : reassignJobId === job.id ? (
                  <View style={styles.actionBlock}>
                    <ThemedText type="small" themeColor="textSecondary">Reassign to</ThemedText>
                    {employees === null ? (
                      <ActivityIndicator />
                    ) : (
                      <View style={styles.chipRow}>
                        {employees.map((e) => (
                          <Pressable key={e.id} onPress={() => onReassign(job.id, e.id)} disabled={busyJobId === job.id} style={styles.chip}>
                            <ThemedText type="small">{e.name}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <Pressable onPress={() => setReassignJobId(null)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                  </View>
                ) : (
                  <View style={styles.jobActions}>
                    {busyJobId === job.id ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <>
                        {job.status === 'IN_PROGRESS' && (
                          <Pressable onPress={() => onSetStatus(job.id, 'READY')}><ThemedText type="link">Mark Ready for Pickup</ThemedText></Pressable>
                        )}
                        {job.status === 'READY' && (
                          <Pressable onPress={() => onSetStatus(job.id, 'RELEASED')}><ThemedText type="link">Release Car</ThemedText></Pressable>
                        )}
                        <Pressable onPress={() => setWalkoutJobId(job.id)}><ThemedText type="link">Walked Out?</ThemedText></Pressable>
                        {canReassign && (
                          <Pressable onPress={() => openReassign(job.id)}><ThemedText type="link">Reassign</ThemedText></Pressable>
                        )}
                      </>
                    )}
                  </View>
                )
              )}
            </ThemedView>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  headerText: { flex: 1 },
  callButton: {
    paddingHorizontal: Spacing.three,
    height: 40,
    borderRadius: Spacing.two,
    backgroundColor: '#167A48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callLabel: { color: '#ffffff', fontWeight: '600' },
  title: { fontSize: 28, lineHeight: 34 },
  statsCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { gap: Spacing.one },
  jobRow: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  jobTitle: { flex: 1 },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  statusText: { color: '#ffffff' },
  error: { color: '#B83030' },
  jobActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.one },
  actionBlock: { marginTop: Spacing.one, gap: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.2)' },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  input: { height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15 },
});
