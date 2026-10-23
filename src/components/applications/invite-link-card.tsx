import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// A server message plus (optionally) a link HR can copy and send by hand —
// used when an invite email didn't go out (application invite, assessment).
export function InviteLinkCard({ message, link }: { message?: string; link?: string }) {
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

const styles = StyleSheet.create({
  notice: { color: '#167A48' },
  linkLabel: { marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
