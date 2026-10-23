import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { InviteLinkCard } from '@/components/applications/invite-link-card';
import { inviteStatusLabel } from '@/components/applications/invite-status';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchInterviewInvite, getErrorMessage, sendInterviewInvite } from '@/lib/api';
import type { Application, ApplicationInvite } from '@/types/api';

// Mirrors the backend's parseInviteExpiryHours bounds (1 hour – 30 days) and
// its default (APPLICATION_INVITE_TTL_HOURS = 48).
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 24 * 30;

// Rendered only when the backend would accept the call: status AI_INTERVIEW,
// not converted, and a role set. (An approved competency template for the role
// is also required — the server checks that and says so.)
export function AiInterviewInviteSection({ application }: { application: Application }) {
  const theme = useTheme();
  const eligible = application.status === 'AI_INTERVIEW' && !application.convertedUserId && !!application.roleApplied;

  const [invite, setInvite] = useState<ApplicationInvite | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('48');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noTemplate, setNoTemplate] = useState(false);
  const [result, setResult] = useState<{ message?: string; link?: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setInvite(await fetchInterviewInvite(application.id));
    } catch (err: any) {
      setLoadError(getErrorMessage(err, 'Could not load interview invite status.'));
    }
  }, [application.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    if (eligible) load();
  }, [eligible, load]);

  if (!eligible) return null;

  const send = async (hours: number) => {
    setSending(true);
    setError(null);
    setNoTemplate(false);
    setResult(null);
    try {
      const res = await sendInterviewInvite(application.id, hours);
      // The link is only needed when the email didn't go out.
      setResult({ message: res.message, link: res.emailSent ? undefined : res.inviteLink });
      await load();
    } catch (err: any) {
      setNoTemplate(!!err?.response?.data?.noLiveTemplate);
      setError(getErrorMessage(err, 'Could not send the interview invite.'));
    } finally {
      setSending(false);
    }
  };

  const confirmSend = () => {
    const hours = Number(expiry);
    if (!Number.isInteger(hours) || hours < MIN_EXPIRY_HOURS || hours > MAX_EXPIRY_HOURS) {
      setError(`Link expiry must be a whole number of hours between ${MIN_EXPIRY_HOURS} and ${MAX_EXPIRY_HOURS}.`);
      setNoTemplate(false);
      return;
    }
    setError(null);
    const resend = !!invite;
    Alert.alert(
      resend ? 'Resend interview invite?' : 'Send interview invite?',
      `Emails ${application.name} a personal AI interview link that expires in ${hours} hour${hours === 1 ? '' : 's'}.${
        resend ? ' Any earlier pending link stops working.' : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: resend ? 'Resend' : 'Send', onPress: () => send(hours) },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">AI interview invite</ThemedText>

      {loadError ? (
        <View>
          <ThemedText style={styles.error}>{loadError}</ThemedText>
          <Pressable onPress={load} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : invite === undefined ? (
        <ActivityIndicator size="small" />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {invite
            ? `${inviteStatusLabel(invite)} · sent ${new Date(invite.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
            : 'No interview invite has been sent.'}
        </ThemedText>
      )}

      <ThemedText type="small" themeColor="textSecondary">Link expires in (hours)</ThemedText>
      <TextInput
        value={expiry}
        onChangeText={setExpiry}
        keyboardType="number-pad"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {noTemplate && (
        <ThemedText type="small" themeColor="textSecondary">
          Competency templates are managed on the dashboard&apos;s Competencies page — approve one for this role, then send again.
        </ThemedText>
      )}

      <Pressable onPress={confirmSend} disabled={sending} style={styles.button}>
        {sending ? (
          <View style={styles.row}>
            <ActivityIndicator color="#ffffff" />
            <ThemedText style={styles.buttonLabel}>Sending… this can take a minute</ThemedText>
          </View>
        ) : (
          <ThemedText style={styles.buttonLabel}>{invite ? 'Resend interview invite' : 'Send interview invite'}</ThemedText>
        )}
      </Pressable>

      {result && <InviteLinkCard message={result.message} link={result.link} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { width: 120, height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  error: { color: '#B83030' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
