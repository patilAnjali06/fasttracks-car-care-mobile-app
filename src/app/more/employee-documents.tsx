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
  deleteIdentityDocument,
  fetchIdentityDocumentDataUri,
  fetchIdentityDocumentsDirectory,
  fetchMyIdentityDocuments,
  getErrorMessage,
  uploadIdentityDocument,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { IdentityDocType, IdentityDocument } from '@/types/api';

// Every route in backend/src/routes/identity-documents.ts (GET /directory,
// POST /:userId, GET /:userId, GET /file/:id, DELETE /file/:id) is gated
// PRIVILEGED_ROLES=[OWNER,HR,STORE_MANAGER,ACCOUNTING] (re-verified
// 2026-09-27 — this list was previously missing ACCOUNTING) OR a
// per-employee 'employee_documents' tab override
// (hasEmployeeDocumentsOverride) — this is the admin directory screen
// those routes were built for, distinct from Personal Info's
// self-view-only screen. Same hybrid gate pattern as Personal Info's
// upload/delete section, applied here to the whole screen since even the
// directory list requires it.
const PRIVILEGED_ROLES = ['OWNER', 'HR', 'STORE_MANAGER', 'ACCOUNTING'];

const DOC_TYPES: { key: IdentityDocType; label: string }[] = [
  { key: 'PAN_CARD', label: 'PAN Card' },
  { key: 'AADHAAR_CARD', label: 'Aadhaar Card' },
  { key: 'OTHER', label: 'Other' },
];

const UPLOAD_RULES = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 10 * 1024 * 1024,
};

export default function EmployeeDocumentsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { status: permStatus, hasTab, refresh: refreshPermissions } = usePermissions();
  const isAuthorized = PRIVILEGED_ROLES.includes(user?.role ?? '') || (permStatus === 'ready' && hasTab('employee_documents'));

  const [directory, setDirectory] = useState<{ id: string; name: string }[] | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [documents, setDocuments] = useState<IdentityDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [docType, setDocType] = useState<IdentityDocType>('PAN_CARD');
  const [docLabel, setDocLabel] = useState('');
  const upload = useFileUpload(UPLOAD_RULES);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setDirectory(await fetchIdentityDocumentsDirectory());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the employee directory.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    if (selected) await loadDocs(selected.id);
    else await load();
    setIsRefreshing(false);
  };

  const loadDocs = async (userId: string) => {
    setIsLoadingDocs(true);
    setError(null);
    try {
      setDocuments(await fetchMyIdentityDocuments(userId));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load documents.'));
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const onSelect = (emp: { id: string; name: string }) => {
    setSelected(emp);
    setDocuments(null);
    setNotice(null);
    upload.reset();
    loadDocs(emp.id);
  };

  const onPickCamera = async () => {
    const file = await pickFromCamera();
    upload.pick(file);
  };
  const onPickGallery = async () => {
    const file = await pickFromGallery();
    upload.pick(file);
  };

  const doUpload = () => {
    if (!selected) return;
    return upload.upload((file, ctrl) =>
      uploadIdentityDocument(selected.id, file, docType, docLabel.trim() || undefined, ctrl),
    ).then((result) => {
      if (result) {
        setDocLabel('');
        upload.reset();
        loadDocs(selected.id);
        setNotice('Document uploaded.');
      }
    });
  };

  const onOpen = async (doc: IdentityDocument) => {
    setOpeningId(doc.id);
    setError(null);
    try {
      const dataUri = await fetchIdentityDocumentDataUri(doc.id, doc.mimeType ?? 'application/octet-stream');
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not open the document.'));
    } finally {
      setOpeningId(null);
    }
  };

  const onDelete = (doc: IdentityDocument) => {
    Alert.alert(
      'Delete this document?',
      `This permanently removes ${doc.label || doc.type.replace('_', ' ')} (${doc.filename}). This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(doc.id);
            setError(null);
            setNotice(null);
            try {
              await deleteIdentityDocument(doc.id);
              setNotice('Document deleted.');
              if (selected) await loadDocs(selected.id);
            } catch (err: any) {
              setError(getErrorMessage(err, 'Could not delete the document.'));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  if (permStatus === 'error') {
    return (
      <ThemedView style={styles.center}>
        <ThemedText style={styles.error}>Couldn&apos;t load your permissions.</ThemedText>
        <Pressable onPress={() => refreshPermissions()} style={styles.retryButton}>
          <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (permStatus === 'idle' || permStatus === 'loading') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Employee Documents is only available to Owner, HR, or Store Manager accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (selected) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: selected.name }} />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <Pressable onPress={() => setSelected(null)} style={styles.backButton} accessibilityLabel="Back to employee directory">
            <ThemedText type="link">‹ Back to directory</ThemedText>
          </Pressable>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

          {isLoadingDocs ? (
            <ActivityIndicator style={styles.spinner} />
          ) : documents === null || documents.length === 0 ? (
            <ThemedText themeColor="textSecondary">None on file yet.</ThemedText>
          ) : (
            documents.map((doc) => (
              <ThemedView key={doc.id} type="backgroundElement" style={styles.docRow}>
                <Pressable onPress={() => onOpen(doc)} disabled={openingId === doc.id} style={styles.docInfo}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">
                    {doc.label || doc.type.replace('_', ' ')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                    {doc.filename}
                  </ThemedText>
                </Pressable>
                <View style={styles.docActions}>
                  {openingId === doc.id && <ActivityIndicator size="small" />}
                  <Pressable
                    onPress={() => onDelete(doc)}
                    disabled={deletingId === doc.id}
                    style={styles.deleteButton}
                    accessibilityLabel={`Delete ${doc.label || doc.type.replace('_', ' ')}`}
                  >
                    {deletingId === doc.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.deleteLabel}>✕</ThemedText>}
                  </Pressable>
                </View>
              </ThemedView>
            ))
          )}

          <GlassCard style={styles.uploadCard}>
            <ThemedText type="smallBold">Add a document</ThemedText>
            <View style={styles.chipRow}>
              {DOC_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setDocType(t.key)}
                  style={[styles.chip, { backgroundColor: docType === t.key ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={docType === t.key ? styles.chipLabelActive : undefined}>{t.label}</ThemedText>
                </Pressable>
              ))}
            </View>
            {docType === 'OTHER' && (
              <TextInput
                value={docLabel}
                onChangeText={setDocLabel}
                placeholder="What is this document?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            )}

            <View style={styles.pickRow}>
              <Pressable onPress={onPickCamera} style={styles.pickButton} accessibilityLabel="Take a photo">
                <ThemedText style={styles.buttonLabel}>Camera</ThemedText>
              </Pressable>
              <Pressable onPress={onPickGallery} style={styles.pickButton} accessibilityLabel="Choose from gallery">
                <ThemedText style={styles.buttonLabel}>Gallery</ThemedText>
              </Pressable>
            </View>

            {upload.file && (
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
                  <Pressable onPress={doUpload} style={styles.uploadButton}>
                    <ThemedText style={styles.buttonLabel}>Upload</ThemedText>
                  </Pressable>
                )}
              </View>
            )}
            {upload.error && <ThemedText style={styles.error}>{upload.error}</ThemedText>}
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Employee Documents' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {directory === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : directory.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No employees found.</ThemedText>
        ) : (
          directory.map((emp) => (
            <Pressable key={emp.id} onPress={() => onSelect(emp)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>{emp.name}</ThemedText>
                <ThemedText type="link">View ›</ThemedText>
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  spinner: { marginTop: Spacing.three },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  retryButton: { height: 44, paddingHorizontal: Spacing.four, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  backButton: { marginBottom: Spacing.one, minHeight: 44, justifyContent: 'center' },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.two + 4, gap: Spacing.two },
  docInfo: { flex: 1, gap: Spacing.half },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { color: '#B83030', fontSize: 16 },
  uploadCard: { gap: Spacing.two, marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  pickRow: { flexDirection: 'row', gap: Spacing.two },
  pickButton: { flex: 1, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  uploadButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
});
