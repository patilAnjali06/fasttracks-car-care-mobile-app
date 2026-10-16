import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { decideLeaveRequest, fetchLeaveRequests, getErrorMessage, submitLeaveRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { LeaveRequest } from '@/types/api';

// Approval authority: OWNER/STORE_MANAGER/HR. Static requireRoles, not
// override-aware (backend/src/routes/attendance.ts's PUT /leave-requests/:id
// gates on requireHROrOwner = requireRoles('OWNER','STORE_MANAGER','HR'),
// byte-for-byte the same set as LEAVE_APPROVER_ROLES in
// backend/src/lib/leaveRoles.ts, which GET /leave-requests also uses for its
// visibility gate — re-verified 2026-09-21). This is DISTINCT from
// attendance.ts's broader MANAGER_ROLES (which additionally includes
// ACCOUNTING/CASHIER but cannot actually approve leave) — do not reuse that
// list here. See MOBILE_PERMISSIONS_PATTERN.md — this is the static-role
// pattern, not usePermissions(), because the backend gate itself is static.
const LEAVE_APPROVER_ROLES = ['OWNER', 'STORE_MANAGER', 'HR'];

// Matches Prisma's LeaveType enum exactly (backend/prisma/schema.prisma) —
// verified 2026-09-18 after a mismatched first draft (CASUAL/EARNED/UNPAID
// aren't real enum values) caused every submission to fail server-side.
const LEAVE_TYPES = ['SICK', 'PERSONAL', 'EMERGENCY'];

const HISTORY_TABS: { key: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'; label: string }[] = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function statusColor(status: LeaveRequest['status']) {
  if (status === 'APPROVED') return '#167A48';
  if (status === 'REJECTED') return '#B83030';
  return '#A86018';
}

function statusLabel(status: LeaveRequest['status']) {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  return 'Pending';
}

function typeLabel(type: string) {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

export default function LeaveRequestsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const theme = useTheme();
  const isApprover = LEAVE_APPROVER_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [leaveType, setLeaveType] = useState(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [approveTarget, setApproveTarget] = useState<LeaveRequest | null>(null);
  const [approving, setApproving] = useState(false);

  // A page-level `error` line only renders inside the Apply-for-Leave card at
  // the top — invisible once scrolled down to the request list, which is
  // exactly where an approve/reject decision happens. A toast (matching the
  // dashboard's own toast() for this same failure) is visible regardless of
  // scroll position.
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      setRequests(await fetchLeaveRequests(tab));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load leave requests.'));
    }
  }, [tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / tab change
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const onSubmit = async () => {
    if (!leaveType) {
      setError('Leave type is required.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Start and end dates are required.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date cannot be before start date.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await submitLeaveRequest({ leaveType, startDate, endDate, reason: reason.trim(), isHalfDay });
      setReason('');
      setIsHalfDay(false);
      setNotice('Leave request submitted.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not submit the request.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const onApprove = async () => {
    if (!approveTarget) return;
    setApproving(true);
    try {
      await decideLeaveRequest(approveTarget.id, 'APPROVED');
      showToast('Leave request approved.');
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Could not record the decision.'));
    } finally {
      setApproving(false);
      setApproveTarget(null);
      await load();
    }
  };

  const onConfirmReject = async (id: string) => {
    if (!rejectReason.trim()) {
      setError('A rejection reason is required.');
      return;
    }
    setDecidingId(id);
    setError(null);
    try {
      await decideLeaveRequest(id, 'REJECTED', rejectReason.trim());
      setRejectingId(null);
      setRejectReason('');
      showToast('Leave request rejected.');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not record the decision.'));
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <Stack.Screen options={{ title: 'Leave Requests' }} />
      {toast && (
        <View style={[styles.toast, { top: insets.top + Spacing.two }]} pointerEvents="none">
          <ThemedText type="small" style={styles.toastText}>{toast}</ThemedText>
        </View>
      )}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <GlassCard>
          <ThemedText type="smallBold">Apply for Leave</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Leave Type</ThemedText>
          <View style={styles.typeRow}>
            {LEAVE_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => setLeaveType(t)}
                style={[styles.typeChip, { backgroundColor: t === leaveType ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={t === leaveType ? styles.typeChipLabelActive : undefined}>{typeLabel(t)}</ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Day Type</ThemedText>
          <View style={styles.typeRow}>
            <Pressable
              onPress={() => setIsHalfDay(false)}
              style={[styles.typeChip, { backgroundColor: !isHalfDay ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={!isHalfDay ? styles.typeChipLabelActive : undefined}>Full Day</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setIsHalfDay(true)}
              style={[styles.typeChip, { backgroundColor: isHalfDay ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={isHalfDay ? styles.typeChipLabelActive : undefined}>Half Day</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Start Date *</ThemedText>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="next"
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>End Date *</ThemedText>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="next"
          />
          {startDate && endDate && endDate >= startDate && (() => {
            const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
            return (
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                {days} {days === 1 ? 'day' : 'days'}{isHalfDay ? ' (half day each)' : ''}
              </ThemedText>
            );
          })()}

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Reason *</ThemedText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder=""
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="done"
          />
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
          <Pressable onPress={onSubmit} disabled={isSubmitting} style={styles.button}>
            {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Submit</ThemedText>}
          </Pressable>
        </GlassCard>

        <ThemedText type="smallBold" style={styles.sectionTitle}>Leave Requests</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {isApprover ? 'Review and act on leave requests' : 'Apply for leave and track your requests'}
        </ThemedText>

        <View style={styles.tabRow}>
          {HISTORY_TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabChip, { backgroundColor: tab === t.key ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={tab === t.key ? styles.typeChipLabelActive : undefined}>{t.label}</ThemedText>
            </Pressable>
          ))}
        </View>

        {requests === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : requests.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {tab === 'ALL' ? 'No leave requests yet.' : `No ${tab.toLowerCase()} leave requests.`}
          </ThemedText>
        ) : (
          requests.map((r) => (
            <ThemedView key={r.id} type="backgroundElement" style={styles.row}>
              <View style={styles.flex1}>
                {isApprover && (
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{r.user.name}</ThemedText>
                )}
                <ThemedText type={isApprover ? 'small' : 'smallBold'} numberOfLines={1} ellipsizeMode="tail">
                  {typeLabel(r.leaveType)} · {r.startDate.slice(0, 10)} to {r.endDate.slice(0, 10)}{r.isHalfDay ? ' (half day)' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} ellipsizeMode="tail">{r.reason}</ThemedText>
                {r.status !== 'PENDING' && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} ellipsizeMode="tail">
                    {statusLabel(r.status)} by {r.approvedBy?.name ?? '—'}
                    {r.respondedAt ? ` on ${new Date(r.respondedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                    {r.status === 'REJECTED' && r.rejectionReason ? ` — ${r.rejectionReason}` : ''}
                  </ThemedText>
                )}
                {!isApprover && r.status === 'PENDING' && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Submitted {new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </ThemedText>
                )}

                {isApprover && r.status === 'PENDING' && rejectingId === r.id && (
                  <View style={styles.rejectForm}>
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="Why is this being rejected?"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                    />
                    <View style={styles.decideRow}>
                      <Pressable
                        disabled={decidingId === r.id}
                        onPress={() => onConfirmReject(r.id)}
                        style={[styles.decideButton, { backgroundColor: '#B83030' }]}>
                        {decidingId === r.id ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Reject</ThemedText>}
                      </Pressable>
                      <Pressable onPress={() => { setRejectingId(null); setRejectReason(''); }} style={[styles.decideButton, styles.cancelButton]}>
                        <ThemedText type="small">Cancel</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
              {isApprover && r.status === 'PENDING' ? (
                rejectingId === r.id ? null : (
                  <View style={styles.decideRow}>
                    <Pressable
                      disabled={decidingId === r.id}
                      onPress={() => setApproveTarget(r)}
                      style={[styles.decideButton, { backgroundColor: '#167A48' }]}>
                      <ThemedText style={styles.buttonLabel}>Approve</ThemedText>
                    </Pressable>
                    <Pressable
                      disabled={decidingId === r.id}
                      onPress={() => { setRejectingId(r.id); setRejectReason(''); setError(null); }}
                      style={[styles.decideButton, { backgroundColor: '#B83030' }]}>
                      <ThemedText style={styles.buttonLabel}>Reject</ThemedText>
                    </Pressable>
                  </View>
                )
              ) : (
                <ThemedText type="small" style={{ color: statusColor(r.status) }}>{statusLabel(r.status)}</ThemedText>
              )}
            </ThemedView>
          ))
        )}
      </ScrollView>

      {/* Approve confirmation — prevents an accidental tap, matches the
          dashboard's confirm-before-approve modal exactly. */}
      <Modal visible={!!approveTarget} transparent animationType="fade" onRequestClose={() => setApproveTarget(null)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.modalCard}>
            <ThemedText type="subtitle">Approve Leave Request</ThemedText>
            {approveTarget && (
              <ThemedText type="small" style={styles.modalBody}>
                Approve <ThemedText type="smallBold">{approveTarget.user.name}</ThemedText>&apos;s {typeLabel(approveTarget.leaveType).toLowerCase()} leave
                ({approveTarget.startDate.slice(0, 10)} – {approveTarget.endDate.slice(0, 10)})?
              </ThemedText>
            )}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setApproveTarget(null)} style={[styles.decideButton, styles.cancelButton, styles.flex1]}>
                <ThemedText type="small">Cancel</ThemedText>
              </Pressable>
              <Pressable disabled={approving} onPress={onApprove} style={[styles.decideButton, styles.flex1, { backgroundColor: '#167A48' }]}>
                {approving ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Approve</ThemedText>}
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  typeRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  typeChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  typeChipLabelActive: { color: '#ffffff', fontWeight: '600' },
  tabRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  tabChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
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
  decideRow: { gap: Spacing.one },
  decideButton: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  rejectForm: { marginTop: Spacing.one, gap: Spacing.one },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  modalCard: { borderRadius: Spacing.three, padding: Spacing.four, width: '100%', maxWidth: 400, gap: Spacing.three },
  modalBody: { lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: Spacing.two },
  toast: { position: 'absolute', left: Spacing.three, right: Spacing.three, zIndex: 50, backgroundColor: '#323232', borderRadius: Spacing.two, padding: Spacing.two, alignItems: 'center' },
  toastText: { color: '#ffffff' },
});
