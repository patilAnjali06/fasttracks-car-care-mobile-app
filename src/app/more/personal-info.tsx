import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteIdentityDocument,
  fetchIdentityDocumentDataUri,
  fetchMyIdentityDocuments,
  fetchMyProfile,
  getErrorMessage,
  revealIdentityDocumentValue,
  uploadIdentityDocument,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { FullProfile, IdentityDocType, IdentityDocument } from '@/types/api';

// Upload/delete are NOT self-accessible on the backend — verified in full
// from backend/src/routes/identity-documents.ts: requireHROrOwnerOrDocsOverride
// gates POST /:userId and DELETE /file/:id with no "self" exception at all
// ("an employee can view their own documents but not add or remove them").
// Only the GET routes (list, file view, reveal-value) have a self exception.
// So this screen's view section is unconditionally self (everyone), and the
// upload/delete controls below only render for PRIVILEGED_ROLES — the
// route's own static bypass array (backend/src/routes/identity-documents.ts:24,
// re-verified 2026-09-27 to include ACCOUNTING, which this list was
// previously missing) — OR a per-employee 'employee_documents' tab override,
// which the dashboard's Configure page can grant to any other role (the
// documented Akshay/CASHIER case in backend/src/lib/tabRegistry.ts). Both
// managing only the caller's OWN documents via this self-view screen —
// uploading/deleting for a DIFFERENT employee is the separate Employee
// Documents admin page (dashboard/employee-documents), not built here.
const PRIVILEGED_ROLES = ['OWNER', 'HR', 'STORE_MANAGER', 'ACCOUNTING'];

// Dashboard's Personal Info page (frontend/src/app/(dashboard)/dashboard/
// personal-info/page.tsx) is a read-only summary — this section replicates
// it exactly (role label map, tenure calc, Active badge, Work pattern card,
// Account/Change-password link, Salary pointer). The document upload/delete
// UI below it is NOT on that dashboard page at all (upload lives on the
// separate Employee Documents admin page) — kept here as an existing,
// working self-service capability rather than removed, since dashboard
// parity is about closing gaps, not stripping a feature nothing else
// replaces yet for this role.
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Founder',
  STORE_MANAGER: 'Store Manager',
  SALES: 'Sales',
  TECHNICIAN: 'Technician',
  TECH_TEAM: 'Tech Team',
  SOCIAL_MEDIA: 'Social Media',
  STAFF: 'Staff',
  INVENTORY_MANAGER: 'Inventory Manager',
  ACCOUNTING: 'Accounting',
  HR: 'HR',
  HOUSEKEEPING: 'Housekeeping',
  CASHIER: 'Cashier',
};

const DOC_TYPE_LABEL: Record<string, string> = {
  PAN_CARD: 'PAN Card', AADHAAR_CARD: 'Aadhaar Card', OTHER: 'Other document',
  PASSPORT: 'Passport', DRIVING_LICENCE: 'Driving Licence', VOTER_ID: 'Voter ID',
  LAST_SALARY_SLIP: 'Last Salary Slip', EDUCATION_CERTIFICATE: 'Education Certificate',
  EXPERIENCE_LETTER: 'Experience Letter',
};

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Whole months and years since a date, for "time at the company". */
function tenure(iso?: string | null) {
  if (!iso) return null;
  const start = new Date(iso);
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  if (start > now) return null;

  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  if (months < 0) return null;

  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rem) parts.push(`${rem} month${rem === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Less than a month';
}

const DOC_TYPES: { key: IdentityDocType; label: string }[] = [
  { key: 'PAN_CARD', label: 'PAN Card' },
  { key: 'AADHAAR_CARD', label: 'Aadhaar Card' },
  { key: 'OTHER', label: 'Other' },
];

const UPLOAD_RULES = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  maxSizeBytes: 10 * 1024 * 1024,
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold" themeColor={value ? undefined : 'textSecondary'} numberOfLines={1} ellipsizeMode="tail" style={styles.rowValue}>
        {value || 'Not set'}
      </ThemedText>
    </View>
  );
}

export default function PersonalInfoScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { status: permStatus, hasTab, refresh: refreshPermissions } = usePermissions();
  const canManage = PRIVILEGED_ROLES.includes(user?.role ?? '') || (permStatus === 'ready' && hasTab('employee_documents'));

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [documents, setDocuments] = useState<IdentityDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const [docType, setDocType] = useState<IdentityDocType>('PAN_CARD');
  const [docLabel, setDocLabel] = useState('');
  const upload = useFileUpload(UPLOAD_RULES);

  const load = useCallback(async () => {
    setError(null);
    try {
      const me = await fetchMyProfile();
      setProfile(me);
      setDocuments(await fetchMyIdentityDocuments(me.id));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load your profile.'));
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

  const onPickCamera = async () => {
    const file = await pickFromCamera();
    upload.pick(file);
  };
  const onPickGallery = async () => {
    const file = await pickFromGallery();
    upload.pick(file);
  };

  const doUpload = () => {
    if (!profile) return;
    return upload.upload((file, ctrl) =>
      uploadIdentityDocument(profile.id, file, docType, docLabel.trim() || undefined, ctrl),
    ).then((result) => {
      if (result) {
        setDocLabel('');
        upload.reset();
        load();
        setNotice('Document uploaded.');
      }
    });
  };

  const onOpen = async (doc: IdentityDocument) => {
    if (!doc.filename) return;
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

  // Self-reveal of your own encrypted document value — same reveal-value
  // endpoint the admin Documents tab uses, which logs every call (action:
  // REVEAL_VALUE) regardless of who's viewing. Only call from this explicit
  // user tap, never automatically.
  const onReveal = async (doc: IdentityDocument) => {
    setRevealingId(doc.id);
    setError(null);
    try {
      const value = await revealIdentityDocumentValue(doc.id);
      setRevealed((prev) => ({ ...prev, [doc.id]: value }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not reveal this value.'));
    } finally {
      setRevealingId(null);
    }
  };

  const onHide = (docId: string) => {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
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
              await load();
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

  if (!profile) {
    return (
      <ThemedView style={styles.center}>
        {error ? (
          <>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <Pressable onPress={load} style={styles.retryButton}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator />
        )}
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Personal Info' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {(() => {
          const roleLabel = ROLE_LABELS[profile.role] ?? profile.role;
          const joined = fmtDate(profile.joiningDate);
          const served = tenure(profile.joiningDate);
          const shift = profile.customClockIn && profile.customClockOut ? `${profile.customClockIn} — ${profile.customClockOut}` : null;
          const hasWorkPattern = !!shift || profile.workingDaysPerMonth != null || profile.defaultLeaves != null;
          return (
            <>
              <ThemedView type="backgroundElement" style={styles.identityCard}>
                <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
                  <ThemedText type="smallBold" style={styles.avatarLabel}>
                    {profile.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" style={styles.identityName}>{profile.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{profile.designation || roleLabel}</ThemedText>
                  <View style={styles.badgeRow}>
                    {profile.employeeId && (
                      <View style={[styles.badge, { backgroundColor: 'rgba(104,15,26,0.12)' }]}>
                        <ThemedText type="small" style={{ color: theme.primary }}>{profile.employeeId}</ThemedText>
                      </View>
                    )}
                    <View style={[styles.badge, { backgroundColor: profile.isActive ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.14)' }]}>
                      <ThemedText type="small" style={{ color: profile.isActive ? '#15803d' : '#4b5563' }}>
                        {profile.isActive ? 'Active' : 'Inactive'}
                      </ThemedText>
                    </View>
                  </View>
                </View>
              </ThemedView>

              <ThemedText type="smallBold" style={styles.cardHeading}>Employment</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <Row label="Role" value={roleLabel} />
                <Row label="Designation" value={profile.designation} />
                <Row label="Employee ID" value={profile.employeeId} />
                <Row label="Login username" value={profile.username} />
                {profile.branch && <Row label="Branch" value={profile.branch} />}
              </ThemedView>

              <ThemedText type="smallBold" style={styles.cardHeading}>Contact</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <Row label="Work phone" value={profile.phone} />
                <Row label="Personal phone" value={profile.personalPhone} />
                <Row label="Work email" value={profile.email} />
                <Row label="Personal email" value={profile.personalEmail} />
              </ThemedView>

              <ThemedText type="smallBold" style={styles.cardHeading}>Joining</ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <Row label="Joined on" value={joined} />
                <Row label="With us for" value={served} />
              </ThemedView>

              {hasWorkPattern && (
                <>
                  <ThemedText type="smallBold" style={styles.cardHeading}>Work pattern</ThemedText>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    {shift && <Row label="Shift timing" value={shift} />}
                    {profile.workingDaysPerMonth != null && <Row label="Working days / month" value={String(profile.workingDaysPerMonth)} />}
                    {profile.defaultLeaves != null && (
                      <Row label="Leave allowance" value={`${profile.defaultLeaves} day${profile.defaultLeaves === 1 ? '' : 's'}`} />
                    )}
                  </ThemedView>
                </>
              )}
            </>
          );
        })()}

        <View style={styles.section}>
          <ThemedText type="smallBold">Identity documents</ThemedText>
          {!canManage && (
            <ThemedText type="small" themeColor="textSecondary">
              Only HR/Owner/Store Manager can add or remove these — you can view your own here.
            </ThemedText>
          )}

          {documents === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : documents.length === 0 ? (
            <ThemedText themeColor="textSecondary">None on file yet.</ThemedText>
          ) : (
            documents.map((doc) => {
              const label = doc.label || DOC_TYPE_LABEL[doc.type] || doc.type.replace('_', ' ');
              return (
                <ThemedView key={doc.id} type="backgroundElement" style={styles.docRow}>
                  <Pressable onPress={() => onOpen(doc)} disabled={!doc.filename || openingId === doc.id} style={styles.docInfo}>
                    <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                      {doc.hasValue ? (revealed[doc.id] ?? doc.maskedValue ?? '••••') : (doc.filename || 'No file attached')}
                    </ThemedText>
                  </Pressable>
                  <View style={styles.docActions}>
                    {openingId === doc.id && <ActivityIndicator size="small" />}
                    {doc.hasValue && (
                      revealed[doc.id] ? (
                        <Pressable onPress={() => onHide(doc.id)} style={styles.revealButton} accessibilityLabel={`Hide ${label}`}>
                          <ThemedText type="small">Hide</ThemedText>
                        </Pressable>
                      ) : (
                        <Pressable onPress={() => onReveal(doc)} disabled={revealingId === doc.id} style={styles.revealButton} accessibilityLabel={`Reveal ${label}`}>
                          {revealingId === doc.id ? <ActivityIndicator size="small" /> : <ThemedText type="small">Reveal</ThemedText>}
                        </Pressable>
                      )
                    )}
                    {canManage && (
                      <Pressable
                        onPress={() => onDelete(doc)}
                        disabled={deletingId === doc.id}
                        style={styles.deleteButton}
                        accessibilityLabel={`Delete ${label}`}
                      >
                        {deletingId === doc.id ? (
                          <ActivityIndicator size="small" />
                        ) : (
                          <ThemedText style={styles.deleteLabel}>✕</ThemedText>
                        )}
                      </Pressable>
                    )}
                  </View>
                </ThemedView>
              );
            })
          )}
        </View>

        <ThemedText type="smallBold" style={styles.cardHeading}>Account</ThemedText>
        <ThemedView type="backgroundElement" style={styles.card}>
          <Pressable onPress={() => router.push('/more/change-password')} style={styles.accountLink}>
            <ThemedText type="smallBold">Change password</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helperText}>
            Something here wrong? Ask your manager or HR to update it — these details are managed from the Employees page.
          </ThemedText>
        </ThemedView>

        <Pressable onPress={() => router.push('/more/my-salary')} style={[styles.salaryLink, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">Salary and payslips are on My Salary →</ThemedText>
        </Pressable>

        {permStatus === 'error' && (
          <View style={styles.section}>
            <ThemedText style={styles.error}>Couldn&apos;t load your permissions.</ThemedText>
            <Pressable onPress={() => refreshPermissions()} style={styles.retryButton}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {canManage && (
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
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  content: { padding: Spacing.four, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { fontSize: 28, lineHeight: 34 },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  section: { gap: Spacing.one },
  spinner: { marginTop: Spacing.two },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.two + 4, gap: Spacing.two },
  docInfo: { flex: 1, gap: Spacing.half },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { color: '#B83030', fontSize: 16 },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  retryButton: { height: 44, paddingHorizontal: Spacing.four, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  uploadCard: { gap: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  pickRow: { flexDirection: 'row', gap: Spacing.two },
  pickButton: { flex: 1, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  flex1: { flex: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  uploadButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: Spacing.three, padding: Spacing.three },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { color: '#ffffff' },
  identityName: { fontSize: 17 },
  badgeRow: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.half, flexWrap: 'wrap' },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999 },
  cardHeading: { marginTop: Spacing.one },
  rowValue: { flex: 1, textAlign: 'right', marginLeft: Spacing.three },
  revealButton: { minHeight: 44, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  accountLink: { minHeight: Spacing.four + Spacing.two, justifyContent: 'center' },
  helperText: { marginTop: Spacing.one },
  salaryLink: { borderRadius: Spacing.three, padding: Spacing.three, borderWidth: 1 },
});
