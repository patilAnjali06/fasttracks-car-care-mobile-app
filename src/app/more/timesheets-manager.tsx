import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
import {
  approveTimesheet,
  assignTimesheetEntryTask,
  deleteTimesheetEntryAttachment,
  fetchTimesheetAttachmentDataUri,
  fetchTimesheetDetail,
  fetchTimesheetExportDataUri,
  fetchTimesheetRegister,
  getErrorMessage,
  linkTimesheetEntryContact,
  rejectTimesheet,
  replyToTimesheetEntry,
  searchWorkDocs,
  unlinkTimesheetEntryContact,
  uploadTimesheetEntryAttachment,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { ContactType, TimesheetDetail, TimesheetRegister, WorkDocumentation } from '@/types/api';

// CORRECTED 2026-09-28 (re-verification sweep): this screen's page-access
// gate was wrongly copied from the shared middleware/auth.ts
// requireManagerOrOwner = [OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER].
// The routes this screen actually depends on — GET /timesheets/register,
// GET /timesheets/summary, GET /timesheets/export — are gated by a
// DIFFERENT, narrower requireManagerOrOwner defined locally in
// backend/src/routes/timesheets.ts (MANAGER_ROLES=[OWNER,STORE_MANAGER]
// only, same array approve/reject/assign already used). HR/ACCOUNTING/
// CASHIER used to see this screen's chrome but every data call 403'd —
// matching the dashboard's own page.tsx client gate, which is also
// OWNER/STORE_MANAGER-only. Page access, approve/reject, and Assign Task
// now share one MANAGER_ROLES=[OWNER,STORE_MANAGER] constant. Reply and
// attachments stay open to the timesheet's owner OR any MANAGER_ROLES
// member (canAccessTimesheet) — narrower than the whole-router
// BLOCKED_ROLES=[TECHNICIAN,STAFF] check, which this screen's own
// MANAGER_ROLES gate already satisfies by construction.
// Export Excel (GET /timesheets/export, a real .xlsx via XLSX.write server-
// side, not CSV) and global doc search (GET /work-docs/search, cross-
// employee, distinct from the per-timesheet GET /work-docs/timesheet/:id
// this screen's detail view already uses) added 2026-09-24 (full-parity
// pass). Inline remark shortcut was already covered — this screen's
// per-entry reply composer (replyToTimesheetEntry) predates this pass.
// "Copy-list" (copying the not-submitted roster to clipboard) is NOT
// built — no clipboard package (expo-clipboard or similar) is installed
// in this project; flagged per the hard-stop rule, not silently skipped.
const MANAGER_ROLES = ['OWNER', 'STORE_MANAGER'];
const DECIDE_ROLES = ['OWNER', 'STORE_MANAGER'];

const UPLOAD_RULES = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  maxSizeBytes: 15 * 1024 * 1024,
};

const CONTACT_TYPES: { key: ContactType; label: string }[] = [
  { key: 'CUSTOMER', label: 'Customer' },
  { key: 'VENDOR_SERVICE_PROVIDER', label: 'Vendor / Service' },
  { key: 'STAFF', label: 'Staff' },
  { key: 'OTHER', label: 'Other' },
];

// Verbatim from the dashboard's REGISTER_STATUS map (frontend/src/app/
// (dashboard)/dashboard/timesheets/page.tsx), field-level parity pass
// 2026-09-25.
const STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'Not Submitted',
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function statusColor(status: string) {
  if (status === 'APPROVED') return '#167A48';
  if (status === 'REJECTED') return '#B83030';
  if (status === 'SUBMITTED') return '#A86018';
  return '#8A8A8E';
}

function last7DaysRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function TimesheetsManagerScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = MANAGER_ROLES.includes(user?.role ?? '');
  const canDecide = DECIDE_ROLES.includes(user?.role ?? '');

  const [register, setRegister] = useState<TimesheetRegister | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Global doc search — cross-employee, GET /work-docs/search
  const [showDocSearch, setShowDocSearch] = useState(false);
  const [docQuery, setDocQuery] = useState('');
  const [docResults, setDocResults] = useState<WorkDocumentation[] | null>(null);
  const [docSearchError, setDocSearchError] = useState<string | null>(null);
  const [isSearchingDocs, setIsSearchingDocs] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TimesheetDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isDeciding, setIsDeciding] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [sendingReplyFor, setSendingReplyFor] = useState<string | null>(null);
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const [assigningFor, setAssigningFor] = useState<string | null>(null);
  const [activeUploadEntryId, setActiveUploadEntryId] = useState<string | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [contactFormEntryId, setContactFormEntryId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactType, setContactType] = useState<ContactType>('CUSTOMER');
  const [contactName, setContactName] = useState('');
  const [contactReason, setContactReason] = useState('');
  const [isLinkingContact, setIsLinkingContact] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const upload = useFileUpload(UPLOAD_RULES);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const { from, to } = last7DaysRange();
      setRegister(await fetchTimesheetRegister(from, to));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the timesheet register.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    if (selectedId) await loadDetail(selectedId);
    else await load();
    setIsRefreshing(false);
  };

  const loadDetail = async (id: string) => {
    setIsLoadingDetail(true);
    setDetailError(null);
    try {
      setDetail(await fetchTimesheetDetail(id));
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not load this timesheet.'));
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const onOpen = (id: string) => {
    setSelectedId(id);
    setDetail(null);
    upload.reset();
    setActiveUploadEntryId(null);
    setContactFormEntryId(null);
    loadDetail(id);
  };

  const onApprove = () => {
    if (!selectedId) return;
    Alert.alert('Approve this timesheet?', 'The employee will be notified.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setIsDeciding(true);
          setDetailError(null);
          try {
            await approveTimesheet(selectedId);
            await loadDetail(selectedId);
            await load();
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not approve this timesheet.'));
          } finally {
            setIsDeciding(false);
          }
        },
      },
    ]);
  };

  const onReject = () => {
    if (!selectedId || !rejectReason.trim()) {
      setDetailError('Enter a rejection reason.');
      return;
    }
    Alert.alert('Reject this timesheet?', 'The employee will be notified and can resubmit.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setIsRejecting(true);
          setDetailError(null);
          try {
            await rejectTimesheet(selectedId, rejectReason.trim());
            setRejectReason('');
            await loadDetail(selectedId);
            await load();
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not reject this timesheet.'));
          } finally {
            setIsRejecting(false);
          }
        },
      },
    ]);
  };

  const onSendReply = async (entryId: string) => {
    if (!selectedId) return;
    const message = replyDrafts[entryId]?.trim();
    if (!message) return;
    setSendingReplyFor(entryId);
    setDetailError(null);
    try {
      await replyToTimesheetEntry(selectedId, entryId, message);
      setReplyDrafts((prev) => ({ ...prev, [entryId]: '' }));
      await loadDetail(selectedId);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not send the reply.'));
    } finally {
      setSendingReplyFor(null);
    }
  };

  const onAssignTask = async (entryId: string) => {
    if (!selectedId) return;
    const message = assignDrafts[entryId]?.trim();
    if (!message) return;
    setAssigningFor(entryId);
    setDetailError(null);
    try {
      await assignTimesheetEntryTask(selectedId, entryId, message);
      setAssignDrafts((prev) => ({ ...prev, [entryId]: '' }));
      await loadDetail(selectedId);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not assign the task.'));
    } finally {
      setAssigningFor(null);
    }
  };

  const onPickCamera = async (entryId: string) => {
    const file = await pickFromCamera();
    if (!file) return;
    setActiveUploadEntryId(entryId);
    upload.pick(file);
  };
  const onPickGallery = async (entryId: string) => {
    const file = await pickFromGallery();
    if (!file) return;
    setActiveUploadEntryId(entryId);
    upload.pick(file);
  };

  const doUploadAttachment = () => {
    if (!selectedId || !activeUploadEntryId) return;
    const entryId = activeUploadEntryId;
    return upload.upload((file, ctrl) => uploadTimesheetEntryAttachment(selectedId, entryId, file, ctrl)).then((result) => {
      if (result) {
        upload.reset();
        setActiveUploadEntryId(null);
        loadDetail(selectedId);
      }
    });
  };

  const onOpenAttachment = async (attachmentId: string, mimeType: string) => {
    setOpeningAttachmentId(attachmentId);
    setDetailError(null);
    try {
      const dataUri = await fetchTimesheetAttachmentDataUri(attachmentId, mimeType);
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not open the attachment.'));
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const onDeleteAttachment = (attachmentId: string, filename: string) => {
    Alert.alert('Delete this attachment?', `This permanently removes "${filename}". This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!selectedId) return;
          setDeletingAttachmentId(attachmentId);
          setDetailError(null);
          try {
            await deleteTimesheetEntryAttachment(attachmentId);
            await loadDetail(selectedId);
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not delete the attachment.'));
          } finally {
            setDeletingAttachmentId(null);
          }
        },
      },
    ]);
  };

  const onOpenContactForm = (entryId: string) => {
    setContactFormEntryId(entryId);
    setContactPhone('');
    setContactType('CUSTOMER');
    setContactName('');
    setContactReason('');
    setDetailError(null);
  };

  const onLinkContact = async (entryId: string) => {
    if (!selectedId || !contactPhone.trim()) {
      setDetailError('Enter a phone number.');
      return;
    }
    setIsLinkingContact(true);
    setDetailError(null);
    try {
      await linkTimesheetEntryContact(selectedId, entryId, {
        phone: contactPhone.trim(),
        contactType,
        name: contactName.trim() || undefined,
        contactTypeOther: contactType === 'OTHER' ? contactName.trim() : undefined,
        reason: contactReason.trim() || undefined,
      });
      setContactFormEntryId(null);
      await loadDetail(selectedId);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not link the contact. If it already exists, use a different number or link it from the Contacts directory.'));
    } finally {
      setIsLinkingContact(false);
    }
  };

  const onUnlinkContact = (linkId: string) => {
    Alert.alert('Unlink this contact?', 'This removes the link from this entry — the contact itself is not deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          if (!selectedId) return;
          setUnlinkingId(linkId);
          setDetailError(null);
          try {
            await unlinkTimesheetEntryContact(linkId);
            await loadDetail(selectedId);
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not unlink the contact.'));
          } finally {
            setUnlinkingId(null);
          }
        },
      },
    ]);
  };

  const onExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const { from, to } = last7DaysRange();
      const dataUri = await fetchTimesheetExportDataUri({ dateFrom: from, dateTo: to });
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not export timesheets.'));
    } finally {
      setIsExporting(false);
    }
  };

  const onSearchDocs = async () => {
    setIsSearchingDocs(true);
    setDocSearchError(null);
    try {
      const result = await searchWorkDocs({ q: docQuery.trim() || undefined });
      setDocResults(result.docs);
    } catch (err: any) {
      setDocSearchError(getErrorMessage(err, 'Could not search documentation.'));
    } finally {
      setIsSearchingDocs(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Timesheets Manager is only available to Owner, Store Manager, HR, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (selectedId) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: detail?.user.name ?? 'Timesheet' }} />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <Pressable onPress={() => setSelectedId(null)} style={styles.backButton} accessibilityLabel="Back to register">
            <ThemedText type="link">‹ Back to register</ThemedText>
          </Pressable>

          {detailError && <ThemedText style={styles.error}>{detailError}</ThemedText>}

          {isLoadingDetail ? (
            <ActivityIndicator style={styles.spinner} />
          ) : detail === null ? (
            detailError ? (
              <Pressable onPress={() => loadDetail(selectedId)} style={styles.button}>
                <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
              </Pressable>
            ) : null
          ) : (
            <>
              <GlassCard style={styles.card}>
                <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{detail.user.name} · {detail.date.slice(0, 10)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                  {STATUS_LABEL[detail.status] ?? detail.status} · {detail.totalHours}h
                </ThemedText>
                {detail.notes && <ThemedText type="small" themeColor="textSecondary">{detail.notes}</ThemedText>}

                {canDecide && detail.status === 'SUBMITTED' && (
                  <View style={styles.decideSection}>
                    <Pressable onPress={onApprove} disabled={isDeciding} style={[styles.button, styles.approveButton]}>
                      {isDeciding ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Approve</ThemedText>}
                    </Pressable>
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="Rejection reason"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.formInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    <Pressable onPress={onReject} disabled={isRejecting} style={[styles.button, styles.rejectButton]}>
                      {isRejecting ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Reject</ThemedText>}
                    </Pressable>
                  </View>
                )}
              </GlassCard>

              {detail.entries.map((entry) => {
                const entryId = entry.id ?? '';
                const replies = detail.entryReplies.filter((r) => r.entryId === entryId);
                const attachments = detail.entryAttachments.filter((a) => a.entryId === entryId);
                const contacts = detail.entryContacts.filter((c) => c.entryId === entryId);
                const hasOpenTask = detail.followUpTasks.some((t) => t.sourceEntryId === entryId);

                return (
                  <ThemedView key={entryId} type="backgroundElement" style={styles.entryCard}>
                    <ThemedText type="smallBold" numberOfLines={2} ellipsizeMode="tail">{entry.task}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{entry.hours}h</ThemedText>

                    {replies.length > 0 && (
                      <View style={styles.thread}>
                        {replies.map((r) => (
                          <View key={r.id} style={styles.replyRow}>
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{r.author.name}</ThemedText>
                            <ThemedText type="small" numberOfLines={3} ellipsizeMode="tail">{r.message}</ThemedText>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={styles.entryRow}>
                      <TextInput
                        value={replyDrafts[entryId] ?? ''}
                        onChangeText={(v) => setReplyDrafts((prev) => ({ ...prev, [entryId]: v }))}
                        placeholder="Reply"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.smallInput, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <Pressable onPress={() => onSendReply(entryId)} disabled={sendingReplyFor === entryId} style={styles.smallButton} accessibilityLabel="Send reply">
                        {sendingReplyFor === entryId ? <ActivityIndicator size="small" /> : <ThemedText style={styles.buttonLabel}>Send</ThemedText>}
                      </Pressable>
                    </View>

                    {canDecide && !hasOpenTask && (
                      <View style={styles.entryRow}>
                        <TextInput
                          value={assignDrafts[entryId] ?? ''}
                          onChangeText={(v) => setAssignDrafts((prev) => ({ ...prev, [entryId]: v }))}
                          placeholder="Follow-up instructions"
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.smallInput, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <Pressable onPress={() => onAssignTask(entryId)} disabled={assigningFor === entryId} style={styles.smallButton} accessibilityLabel="Assign follow-up task">
                          {assigningFor === entryId ? <ActivityIndicator size="small" /> : <ThemedText style={styles.buttonLabel}>Assign</ThemedText>}
                        </Pressable>
                      </View>
                    )}
                    {hasOpenTask && <ThemedText type="small" themeColor="textSecondary">Task assigned.</ThemedText>}

                    {attachments.length > 0 && (
                      <View style={styles.thread}>
                        {attachments.map((a) => (
                          <View key={a.id} style={styles.attachmentRow}>
                            <Pressable onPress={() => onOpenAttachment(a.id, a.mimeType)} disabled={openingAttachmentId === a.id} style={styles.flex1}>
                              <ThemedText type="link" numberOfLines={1} ellipsizeMode="tail">{a.filename}</ThemedText>
                            </Pressable>
                            {openingAttachmentId === a.id && <ActivityIndicator size="small" />}
                            <Pressable onPress={() => onDeleteAttachment(a.id, a.filename)} disabled={deletingAttachmentId === a.id} style={styles.deleteButton} accessibilityLabel={`Delete ${a.filename}`}>
                              {deletingAttachmentId === a.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.deleteLabel}>✕</ThemedText>}
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                    {activeUploadEntryId === entryId && upload.file ? (
                      <View style={styles.entryRow}>
                        <ThemedText type="small" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>{upload.file.name}</ThemedText>
                        {upload.status === 'uploading' ? (
                          <View style={styles.entryRow}>
                            <ThemedText type="small" themeColor="textSecondary">{upload.progress != null ? `${upload.progress}%` : 'Uploading…'}</ThemedText>
                            <Pressable onPress={upload.cancel} accessibilityLabel="Cancel upload"><ThemedText type="link">Cancel</ThemedText></Pressable>
                          </View>
                        ) : upload.status === 'error' ? (
                          <Pressable onPress={upload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
                        ) : (
                          <Pressable onPress={doUploadAttachment} style={styles.smallButton}><ThemedText style={styles.buttonLabel}>Upload</ThemedText></Pressable>
                        )}
                      </View>
                    ) : (
                      <View style={styles.entryRow}>
                        <Pressable onPress={() => onPickCamera(entryId)} accessibilityLabel="Take a photo to attach"><ThemedText type="link">+ Camera</ThemedText></Pressable>
                        <Pressable onPress={() => onPickGallery(entryId)} accessibilityLabel="Choose a photo to attach"><ThemedText type="link">+ Gallery</ThemedText></Pressable>
                      </View>
                    )}

                    {contacts.length > 0 && (
                      <View style={styles.thread}>
                        {contacts.map((c) => (
                          <View key={c.id} style={styles.attachmentRow}>
                            <ThemedText type="small" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>
                              {c.contact.name || c.contact.phone} · {c.contact.contactType === 'OTHER' ? (c.contact.contactTypeOther || 'Other') : c.contact.contactType.replace('_', ' ')}
                            </ThemedText>
                            <Pressable onPress={() => onUnlinkContact(c.id)} disabled={unlinkingId === c.id} style={styles.deleteButton} accessibilityLabel="Unlink contact">
                              {unlinkingId === c.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.deleteLabel}>✕</ThemedText>}
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                    {contactFormEntryId === entryId ? (
                      <View style={styles.contactForm}>
                        <TextInput
                          value={contactPhone}
                          onChangeText={setContactPhone}
                          placeholder="Phone number"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="phone-pad"
                          style={[styles.smallInput, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <View style={styles.chipRow}>
                          {CONTACT_TYPES.map((t) => (
                            <Pressable key={t.key} onPress={() => setContactType(t.key)} style={[styles.chip, { backgroundColor: contactType === t.key ? theme.primary : theme.background }]}>
                              <ThemedText type="small" style={contactType === t.key ? styles.chipLabelActive : undefined}>{t.label}</ThemedText>
                            </Pressable>
                          ))}
                        </View>
                        <TextInput
                          value={contactName}
                          onChangeText={setContactName}
                          placeholder={contactType === 'OTHER' ? 'Name / what kind of contact' : 'Name (optional)'}
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.smallInput, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <TextInput
                          value={contactReason}
                          onChangeText={setContactReason}
                          placeholder="Reason (optional)"
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.smallInput, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <View style={styles.entryRow}>
                          <Pressable onPress={() => onLinkContact(entryId)} disabled={isLinkingContact} style={styles.smallButton}>
                            {isLinkingContact ? <ActivityIndicator size="small" /> : <ThemedText style={styles.buttonLabel}>Link</ThemedText>}
                          </Pressable>
                          <Pressable onPress={() => setContactFormEntryId(null)} style={[styles.smallButton, styles.cancelButton]}>
                            <ThemedText type="small">Cancel</ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => onOpenContactForm(entryId)} accessibilityLabel="Link a contact to this entry">
                        <ThemedText type="link">+ Link contact</ThemedText>
                      </Pressable>
                    )}
                  </ThemedView>
                );
              })}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Timesheets Manager' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="small" themeColor="textSecondary">
          Last 7 days · {register ? `${register.dates[0]} – ${register.dates[register.dates.length - 1]}` : ''}
        </ThemedText>
        <View style={styles.headerActionsRow}>
          <Pressable onPress={onExport} disabled={isExporting} style={styles.smallButton}>
            {isExporting ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Export Excel</ThemedText>}
          </Pressable>
          <Pressable onPress={() => setShowDocSearch((v) => !v)}>
            <ThemedText type="link">{showDocSearch ? 'Hide doc search' : 'Search docs'}</ThemedText>
          </Pressable>
        </View>

        {showDocSearch && (
          <View style={styles.card}>
            <View style={styles.entryRow}>
              <TextInput
                value={docQuery}
                onChangeText={setDocQuery}
                placeholder="Search description or vendor..."
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={onSearchDocs}
                returnKeyType="search"
                style={[styles.smallInput, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onSearchDocs} disabled={isSearchingDocs} style={styles.smallButton}>
                {isSearchingDocs ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Search</ThemedText>}
              </Pressable>
            </View>
            {docSearchError && <ThemedText style={styles.error}>{docSearchError}</ThemedText>}
            {docResults && (
              docResults.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No matching documentation.</ThemedText>
              ) : (
                docResults.map((doc) => (
                  <ThemedView key={doc.id} type="backgroundElement" style={styles.row}>
                    <View style={styles.flex1}>
                      <ThemedText type="small" numberOfLines={2} ellipsizeMode="tail">{doc.description}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {doc.createdBy.name} · {doc.type === 'VENDOR' ? (doc.vendorName ?? 'Vendor') : (doc.customer?.name ?? 'Customer')}
                      </ThemedText>
                    </View>
                  </ThemedView>
                ))
              )
            )}
          </View>
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {register === null ? (
          error ? (
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )
        ) : register.employees.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No active employees found.</ThemedText>
        ) : (
          register.employees.map((emp) => {
            const cells = register.dates.map((d) => emp.timesheets[d]).filter(Boolean);
            return (
              <GlassCard key={emp.id} style={styles.card}>
                <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{emp.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{emp.role}</ThemedText>
                {cells.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.noneRow}>
                    No timesheets in range.
                  </ThemedText>
                ) : (
                  register.dates.map((d) => {
                    const cell = emp.timesheets[d];
                    if (!cell) return null;
                    return (
                      <Pressable key={d} onPress={() => onOpen(cell.id)}>
                        <ThemedView type="backgroundElement" style={styles.row}>
                          <View style={styles.flex1}>
                            <ThemedText type="small">{d}</ThemedText>
                            <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{cell.totalHours}h</ThemedText>
                          </View>
                          <ThemedText type="small" style={{ color: statusColor(cell.status) }}>{STATUS_LABEL[cell.status] ?? cell.status}</ThemedText>
                        </ThemedView>
                      </Pressable>
                    );
                  })
                )}
              </GlassCard>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginTop: Spacing.one },
  notice: { color: '#167A48', marginTop: Spacing.one },
  spinner: { marginTop: Spacing.three },
  card: { gap: Spacing.one },
  noneRow: { marginTop: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.two, marginTop: Spacing.one },
  backButton: { marginBottom: Spacing.one, minHeight: 44, justifyContent: 'center' },
  button: { height: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  approveButton: { backgroundColor: '#167A48' },
  rejectButton: { backgroundColor: '#B83030' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  decideSection: { gap: Spacing.two, marginTop: Spacing.two },
  formInput: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  tabularNums: { fontVariant: ['tabular-nums'] },
  entryCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, marginTop: Spacing.two },
  thread: { gap: Spacing.half, marginTop: Spacing.one },
  replyRow: { gap: 2 },
  entryRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', marginTop: Spacing.one },
  smallInput: { height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15 },
  smallButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { color: '#B83030', fontSize: 16 },
  contactForm: { gap: Spacing.one, marginTop: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  headerActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.one },
});
