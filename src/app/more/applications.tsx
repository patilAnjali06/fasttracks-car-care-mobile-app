import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiScreeningSection } from '@/components/applications/ai-screening-section';
import { CompareView } from '@/components/applications/compare-view';
import { DocumentsSection } from '@/components/applications/documents-section';
import { InterviewSection } from '@/components/applications/interview-section';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchApplicationInvite,
  fetchApplications,
  getErrorMessage,
  inviteApplicant,
  resendApplicationInvite,
  setApplicationStatus,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Application, ApplicationInvite, ApplicationStatus } from '@/types/api';

// Same shape check the backend applies (validateApplicationContact).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors POST /:id/invite/resend's own gate: APPLIED/AI_SCREENING, not
// converted, and an email on file. The server re-checks all three.
function canResendInvite(a: Application) {
  return (a.status === 'APPLIED' || a.status === 'AI_SCREENING') && !a.convertedUserId && !!a.email?.trim();
}

function inviteStatusLabel(inv: ApplicationInvite) {
  if (inv.status === 'USED') return `Used ${fmtDate(inv.usedAt)}`;
  if (inv.status === 'REVOKED') return 'Replaced by a newer invite';
  if (inv.status === 'EXPIRED' || (inv.status === 'PENDING' && new Date(inv.expiresAt) < new Date())) {
    return `Expired ${fmtDate(inv.expiresAt)}`;
  }
  return `Pending — expires ${fmtDate(inv.expiresAt)}`;
}

function InviteLinkCard({ message, link }: { message?: string; link?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await Clipboard.setStringAsync(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Could not copy', 'Select and copy the link manually.');
    }
  };
  return (
    <GlassCard>
      {message ? <ThemedText type="small" style={styles.notice}>{message}</ThemedText> : null}
      {link ? (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.linkLabel}>Invite link</ThemedText>
          <ThemedText type="small" selectable>{link}</ThemedText>
          <Pressable onPress={copy} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>{copied ? 'Copied' : 'Copy link'}</ThemedText>
          </Pressable>
        </>
      ) : null}
    </GlassCard>
  );
}

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

  const [compareOpen, setCompareOpen] = useState(false);

  // Invite Candidate form
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<{ message?: string; link?: string } | null>(null);

  // Per-applicant invite status + resend (detail view)
  const [inviteInfo, setInviteInfo] = useState<ApplicationInvite | null | undefined>(undefined);
  const [inviteInfoError, setInviteInfoError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendResult, setResendResult] = useState<{ message?: string; link?: string } | null>(null);

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

  const loadInviteInfo = useCallback(async (id: string) => {
    setInviteInfo(undefined);
    setInviteInfoError(null);
    try {
      setInviteInfo(await fetchApplicationInvite(id));
    } catch (err: any) {
      setInviteInfoError(getErrorMessage(err, 'Could not load invite status.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on selection
    if (selectedId) loadInviteInfo(selectedId);
  }, [selectedId, loadInviteInfo]);

  const submitInvite = async (name: string, email: string) => {
    setInviting(true);
    setInviteError(null);
    try {
      const res = await inviteApplicant({ name, email });
      // The link is only needed when the email didn't go out.
      setInviteResult({ message: res.message, link: res.emailSent ? undefined : res.inviteLink });
      setInviteName('');
      setInviteEmail('');
      await load();
    } catch (err: any) {
      setInviteError(getErrorMessage(err, 'Could not send the invite.'));
    } finally {
      setInviting(false);
    }
  };

  const onSubmitInvite = () => {
    const name = inviteName.trim();
    const email = inviteEmail.trim();
    if (!name) { setInviteError('Name is required.'); return; }
    if (!email) { setInviteError('Email is required.'); return; }
    if (!EMAIL_RE.test(email)) { setInviteError('Please enter a valid email address.'); return; }
    setInviteError(null);
    Alert.alert('Send invite?', `This creates an application for ${name} and emails an invite link to ${email}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => submitInvite(name, email) },
    ]);
  };

  const submitResend = async (app: Application) => {
    setResending(true);
    setActionError(null);
    setResendResult(null);
    try {
      const res = await resendApplicationInvite(app.id);
      setResendResult({ message: res.message, link: res.inviteLink });
      await loadInviteInfo(app.id);
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not resend the invite.'));
    } finally {
      setResending(false);
    }
  };

  const onResendInvite = (app: Application) => {
    Alert.alert('Resend invite?', `This emails ${app.name} (${app.email}) a new invite link and invalidates the previous one.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resend', onPress: () => submitResend(app) },
    ]);
  };

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

  if (compareOpen) {
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Applications' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <CompareView statusLabels={STATUS_LABELS} onBack={() => setCompareOpen(false)} />
        </ScrollView>
      </View>
    );
  }

  if (inviteOpen) {
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Applications' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => { setInviteOpen(false); setInviteError(null); setInviteResult(null); }} style={styles.backLink}>
            <ThemedText type="small">← All applications</ThemedText>
          </Pressable>

          {inviteResult ? (
            <InviteLinkCard message={inviteResult.message} link={inviteResult.link} />
          ) : (
            <GlassCard>
              <ThemedText type="smallBold">Invite Candidate</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Creates an application and emails the candidate a link to fill in their own details.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Name *</ThemedText>
              <TextInput
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="Candidate name"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                returnKeyType="next"
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Email *</ThemedText>
              <TextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="name@example.com"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                returnKeyType="done"
              />
              {inviteError && <ThemedText style={styles.error}>{inviteError}</ThemedText>}
              <Pressable onPress={onSubmitInvite} disabled={inviting} style={styles.button}>
                {inviting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Send Invite</ThemedText>}
              </Pressable>
            </GlassCard>
          )}
        </ScrollView>
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
            onPress={() => { setSelectedId(null); setActionError(null); setNotice(null); setResendResult(null); }}
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

          <DocumentsSection application={selected} />

          <AiScreeningSection
            application={selected}
            onApplicationChanged={(app) => setItems((list) => (list ? list.map((a) => (a.id === app.id ? app : a)) : list))}
          />

          <ThemedText type="smallBold">Candidate invite</ThemedText>
          {inviteInfoError ? (
            <View>
              <ThemedText style={styles.error}>{inviteInfoError}</ThemedText>
              <Pressable onPress={() => loadInviteInfo(selected.id)} style={styles.button}>
                <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : inviteInfo === undefined ? (
            <ActivityIndicator size="small" />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {inviteInfo ? `${inviteStatusLabel(inviteInfo)} · sent ${fmtDate(inviteInfo.createdAt)}` : 'No invite has been sent.'}
            </ThemedText>
          )}
          {canResendInvite(selected) && (
            <Pressable onPress={() => onResendInvite(selected)} disabled={resending} style={styles.button}>
              {resending ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Resend Invite</ThemedText>}
            </Pressable>
          )}
          {resendResult && <InviteLinkCard message={resendResult.message} link={resendResult.link} />}

          <InterviewSection
            application={selected}
            onApplicationChanged={(app) => setItems((list) => (list ? list.map((a) => (a.id === app.id ? app : a)) : list))}
          />
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
        <View style={styles.headerActions}>
          <Pressable onPress={() => { setInviteOpen(true); setInviteResult(null); setInviteError(null); }} style={styles.inviteButton}>
            <ThemedText style={styles.buttonLabel}>+ Invite Candidate</ThemedText>
          </Pressable>
          <Pressable onPress={() => setCompareOpen(true)} style={[styles.inviteButton, styles.compareButton]}>
            <ThemedText style={styles.buttonLabel}>Compare</ThemedText>
          </Pressable>
        </View>

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
            <Pressable key={a.id} onPress={() => { setSelectedId(a.id); setActionError(null); setNotice(null); setResendResult(null); }}>
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
  headerActions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  compareButton: { backgroundColor: '#8A8A8E' },
  inviteButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, minHeight: Layout.minTouchTarget, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  linkLabel: { marginTop: Spacing.one },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
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
