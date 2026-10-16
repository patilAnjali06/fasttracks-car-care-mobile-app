import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createLegalCase, fetchLegalCaseDocuments, fetchLegalCases, getErrorMessage,
  updateLegalCase, uploadLegalDocument,
} from '@/lib/api';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { CreateLegalCaseInput, LegalCase, LegalDocument } from '@/types/api';

// requireLegalAccess (backend/src/routes/legal_route.ts, verified 2026-09-19)
// is hasLegalAccess(user) — a dynamic check against a LegalAccessConfig table
// (an owner userId + one optional granted-seat userId), deny-by-default if no
// config row exists. NOT role-based, so — same as CRM/Invoices — this entry
// has no visibleToRoles in the registry and the screen just calls the API
// and shows a graceful message on a 403 via getErrorMessage.
//
// Create case / edit case / upload document added 2026-09-24 (full-parity
// pass) — same requireLegalAccess gate, applied to every route in the file
// (router.use(verifyToken, requireLegalAccess), no exceptions, re-verified
// by reading the file). File *viewing* (GET /legal/documents/:documentId/
// file, streaming existing bytes) stays deliberately out of scope — that's
// the real "most sensitive data in the app" concern; uploading a NEW
// document or editing case metadata doesn't pull existing file content
// onto the device, so it doesn't carry the same risk.
const CASE_SECTIONS: CreateLegalCaseInput['section'][] = ['PERSONAL', 'PROFESSIONAL'];
const UPLOAD_RULES = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 10 * 1024 * 1024,
};

export default function LegalScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Dashboard filters the case list by section (PERSONAL/PROFESSIONAL) via a
  // GET /legal/cases?section= param — this was previously missing, mobile
  // showed all cases mixed together regardless of the new-case section chip.
  const [sectionTab, setSectionTab] = useState<CreateLegalCaseInput['section']>('PERSONAL');
  const [cases, setCases] = useState<LegalCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, LegalDocument[]>>({});
  const [docsError, setDocsError] = useState<Record<string, string>>({});

  const [showNewCase, setShowNewCase] = useState(false);
  const [newSection, setNewSection] = useState<CreateLegalCaseInput['section']>('PERSONAL');
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newHearingDate, setNewHearingDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editHearingDate, setEditHearingDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [uploadCaseId, setUploadCaseId] = useState<string | null>(null);
  const [uploadLabel, setUploadLabel] = useState('');
  const upload = useFileUpload<LegalDocument>(UPLOAD_RULES);

  const load = useCallback(async () => {
    setError(null);
    setForbidden(false);
    try {
      setCases(await fetchLegalCases(sectionTab));
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setForbidden(true);
        setCases([]);
      } else {
        setError(getErrorMessage(err, 'Could not load legal cases.'));
        setCases([]);
      }
    }
  }, [sectionTab]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!docs[id]) {
      try {
        const result = await fetchLegalCaseDocuments(id);
        setDocs((prev) => ({ ...prev, [id]: result }));
      } catch (err: any) {
        setDocsError((prev) => ({ ...prev, [id]: getErrorMessage(err, 'Could not load documents.') }));
      }
    }
  };

  const onCreateCase = async () => {
    if (!newTitle.trim() || !newStatus.trim()) {
      setError('Title and status are required.');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      await createLegalCase({
        section: newSection,
        title: newTitle.trim(),
        status: newStatus.trim(),
        nextHearingDate: newHearingDate.trim() || undefined,
        notes: newNotes.trim() || undefined,
      });
      setNewTitle(''); setNewStatus(''); setNewHearingDate(''); setNewNotes('');
      setShowNewCase(false);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not create this case.'));
    } finally {
      setIsCreating(false);
    }
  };

  const openEdit = (c: LegalCase) => {
    setEditingId(c.id);
    setEditTitle(c.title);
    setEditStatus(c.status);
    setEditHearingDate(c.nextHearingDate ? c.nextHearingDate.slice(0, 10) : '');
    setEditNotes(c.notes ?? '');
  };

  const onSaveEdit = async () => {
    if (!editingId) return;
    if (!editTitle.trim() || !editStatus.trim()) {
      setError('Title and status are required.');
      return;
    }
    setIsSavingEdit(true);
    setError(null);
    try {
      await updateLegalCase(editingId, {
        title: editTitle.trim(),
        status: editStatus.trim(),
        nextHearingDate: editHearingDate.trim() || undefined,
        notes: editNotes.trim() || undefined,
      });
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save these changes.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openUpload = (caseId: string) => {
    setUploadCaseId(caseId);
    setUploadLabel('');
    upload.reset();
  };

  const onPickCamera = async () => { const file = await pickFromCamera(); upload.pick(file); };
  const onPickGallery = async () => { const file = await pickFromGallery(); upload.pick(file); };

  const doUpload = () => {
    if (!uploadCaseId || !uploadLabel.trim()) {
      setError('A document label is required.');
      return;
    }
    return upload.upload((file, ctrl) => uploadLegalDocument(uploadCaseId, file, uploadLabel.trim(), ctrl)).then((result) => {
      if (result) {
        setUploadCaseId(null);
        setUploadLabel('');
        upload.reset();
        setDocs((prev) => ({ ...prev, [uploadCaseId]: [result, ...(prev[uploadCaseId] ?? [])] }));
      }
    });
  };

  if (showNewCase) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'New Case' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowNewCase(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          <View style={styles.chipRow}>
            {CASE_SECTIONS.map((s) => (
              <Pressable key={s} onPress={() => setNewSection(s)} style={[styles.chip, { backgroundColor: newSection === s ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={newSection === s ? styles.chipLabelActive : undefined}>{s}</ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput value={newTitle} onChangeText={setNewTitle} placeholder="Title *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={newStatus} onChangeText={setNewStatus} placeholder="Status *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={newHearingDate} onChangeText={setNewHearingDate} placeholder="Next hearing date (YYYY-MM-DD, optional)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={newNotes} onChangeText={setNewNotes} placeholder="Notes (optional)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <Pressable onPress={onCreateCase} disabled={isCreating} style={styles.button}>
            {isCreating ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Create case</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Legal' }} />
      {forbidden ? (
        <ThemedView style={styles.center}>
          <ThemedText themeColor="textSecondary">
            You don&apos;t have access to Legal. This is granted per-person, not by role — ask the owner if you
            believe you should have access.
          </ThemedText>
        </ThemedView>
      ) : (
        <>
          <View style={styles.sectionTabRow}>
            {CASE_SECTIONS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSectionTab(s)}
                style={[styles.sectionTab, { backgroundColor: sectionTab === s ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={sectionTab === s ? styles.buttonLabel : undefined}>{s}</ThemedText>
              </Pressable>
            ))}
          </View>
          {!forbidden && (
            <Pressable onPress={() => { setNewSection(sectionTab); setShowNewCase(true); }} style={styles.newButtonOuter}>
              <ThemedText style={styles.buttonLabel}>+ New Case</ThemedText>
            </Pressable>
          )}
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {cases === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : (
            <ScrollView
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
              refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
            >
              {cases.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No cases.</ThemedText>
              ) : (
                cases.map((c) => (
                  <ThemedView key={c.id} type="backgroundElement" style={styles.row}>
                    <TouchableOpacity onPress={() => toggleExpand(c.id)} activeOpacity={0.8}>
                      <ThemedText type="smallBold">{c.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {c.section} · {c.status}
                        {c.nextHearingDate ? ` · Next hearing ${new Date(c.nextHearingDate).toLocaleDateString()}` : ''}
                      </ThemedText>
                    </TouchableOpacity>

                    {editingId === c.id ? (
                      <View style={styles.editBlock}>
                        <TextInput value={editTitle} onChangeText={setEditTitle} placeholder="Title" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={editStatus} onChangeText={setEditStatus} placeholder="Status" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={editHearingDate} onChangeText={setEditHearingDate} placeholder="Next hearing date (YYYY-MM-DD)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={editNotes} onChangeText={setEditNotes} placeholder="Notes" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <View style={styles.actionsRow}>
                          <Pressable onPress={onSaveEdit} disabled={isSavingEdit} style={styles.smallButton}>
                            {isSavingEdit ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                          </Pressable>
                          <Pressable onPress={() => setEditingId(null)} style={[styles.smallButton, styles.cancelButton]}>
                            <ThemedText type="small">Cancel</ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.actionsRow}>
                        <Pressable onPress={() => openEdit(c)}><ThemedText type="link">Edit</ThemedText></Pressable>
                        <Pressable onPress={() => openUpload(c.id)}><ThemedText type="link">Upload document</ThemedText></Pressable>
                      </View>
                    )}

                    {uploadCaseId === c.id && (
                      <View style={styles.editBlock}>
                        <TextInput
                          value={uploadLabel}
                          onChangeText={setUploadLabel}
                          placeholder="Document label *"
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        {upload.file ? (
                          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{upload.file.name}</ThemedText>
                        ) : (
                          <View style={styles.actionsRow}>
                            <Pressable onPress={onPickCamera} style={styles.smallButton}><ThemedText style={styles.buttonLabel}>Camera</ThemedText></Pressable>
                            <Pressable onPress={onPickGallery} style={styles.smallButton}><ThemedText style={styles.buttonLabel}>Gallery</ThemedText></Pressable>
                          </View>
                        )}
                        {upload.status === 'uploading' && <ActivityIndicator />}
                        {upload.error && <ThemedText style={styles.error}>{upload.error}</ThemedText>}
                        <View style={styles.actionsRow}>
                          <Pressable onPress={doUpload} disabled={!upload.file || upload.status === 'uploading'} style={styles.smallButton}>
                            <ThemedText style={styles.buttonLabel}>Upload</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => { setUploadCaseId(null); upload.reset(); }} style={[styles.smallButton, styles.cancelButton]}>
                            <ThemedText type="small">Cancel</ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {expandedId === c.id && (
                      <ThemedView style={styles.docsWrap}>
                        {docsError[c.id] ? (
                          <ThemedText type="small" style={styles.error}>{docsError[c.id]}</ThemedText>
                        ) : !docs[c.id] ? (
                          <ActivityIndicator />
                        ) : docs[c.id].length === 0 ? (
                          <ThemedText type="small" themeColor="textSecondary">No documents.</ThemedText>
                        ) : (
                          docs[c.id].map((d) => (
                            <ThemedText key={d.id} type="small" themeColor="textSecondary">
                              {d.label} — {d.filename}
                            </ThemedText>
                          ))
                        )}
                      </ThemedView>
                    )}
                  </ThemedView>
                ))
              )}
            </ScrollView>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  docsWrap: { marginTop: Spacing.two, gap: Spacing.half },
  newButtonOuter: { margin: Spacing.three, marginBottom: 0, height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  sectionTabRow: { flexDirection: 'row', gap: Spacing.two, marginHorizontal: Spacing.three, marginTop: Spacing.three },
  sectionTab: { flex: 1, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  button: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  smallButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.two },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  editBlock: { gap: Spacing.one, marginTop: Spacing.two },
  actionsRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one, alignItems: 'center' },
});
