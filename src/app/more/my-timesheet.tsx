import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { openExternalUrl } from '@/lib/open-url';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createWorkDoc,
  deleteTimesheetEntryAttachment,
  deleteWorkDocFile,
  fetchCustomerJobs,
  fetchCustomers,
  fetchMyMonthTimesheets,
  fetchTimesheetAttachmentDataUri,
  fetchWorkDocsForTimesheet,
  getErrorMessage,
  linkTimesheetEntryContact,
  replyToTimesheetEntry,
  replyToWorkDoc,
  saveTimesheet,
  submitTimesheet,
  unlinkTimesheetEntryContact,
  updateWorkDoc,
  uploadTimesheetEntryAttachment,
  uploadWorkDocFile,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type {
  ContactType,
  CustomerListItem,
  JobCard,
  Timesheet,
  TimesheetEntry,
  WorkDocType,
  WorkDocumentation,
} from '@/types/api';

const WORK_DOC_TYPES: WorkDocType[] = ['VENDOR', 'CUSTOMER_INTERACTION'];
const CONTACT_TYPES: ContactType[] = ['CUSTOMER', 'VENDOR_SERVICE_PROVIDER', 'STAFF', 'OTHER'];

// Work-docs attachments — BLOCKED_ROLES=[TECHNICIAN,STAFF] denies the whole
// /work-docs router server-side (re-verified 2026-09-21 against backend/src/
// routes/work-docs.ts: router.use(verifyToken, (req,res,next) => { if
// (BLOCKED_ROLES.includes(req.user?.role ?? '')) return 403; ... }) — applies
// to every route in the file, no exceptions); everyone else may view/create/
// attach to their own entries, or any entry, if MANAGER_ROLES=[OWNER,
// STORE_MANAGER]. Mirrored here, unchanged, so the section doesn't render
// (and 403) for a blocked role — this gate was NOT touched by this pass.
const BLOCKED_ROLES = ['TECHNICIAN', 'STAFF'];

const UPLOAD_RULES = {
  allowedMimeTypes: [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  maxSizeBytes: 20 * 1024 * 1024,
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function MyTimesheetScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useAuth();
  const canUseWorkDocs = !BLOCKED_ROLES.includes(user?.role ?? '');
  const today = todayISO();
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([{ task: '', hours: 0 }]);
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [docs, setDocs] = useState<WorkDocumentation[] | null>(null);
  const [docDescription, setDocDescription] = useState('');
  const [docType, setDocType] = useState<WorkDocType>('VENDOR');
  const [docVendorName, setDocVendorName] = useState('');
  const [docContactPhone, setDocContactPhone] = useState('');
  const [docCustomerQuery, setDocCustomerQuery] = useState('');
  const [docCustomerResults, setDocCustomerResults] = useState<CustomerListItem[]>([]);
  const [docSelectedCustomer, setDocSelectedCustomer] = useState<CustomerListItem | null>(null);
  const [docJobCards, setDocJobCards] = useState<JobCard[] | null>(null);
  const [docSelectedJobCardId, setDocSelectedJobCardId] = useState<string | null>(null);
  const [docQuotes, setDocQuotes] = useState<string[]>([]);
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [activeUploadDocId, setActiveUploadDocId] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const upload = useFileUpload(UPLOAD_RULES);

  // Entry-level attachments (POST /timesheets/:id/entries/:entryId/
  // attachments) — a separate flow from Work Documentation above, matching
  // the dashboard's entryAttachments/handleAttach/handleViewAttachment/
  // handleDeleteAttachment on a raw task entry itself, not a vendor/customer
  // doc. Was entirely missing from this screen (this API existed already,
  // wired up only in the manager-side timesheets-manager.tsx screen).
  const [activeUploadEntryId, setActiveUploadEntryId] = useState<string | null>(null);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const entryUpload = useFileUpload(UPLOAD_RULES);

  // Work-doc edit-in-place (PUT /work-docs/:id) — owner or manager, type
  // itself is never editable once created.
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editVendorName, setEditVendorName] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [isSavingDocEdit, setIsSavingDocEdit] = useState(false);

  // Work-doc reply thread — anyone can read; POST is MANAGER_ROLES-only server-side.
  const isManager = ['OWNER', 'STORE_MANAGER'].includes(user?.role ?? '');
  const [docReplyText, setDocReplyText] = useState<Record<string, string>>({});
  const [sendingDocReplyId, setSendingDocReplyId] = useState<string | null>(null);

  // Entry-level reply thread + contact link
  const [entryReplyText, setEntryReplyText] = useState<Record<string, string>>({});
  const [sendingEntryReplyId, setSendingEntryReplyId] = useState<string | null>(null);
  const [linkingContactEntryId, setLinkingContactEntryId] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState('');
  const [contactType, setContactType] = useState<ContactType>('CUSTOMER');
  const [contactName, setContactName] = useState('');
  const [contactReason, setContactReason] = useState('');
  const [isLinkingContact, setIsLinkingContact] = useState(false);
  const [unlinkingContactId, setUnlinkingContactId] = useState<string | null>(null);

  // Responsive thumbnail size — a fixed 120x90 breaks the row layout on an
  // iPhone SE-class device (375pt wide); scale to the window instead, capped
  // at the original 120 so it never grows past the old design on larger phones.
  const thumbWidth = Math.min(120, Math.round(windowWidth * 0.28));
  const thumbHeight = Math.round(thumbWidth * 0.75);

  const loadDocs = useCallback(async (timesheetId: string) => {
    if (!canUseWorkDocs) return;
    setDocError(null);
    try {
      setDocs(await fetchWorkDocsForTimesheet(timesheetId));
    } catch (err: any) {
      setDocError(getErrorMessage(err, 'Could not load attachments.'));
    }
  }, [canUseWorkDocs]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const now = new Date();
      const results = await fetchMyMonthTimesheets(now.getMonth() + 1, now.getFullYear());
      const todays = results.find((t) => t.date.slice(0, 10) === today) ?? null;
      setTimesheet(todays);
      if (todays) {
        setEntries(todays.entries.length ? todays.entries : [{ task: '', hours: 0 }]);
        setNotes(todays.notes ?? '');
        await loadDocs(todays.id);
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load your timesheet.'));
    }
  }, [today, loadDocs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (docType !== 'CUSTOMER_INTERACTION' || !docCustomerQuery.trim()) {
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetchCustomers(docCustomerQuery.trim());
        if (!cancelled) setDocCustomerResults(res.customers);
      } catch {
        // leave results as-is; the picker just won't update this keystroke
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [docType, docCustomerQuery]);

  const onChangeDocCustomerQuery = (v: string) => {
    setDocCustomerQuery(v);
    if (!v.trim()) setDocCustomerResults([]);
  };

  const onSelectDocCustomer = async (c: CustomerListItem) => {
    setDocSelectedCustomer(c);
    setDocCustomerQuery('');
    setDocCustomerResults([]);
    setDocSelectedJobCardId(null);
    setDocJobCards(null);
    try {
      setDocJobCards(await fetchCustomerJobs(c.id));
    } catch {
      setDocJobCards([]);
    }
  };

  const resetDocForm = () => {
    setDocDescription('');
    setDocType('VENDOR');
    setDocVendorName('');
    setDocContactPhone('');
    setDocCustomerQuery('');
    setDocCustomerResults([]);
    setDocSelectedCustomer(null);
    setDocJobCards(null);
    setDocSelectedJobCardId(null);
    setDocQuotes([]);
  };

  const onAddDoc = async () => {
    if (!timesheet || !docDescription.trim()) return;
    if (docType === 'CUSTOMER_INTERACTION' && !docSelectedCustomer) {
      setDocError('Choose a customer for a customer interaction.');
      return;
    }
    setIsAddingDoc(true);
    setDocError(null);
    try {
      await createWorkDoc(timesheet.id, {
        description: docDescription.trim(),
        type: docType,
        vendorName: docType === 'VENDOR' ? docVendorName.trim() || undefined : undefined,
        contactPhone: docType === 'VENDOR' ? docContactPhone.trim() || undefined : undefined,
        ...(docType === 'CUSTOMER_INTERACTION' && {
          customerId: docSelectedCustomer!.id,
          jobCardId: docSelectedJobCardId ?? undefined,
          quotes: docQuotes.map((q) => Number(q)).filter((n) => !Number.isNaN(n) && n > 0),
        } as any),
      });
      resetDocForm();
      await loadDocs(timesheet.id);
    } catch (err: any) {
      setDocError(getErrorMessage(err, 'Could not add the note.'));
    } finally {
      setIsAddingDoc(false);
    }
  };

  const startEditDoc = (doc: WorkDocumentation) => {
    setEditingDocId(doc.id);
    setEditDescription(doc.description);
    setEditVendorName(doc.vendorName ?? '');
    setEditContactPhone(doc.contactPhone ?? '');
  };

  const onSaveDocEdit = async (doc: WorkDocumentation) => {
    setIsSavingDocEdit(true);
    setDocError(null);
    try {
      await updateWorkDoc(doc.id, {
        description: editDescription.trim(),
        ...(doc.type === 'VENDOR' && { vendorName: editVendorName.trim(), contactPhone: editContactPhone.trim() }),
      });
      setEditingDocId(null);
      if (timesheet) await loadDocs(timesheet.id);
    } catch (err: any) {
      setDocError(getErrorMessage(err, 'Could not save changes.'));
    } finally {
      setIsSavingDocEdit(false);
    }
  };

  const onSendDocReply = async (docId: string) => {
    const message = (docReplyText[docId] ?? '').trim();
    if (!message) return;
    setSendingDocReplyId(docId);
    setDocError(null);
    try {
      await replyToWorkDoc(docId, message);
      setDocReplyText((prev) => ({ ...prev, [docId]: '' }));
      if (timesheet) await loadDocs(timesheet.id);
    } catch (err: any) {
      setDocError(getErrorMessage(err, 'Could not send that reply.'));
    } finally {
      setSendingDocReplyId(null);
    }
  };

  const onSendEntryReply = async (entryId: string) => {
    if (!timesheet) return;
    const message = (entryReplyText[entryId] ?? '').trim();
    if (!message) return;
    setSendingEntryReplyId(entryId);
    setError(null);
    try {
      await replyToTimesheetEntry(timesheet.id, entryId, message);
      setEntryReplyText((prev) => ({ ...prev, [entryId]: '' }));
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that reply.'));
    } finally {
      setSendingEntryReplyId(null);
    }
  };

  const resetContactForm = () => {
    setLinkingContactEntryId(null);
    setContactPhone('');
    setContactType('CUSTOMER');
    setContactName('');
    setContactReason('');
  };

  const onLinkContact = async (entryId: string) => {
    if (!timesheet || !contactPhone.trim()) return;
    setIsLinkingContact(true);
    setError(null);
    try {
      await linkTimesheetEntryContact(timesheet.id, entryId, {
        phone: contactPhone.trim(),
        contactType,
        name: contactName.trim() || undefined,
        reason: contactReason.trim() || undefined,
      });
      resetContactForm();
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not link that contact.'));
    } finally {
      setIsLinkingContact(false);
    }
  };

  const onUnlinkContact = async (linkId: string) => {
    setUnlinkingContactId(linkId);
    setError(null);
    try {
      await unlinkTimesheetEntryContact(linkId);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not remove that contact link.'));
    } finally {
      setUnlinkingContactId(null);
    }
  };

  const onPickCamera = async (docId: string) => {
    const file = await pickFromCamera();
    if (!file) return;
    setActiveUploadDocId(docId);
    upload.pick(file);
  };
  const onPickGallery = async (docId: string) => {
    const file = await pickFromGallery();
    if (!file) return;
    setActiveUploadDocId(docId);
    upload.pick(file);
  };

  const doUpload = () => {
    if (!activeUploadDocId) return;
    const docId = activeUploadDocId;
    return upload.upload((file, ctrl) => uploadWorkDocFile(docId, file, ctrl)).then((result) => {
      if (result) {
        upload.reset();
        setActiveUploadDocId(null);
        if (timesheet) loadDocs(timesheet.id);
      }
    });
  };

  const onDeleteFile = (docId: string, fileId: string, filename: string) => {
    Alert.alert(
      'Delete this attachment?',
      `This permanently removes "${filename}". This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingFileId(fileId);
            setDocError(null);
            try {
              await deleteWorkDocFile(docId, fileId);
              if (timesheet) await loadDocs(timesheet.id);
            } catch (err: any) {
              setDocError(getErrorMessage(err, 'Could not delete the attachment.'));
            } finally {
              setDeletingFileId(null);
            }
          },
        },
      ],
    );
  };

  const onPickEntryAttachCamera = async (entryId: string) => {
    const file = await pickFromCamera();
    if (!file) return;
    setActiveUploadEntryId(entryId);
    entryUpload.pick(file);
  };
  const onPickEntryAttachGallery = async (entryId: string) => {
    const file = await pickFromGallery();
    if (!file) return;
    setActiveUploadEntryId(entryId);
    entryUpload.pick(file);
  };

  const doUploadEntryAttachment = () => {
    if (!timesheet || !activeUploadEntryId) return;
    const entryId = activeUploadEntryId;
    return entryUpload.upload((file, ctrl) => uploadTimesheetEntryAttachment(timesheet.id, entryId, file, ctrl)).then(async (result) => {
      if (result) {
        entryUpload.reset();
        setActiveUploadEntryId(null);
        await load();
      }
    });
  };

  const onOpenEntryAttachment = async (attachmentId: string, mimeType: string) => {
    setOpeningAttachmentId(attachmentId);
    setError(null);
    try {
      const dataUri = await fetchTimesheetAttachmentDataUri(attachmentId, mimeType);
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not open the attachment.'));
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const onDeleteEntryAttachment = (attachmentId: string, filename: string) => {
    if (!timesheet) return;
    Alert.alert('Delete this attachment?', `This permanently removes "${filename}". This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingAttachmentId(attachmentId);
          setError(null);
          try {
            await deleteTimesheetEntryAttachment(attachmentId);
            await load();
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete the attachment.'));
          } finally {
            setDeletingAttachmentId(null);
          }
        },
      },
    ]);
  };

  const updateEntry = (index: number, patch: Partial<TimesheetEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  };

  const addEntry = () => setEntries((prev) => [...prev, { task: '', hours: 0 }]);
  const removeEntry = (index: number) => setEntries((prev) => prev.filter((_, i) => i !== index));

  const onSave = async () => {
    const cleaned = entries.filter((e) => e.task.trim());
    if (cleaned.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      setTimesheet(await saveTimesheet(today, cleaned, notes.trim() || undefined));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save your timesheet.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onSubmit = async () => {
    if (!timesheet) return;
    setIsSubmitting(true);
    setError(null);
    try {
      setTimesheet(await submitTimesheet(timesheet.id));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not submit your timesheet.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // timesheet.canEdit (withEditability, backend/src/routes/timesheets.ts) is
  // the source of truth once a timesheet exists — it's what actually applies
  // the SUBMITTED one-time 60-minute edit window, not just DRAFT/REJECTED.
  const canEdit = !timesheet ? true : timesheet.canEdit ?? (timesheet.status === 'DRAFT' || timesheet.status === 'REJECTED');
  const editWindowClosesAt = timesheet?.status === 'SUBMITTED' && timesheet.canEdit && timesheet.editableUntil
    ? new Date(timesheet.editableUntil)
    : null;

  return (
    <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <Stack.Screen options={{ title: 'My Timesheet' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="title" style={styles.title}>
          Today
        </ThemedText>
        {timesheet && (
          <ThemedText themeColor="textSecondary">
            {timesheet.status} · {timesheet.totalHours}h logged
            {editWindowClosesAt ? ` · editable until ${editWindowClosesAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </ThemedText>
        )}

        {entries.map((entry, index) => {
          const entryId = entry.id;
          const replies = entryId ? (timesheet?.entryReplies ?? []).filter((r) => r.entryId === entryId) : [];
          const links = entryId ? (timesheet?.entryContacts ?? []).filter((c) => c.entryId === entryId) : [];
          const attachments = entryId ? (timesheet?.entryAttachments ?? []).filter((a) => a.entryId === entryId) : [];
          return (
          <View key={index} style={styles.entryBlock}>
            <View style={styles.entryRow}>
              <TextInput
                value={entry.task}
                onChangeText={(v) => updateEntry(index, { task: v })}
                placeholder="Describe the task…"
                placeholderTextColor={theme.textSecondary}
                editable={canEdit}
                style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <TextInput
                value={entry.hours ? String(entry.hours) : ''}
                onChangeText={(v) => updateEntry(index, { hours: Number(v) || 0 })}
                placeholder="Hrs"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                editable={canEdit}
                style={[styles.input, styles.hoursInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              {canEdit && entries.length > 1 && (
                <Pressable
                  onPress={() => removeEntry(index)}
                  style={styles.removeButton}
                  accessibilityLabel={`Remove task ${index + 1}`}
                >
                  <ThemedText themeColor="textSecondary">✕</ThemedText>
                </Pressable>
              )}
            </View>

            {entryId && links.map((l) => (
              <View key={l.id} style={styles.contactChipRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
                  📞 {l.contact.name || l.contact.phone} ({l.contact.contactType}){l.reason ? ` — ${l.reason}` : ''}
                </ThemedText>
                <Pressable onPress={() => onUnlinkContact(l.id)} disabled={unlinkingContactId === l.id}>
                  <ThemedText type="small" style={styles.error}>Unlink</ThemedText>
                </Pressable>
              </View>
            ))}

            {entryId && replies.length > 0 && (
              <View style={styles.entryThread}>
                {replies.map((r) => (
                  <ThemedText key={r.id} type="small" themeColor="textSecondary">
                    <ThemedText type="smallBold">{r.author.name}</ThemedText>: {r.message}
                  </ThemedText>
                ))}
                <View style={styles.entryRow}>
                  <TextInput
                    value={entryReplyText[entryId] ?? ''}
                    onChangeText={(v) => setEntryReplyText((prev) => ({ ...prev, [entryId]: v }))}
                    placeholder="Reply…"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <Pressable onPress={() => onSendEntryReply(entryId)} disabled={sendingEntryReplyId === entryId} style={styles.smallActionButton}>
                    {sendingEntryReplyId === entryId ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Send</ThemedText>}
                  </Pressable>
                </View>
              </View>
            )}

            {entryId && attachments.length > 0 && (
              <View style={styles.entryThread}>
                {attachments.map((a) => (
                  <View key={a.id} style={styles.contactChipRow}>
                    <Pressable onPress={() => onOpenEntryAttachment(a.id, a.mimeType)} disabled={openingAttachmentId === a.id} style={styles.flex1}>
                      <ThemedText type="link" numberOfLines={1}>{a.filename}</ThemedText>
                    </Pressable>
                    {openingAttachmentId === a.id && <ActivityIndicator size="small" />}
                    <Pressable onPress={() => onDeleteEntryAttachment(a.id, a.filename)} disabled={deletingAttachmentId === a.id}>
                      {deletingAttachmentId === a.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.error}>✕</ThemedText>}
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {entryId && (
              activeUploadEntryId === entryId && entryUpload.file ? (
                <View style={styles.entryRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{entryUpload.file.name}</ThemedText>
                  {entryUpload.status === 'uploading' ? (
                    <ActivityIndicator size="small" />
                  ) : entryUpload.status === 'error' ? (
                    <Pressable onPress={entryUpload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
                  ) : (
                    <Pressable onPress={doUploadEntryAttachment} style={styles.smallActionButton}>
                      <ThemedText style={styles.buttonLabel}>Upload</ThemedText>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View style={styles.entryRow}>
                  <Pressable onPress={() => onPickEntryAttachCamera(entryId)}><ThemedText type="link">+ Camera</ThemedText></Pressable>
                  <Pressable onPress={() => onPickEntryAttachGallery(entryId)}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
                </View>
              )
            )}

            {entryId && (
              linkingContactEntryId === entryId ? (
                <View style={styles.entryThread}>
                  <TextInput
                    value={contactPhone}
                    onChangeText={setContactPhone}
                    placeholder="Phone number"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <View style={styles.chipRow}>
                    {CONTACT_TYPES.map((t) => (
                      <Pressable key={t} onPress={() => setContactType(t)} style={[styles.chip, { backgroundColor: contactType === t ? theme.primary : theme.backgroundElement }]}>
                        <ThemedText type="small" style={contactType === t ? styles.chipLabelActive : undefined}>{t.replace(/_/g, ' ')}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    value={contactName}
                    onChangeText={setContactName}
                    placeholder="Name (optional)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <TextInput
                    value={contactReason}
                    onChangeText={setContactReason}
                    placeholder="Reason (optional)"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <View style={styles.entryRow}>
                    <Pressable onPress={() => onLinkContact(entryId)} disabled={isLinkingContact || !contactPhone.trim()} style={styles.smallActionButton}>
                      {isLinkingContact ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Link</ThemedText>}
                    </Pressable>
                    <Pressable onPress={resetContactForm}><ThemedText type="link">Cancel</ThemedText></Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => setLinkingContactEntryId(entryId)} style={styles.linkContactButton}>
                  <ThemedText type="link">+ Link contact</ThemedText>
                </Pressable>
              )
            )}
          </View>
          );
        })}

        {canEdit && (
          <Pressable onPress={addEntry} style={styles.addButton}>
            <ThemedText type="link">+ Add Task</ThemedText>
          </Pressable>
        )}

        <ThemedText type="smallBold" style={styles.notesHeading}>Notes (optional)</ThemedText>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional notes..."
          placeholderTextColor={theme.textSecondary}
          editable={canEdit}
          multiline
          style={[styles.input, styles.noteInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {canEdit && (
          <View style={styles.actions}>
            <Pressable onPress={onSave} disabled={isSaving} style={[styles.button, styles.buttonSecondary]}>
              {isSaving ? <ActivityIndicator /> : <ThemedText type="smallBold">Save Draft</ThemedText>}
            </Pressable>
            {timesheet && (
              <Pressable onPress={onSubmit} disabled={isSubmitting} style={styles.button}>
                {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Submit</ThemedText>}
              </Pressable>
            )}
          </View>
        )}

        {timesheet && canUseWorkDocs && (
          <View style={styles.docsSection}>
            <ThemedText type="smallBold" style={styles.docsTitle}>Work Documentation</ThemedText>

            <View style={styles.chipRow}>
              {WORK_DOC_TYPES.map((t) => (
                <Pressable key={t} onPress={() => setDocType(t)} style={[styles.chip, { backgroundColor: docType === t ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={docType === t ? styles.chipLabelActive : undefined}>
                    {t === 'VENDOR' ? 'Vendor work' : 'Customer interaction'}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={docDescription}
              onChangeText={setDocDescription}
              placeholder="Description"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            {docType === 'VENDOR' && (
              <>
                <TextInput
                  value={docVendorName}
                  onChangeText={setDocVendorName}
                  placeholder="Vendor name (optional)"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  value={docContactPhone}
                  onChangeText={setDocContactPhone}
                  placeholder="Contact phone (optional)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="phone-pad"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </>
            )}

            {docType === 'CUSTOMER_INTERACTION' && (
              <>
                {docSelectedCustomer ? (
                  <View style={styles.entryRow}>
                    <ThemedText style={styles.flex1}>{docSelectedCustomer.name} · {docSelectedCustomer.phone}</ThemedText>
                    <Pressable onPress={() => { setDocSelectedCustomer(null); setDocJobCards(null); setDocSelectedJobCardId(null); }}>
                      <ThemedText type="link">Change</ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <TextInput
                      value={docCustomerQuery}
                      onChangeText={onChangeDocCustomerQuery}
                      placeholder="Search customer by name or phone"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    {docCustomerResults.map((c) => (
                      <Pressable key={c.id} onPress={() => onSelectDocCustomer(c)} style={styles.customerResultRow}>
                        <ThemedText type="small">{c.name} · {c.phone}</ThemedText>
                      </Pressable>
                    ))}
                  </>
                )}

                {docSelectedCustomer && docJobCards && docJobCards.length > 0 && (
                  <View style={styles.chipRow}>
                    {docJobCards.map((jc) => (
                      <Pressable
                        key={jc.id}
                        onPress={() => setDocSelectedJobCardId((cur) => (cur === jc.id ? null : jc.id))}
                        style={[styles.chip, { backgroundColor: docSelectedJobCardId === jc.id ? theme.primary : theme.backgroundElement }]}>
                        <ThemedText type="small" style={docSelectedJobCardId === jc.id ? styles.chipLabelActive : undefined}>
                          {jc.jobNumber} · {jc.vehicle?.vehicleNumber ?? '—'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}

                {docSelectedCustomer && (
                  <View style={styles.section}>
                    <ThemedText type="small" themeColor="textSecondary">Quotes given (optional)</ThemedText>
                    {docQuotes.map((q, i) => (
                      <View key={i} style={styles.entryRow}>
                        <TextInput
                          value={q}
                          onChangeText={(v) => setDocQuotes((prev) => prev.map((x, idx) => (idx === i ? v : x)))}
                          placeholder="Amount"
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="decimal-pad"
                          style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                        />
                        <Pressable onPress={() => setDocQuotes((prev) => prev.filter((_, idx) => idx !== i))}>
                          <ThemedText themeColor="textSecondary">✕</ThemedText>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable onPress={() => setDocQuotes((prev) => [...prev, ''])}>
                      <ThemedText type="link">+ Add another quote</ThemedText>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {docError && <ThemedText style={styles.error}>{docError}</ThemedText>}
            <Pressable onPress={onAddDoc} disabled={isAddingDoc || !docDescription.trim()} style={styles.addDocButton}>
              {isAddingDoc ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Add</ThemedText>}
            </Pressable>

            {docs === null ? (
              <ActivityIndicator style={styles.spinner} />
            ) : docs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No documentation entries yet.</ThemedText>
            ) : (
              docs.map((doc) => (
                <ThemedView key={doc.id} type="backgroundElement" style={styles.docCard}>
                  {editingDocId === doc.id ? (
                    <View style={styles.section}>
                      <TextInput
                        value={editDescription}
                        onChangeText={setEditDescription}
                        placeholder="Description"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      {doc.type === 'VENDOR' && (
                        <>
                          <TextInput
                            value={editVendorName}
                            onChangeText={setEditVendorName}
                            placeholder="Vendor name"
                            placeholderTextColor={theme.textSecondary}
                            style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                          />
                          <TextInput
                            value={editContactPhone}
                            onChangeText={setEditContactPhone}
                            placeholder="Contact phone"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="phone-pad"
                            style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                          />
                        </>
                      )}
                      <View style={styles.entryRow}>
                        <Pressable onPress={() => onSaveDocEdit(doc)} disabled={isSavingDocEdit} style={styles.smallActionButton}>
                          {isSavingDocEdit ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                        </Pressable>
                        <Pressable onPress={() => setEditingDocId(null)}><ThemedText type="link">Cancel</ThemedText></Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.entryRow}>
                        <ThemedText type="smallBold" numberOfLines={2} ellipsizeMode="tail" style={styles.flex1}>{doc.description}</ThemedText>
                        <Pressable onPress={() => startEditDoc(doc)}><ThemedText type="link">Edit</ThemedText></Pressable>
                      </View>
                      <ThemedText type="small" themeColor="textSecondary">
                        {doc.type === 'VENDOR'
                          ? [doc.vendorName, doc.contactPhone].filter(Boolean).join(' · ') || 'Vendor'
                          : [doc.customer?.name, doc.jobCard?.jobNumber].filter(Boolean).join(' · ') || 'Customer interaction'}
                      </ThemedText>
                      {doc.quotes.length > 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          Quotes: {doc.quotes.map((q) => q.amount).join(', ')}
                        </ThemedText>
                      )}
                    </>
                  )}
                  {doc.files.map((f) => (
                    <View key={f.id} style={styles.fileRow}>
                      <Pressable onPress={() => openExternalUrl(f.url)} style={styles.flex1}>
                        {f.mimeType.startsWith('image/') ? (
                          <Image source={{ uri: f.url }} style={{ width: thumbWidth, height: thumbHeight, borderRadius: Spacing.two, marginTop: Spacing.one }} />
                        ) : (
                          <ThemedText type="link" numberOfLines={1} ellipsizeMode="tail">{f.filename}</ThemedText>
                        )}
                      </Pressable>
                      <Pressable
                        onPress={() => onDeleteFile(doc.id, f.id, f.filename)}
                        disabled={deletingFileId === f.id}
                        style={styles.fileDeleteButton}
                        accessibilityLabel={`Delete attachment ${f.filename}`}
                      >
                        {deletingFileId === f.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.fileDeleteLabel}>✕</ThemedText>}
                      </Pressable>
                    </View>
                  ))}

                  {activeUploadDocId === doc.id && upload.file ? (
                    <View style={styles.previewRow}>
                      <ThemedText type="small" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>
                        {upload.file.name}
                      </ThemedText>
                      {upload.status === 'uploading' ? (
                        <View style={styles.progressRow}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {upload.progress != null ? `${upload.progress}%` : 'Uploading…'}
                          </ThemedText>
                          <Pressable onPress={upload.cancel} accessibilityLabel="Cancel upload">
                            <ThemedText type="link">Cancel</ThemedText>
                          </Pressable>
                        </View>
                      ) : upload.status === 'error' ? (
                        <Pressable onPress={upload.retry}>
                          <ThemedText type="link">Retry</ThemedText>
                        </Pressable>
                      ) : (
                        <Pressable onPress={doUpload} style={styles.attachButtonSmall}>
                          <ThemedText style={styles.buttonLabel}>Upload</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <View style={styles.pickRow}>
                      <Pressable
                        onPress={() => onPickCamera(doc.id)}
                        style={styles.attachButton}
                        accessibilityLabel="Take a photo to attach"
                      >
                        <ThemedText type="link">+ Camera</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => onPickGallery(doc.id)}
                        style={styles.attachButton}
                        accessibilityLabel="Choose a photo from gallery to attach"
                      >
                        <ThemedText type="link">+ Gallery</ThemedText>
                      </Pressable>
                    </View>
                  )}
                  {activeUploadDocId === doc.id && upload.error && <ThemedText style={styles.error}>{upload.error}</ThemedText>}

                  {doc.replies.length > 0 && (
                    <View style={styles.entryThread}>
                      {doc.replies.map((r) => (
                        <ThemedText key={r.id} type="small" themeColor="textSecondary">
                          <ThemedText type="smallBold">{r.author.name}</ThemedText>: {r.message}
                        </ThemedText>
                      ))}
                    </View>
                  )}
                  {isManager && (
                    <View style={styles.entryRow}>
                      <TextInput
                        value={docReplyText[doc.id] ?? ''}
                        onChangeText={(v) => setDocReplyText((prev) => ({ ...prev, [doc.id]: v }))}
                        placeholder="Reply…"
                        placeholderTextColor={theme.textSecondary}
                        style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <Pressable onPress={() => onSendDocReply(doc.id)} disabled={sendingDocReplyId === doc.id} style={styles.smallActionButton}>
                        {sendingDocReplyId === doc.id ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Send</ThemedText>}
                      </Pressable>
                    </View>
                  )}
                </ThemedView>
              ))
            )}
          </View>
        )}
        {timesheet && !canUseWorkDocs && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.docsTitle}>
            Attachments &amp; notes aren&apos;t available for your role.
          </ThemedText>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.four, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontSize: 26, lineHeight: 32 },
  entryRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  hoursInput: { width: 70 },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  removeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  addButton: { paddingVertical: Spacing.one },
  notesHeading: { marginTop: Spacing.three },
  noteInput: { minHeight: 60, paddingTop: Spacing.two, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  button: { flex: 1, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: 'rgba(127,127,127,0.2)' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#B83030' },
  docsSection: { marginTop: Spacing.four, gap: Spacing.two },
  docsTitle: { marginTop: Spacing.two },
  addDocButton: { paddingHorizontal: Spacing.three, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  spinner: { marginTop: Spacing.two },
  docCard: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fileDeleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  fileDeleteLabel: { color: '#B83030', fontSize: 16 },
  pickRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  attachButton: { minHeight: 44, justifyContent: 'center' },
  attachButtonSmall: { height: 36, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  entryBlock: { gap: Spacing.one },
  contactChipRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  entryThread: { gap: Spacing.one, marginTop: Spacing.one, paddingTop: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
  linkContactButton: { paddingVertical: Spacing.half, paddingHorizontal: Spacing.one },
  smallActionButton: { height: 40, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  section: { gap: Spacing.one },
  customerResultRow: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, backgroundColor: 'rgba(127,127,127,0.15)' },
});
