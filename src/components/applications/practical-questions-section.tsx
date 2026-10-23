import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { InviteLinkCard } from '@/components/applications/invite-link-card';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  approvePracticalQuestion,
  deletePracticalQuestion,
  fetchPracticalQuestions,
  generatePracticalQuestions,
  getErrorMessage,
  sendAssessment,
  updatePracticalQuestion,
} from '@/lib/api';
import type { Application, PracticalQuestion } from '@/types/api';

// Mirrors the backend's parseInviteExpiryHours bounds (1 hour – 30 days) and
// its default (APPLICATION_INVITE_TTL_HOURS = 48).
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 24 * 30;
const DEFAULT_EXPIRY_HOURS = '48';

// Rendered only when the backend would accept these actions: status ASSESSMENT
// and not converted.
export function PracticalQuestionsSection({ application }: { application: Application }) {
  const theme = useTheme();
  const eligible = application.status === 'ASSESSMENT' && !application.convertedUserId;

  const [questions, setQuestions] = useState<PracticalQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY_HOURS);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ message?: string; link?: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setQuestions((await fetchPracticalQuestions(application.id)).questions);
    } catch (err: any) {
      setLoadError(getErrorMessage(err, 'Could not load practical questions.'));
    }
  }, [application.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    if (eligible) load();
  }, [eligible, load]);

  if (!eligible) return null;

  const drafts = (questions ?? []).filter((q) => !q.assessmentInviteId);
  const pendingCount = drafts.filter((q) => !q.approvedAt).length;

  const confirmGenerate = () => {
    Alert.alert(
      'Generate questions?',
      `Uses AI to draft practical questions for ${application.roleApplied}. This can take up to a minute or two.${
        drafts.length > 0 ? ' It replaces all unsent questions below, including approved ones.' : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', onPress: generate },
      ],
    );
  };

  const generate = async () => {
    setGenerating(true);
    setActionError(null);
    setNotice(null);
    setSendResult(null);
    setEditingId(null);
    try {
      const res = await generatePracticalQuestions(application.id);
      if (res.message) setNotice(res.message);
      await load();
    } catch (err: any) {
      // Server states the exact reason (stage / role / AI failure).
      setActionError(getErrorMessage(err, 'Could not generate questions.'));
    } finally {
      setGenerating(false);
    }
  };

  const withBusy = async (id: string, fn: () => Promise<void>, fallback: string) => {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, fallback));
    } finally {
      setBusyId(null);
    }
  };

  const approve = (q: PracticalQuestion) =>
    withBusy(q.id, async () => { await approvePracticalQuestion(application.id, q.id); }, 'Could not approve the question.');

  const saveEdit = (q: PracticalQuestion) => {
    const text = editText.trim();
    if (!text) { setActionError('Question text cannot be empty.'); return; }
    return withBusy(
      q.id,
      async () => {
        await updatePracticalQuestion(application.id, q.id, { questionText: text });
        setEditingId(null);
      },
      'Could not save the question.',
    );
  };

  const confirmDelete = (q: PracticalQuestion) => {
    Alert.alert('Delete question?', q.questionText, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => withBusy(q.id, async () => { await deletePracticalQuestion(application.id, q.id); }, 'Could not delete the question.'),
      },
    ]);
  };

  const send = async (hours: number) => {
    setSending(true);
    setActionError(null);
    setNotice(null);
    setSendResult(null);
    try {
      const res = await sendAssessment(application.id, hours);
      // The link is returned only to be shown when the email didn't go out.
      setSendResult({ message: res.message, link: res.emailSent ? undefined : res.inviteLink });
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not send the assessment.'));
    } finally {
      setSending(false);
    }
  };

  const confirmSend = () => {
    const hours = Number(expiry);
    if (!Number.isInteger(hours) || hours < MIN_EXPIRY_HOURS || hours > MAX_EXPIRY_HOURS) {
      setActionError(`Link expiry must be a whole number of hours between ${MIN_EXPIRY_HOURS} and ${MAX_EXPIRY_HOURS}.`);
      return;
    }
    setActionError(null);
    const what = drafts.length > 0
      ? `${drafts.length} question${drafts.length === 1 ? '' : 's'}${pendingCount > 0 ? ` (${pendingCount} not yet approved will be approved automatically)` : ''}`
      : 'the questions already sent';
    Alert.alert(
      drafts.length > 0 ? 'Send assessment?' : 'Resend assessment?',
      `Emails ${application.name} a link to the assessment with ${what}. The link expires in ${hours} hour${hours === 1 ? '' : 's'}, and the questions are locked once sent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: drafts.length > 0 ? 'Send' : 'Resend', onPress: () => send(hours) },
      ],
    );
  };

  const busy = generating || sending || busyId !== null;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Practical assessment</ThemedText>

      {loadError ? (
        <View>
          <ThemedText style={styles.error}>{loadError}</ThemedText>
          <Pressable onPress={load} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : questions === null ? (
        <ActivityIndicator size="small" />
      ) : (
        <>
          {questions.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No practical questions yet. Generate a draft set to review.</ThemedText>
          ) : (
            questions.map((q) => {
              const locked = !!q.assessmentInviteId;
              const editing = editingId === q.id;
              const rowBusy = busyId === q.id;
              return (
                <ThemedView key={q.id} type="backgroundElement" style={styles.card}>
                  <View style={styles.badgeRow}>
                    {locked ? (
                      <ThemedText type="small" style={styles.sent}>Sent · locked</ThemedText>
                    ) : q.approvedAt ? (
                      <ThemedText type="small" style={styles.approved}>Approved{q.approvedBy ? ` by ${q.approvedBy.name}` : ''}</ThemedText>
                    ) : (
                      <ThemedText type="small" style={styles.pending}>Pending approval</ThemedText>
                    )}
                  </View>

                  {editing ? (
                    <>
                      <TextInput
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <ThemedText type="small" themeColor="textSecondary">Saving an edit clears this question&apos;s approval.</ThemedText>
                      <View style={styles.row}>
                        <Pressable onPress={() => saveEdit(q)} disabled={rowBusy} style={[styles.smallButton, styles.flex1]}>
                          {rowBusy ? <ActivityIndicator size="small" color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                        </Pressable>
                        <Pressable onPress={() => setEditingId(null)} disabled={rowBusy} style={[styles.smallButton, styles.grey, styles.flex1]}>
                          <ThemedText style={styles.buttonLabel}>Cancel</ThemedText>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
                      <ThemedText type="small">{q.questionText}</ThemedText>
                      {locked ? (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>
                          Already sent to the candidate — can&apos;t be edited, approved or deleted.
                        </ThemedText>
                      ) : (
                        <View style={styles.row}>
                          {!q.approvedAt && (
                            <Pressable onPress={() => approve(q)} disabled={busy} style={[styles.smallButton, styles.green]}>
                              {rowBusy ? <ActivityIndicator size="small" color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Approve</ThemedText>}
                            </Pressable>
                          )}
                          <Pressable onPress={() => { setEditingId(q.id); setEditText(q.questionText); setActionError(null); }} disabled={busy} style={[styles.smallButton, styles.grey]}>
                            <ThemedText style={styles.buttonLabel}>Edit</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => confirmDelete(q)} disabled={busy} style={[styles.smallButton, styles.red]}>
                            <ThemedText style={styles.buttonLabel}>Delete</ThemedText>
                          </Pressable>
                        </View>
                      )}
                    </>
                  )}
                </ThemedView>
              );
            })
          )}

          {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

          <Pressable onPress={confirmGenerate} disabled={busy} style={styles.button}>
            {generating ? (
              <View style={styles.row}>
                <ActivityIndicator color="#ffffff" />
                <ThemedText style={styles.buttonLabel}>Generating… this can take a minute</ThemedText>
              </View>
            ) : (
              <ThemedText style={styles.buttonLabel}>{questions.length > 0 ? 'Regenerate questions' : 'Generate questions'}</ThemedText>
            )}
          </Pressable>

          {questions.length > 0 && (
            <GlassCard>
              <ThemedText type="smallBold">Send to candidate</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Emails {application.name} the assessment and locks the questions.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Link expires in (hours)</ThemedText>
              <TextInput
                value={expiry}
                onChangeText={setExpiry}
                keyboardType="number-pad"
                style={[styles.input, styles.inputShort, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={confirmSend} disabled={busy} style={styles.button}>
                {sending ? <ActivityIndicator color="#ffffff" /> : (
                  <ThemedText style={styles.buttonLabel}>{drafts.length > 0 ? 'Send assessment to candidate' : 'Resend assessment'}</ThemedText>
                )}
              </Pressable>
            </GlassCard>
          )}

          {sendResult && <InviteLinkCard message={sendResult.message} link={sendResult.link} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  badgeRow: { flexDirection: 'row' },
  sent: { color: '#8A8A8E', fontWeight: '600' },
  approved: { color: '#167A48', fontWeight: '600' },
  pending: { color: '#A86018', fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  input: { minHeight: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15, textAlignVertical: 'top' },
  inputShort: { width: 120, height: 46 },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, marginTop: Spacing.one },
  smallButton: { minHeight: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  green: { backgroundColor: '#167A48' },
  red: { backgroundColor: '#B83030' },
  grey: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
