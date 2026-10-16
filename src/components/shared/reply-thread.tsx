import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Structural, not WorkDocReply specifically — this same shape is satisfied
// by WorkDocReply and TimesheetEntryReply alike, mirroring the dashboard's
// ReplyThread component (frontend/src/components/shared/ReplyThread.tsx).
interface ReplyItem {
  id: string;
  authorId: string;
  author?: { id: string; name: string };
  message: string;
}

interface ReplyThreadProps {
  replies: ReplyItem[];
  currentUserId: string;
  onSend: (message: string) => Promise<void>;
  sending?: boolean;
  placeholder?: string;
  quickReplies?: string[];
}

const DEFAULT_QUICK_REPLIES = ['👍 Got it', 'On it', 'Will check'];

export function ReplyThread({
  replies, currentUserId, onSend, sending = false,
  placeholder = 'Write a reply…', quickReplies = DEFAULT_QUICK_REPLIES,
}: ReplyThreadProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    await onSend(trimmed);
    setDraft('');
  };

  const sendCanned = async (text: string) => {
    if (sending) return;
    await onSend(text);
  };

  return (
    <View style={styles.container}>
      {replies.length > 0 && (
        <View style={styles.replies}>
          {replies.map((r) => {
            const isMe = r.authorId === currentUserId;
            return (
              <View key={r.id} style={[styles.bubbleRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}>
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: isMe ? theme.primary : theme.backgroundElement,
                      borderColor: theme.border,
                      borderWidth: isMe ? 0 : 1,
                    },
                  ]}>
                  {!isMe && (
                    <ThemedText type="small" style={[styles.author, { color: theme.textSecondary }]}>
                      {r.author?.name ?? 'Unknown'}
                    </ThemedText>
                  )}
                  <ThemedText type="small" style={isMe ? styles.messageMe : undefined}>
                    {r.message}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {quickReplies.length > 0 && (
        <View style={styles.quickRow}>
          {quickReplies.map((q) => (
            <Pressable
              key={q}
              disabled={sending}
              onPress={() => sendCanned(q)}
              style={[styles.quickChip, { borderColor: theme.border, backgroundColor: theme.background, opacity: sending ? 0.5 : 1 }]}>
              <ThemedText type="small" themeColor="textSecondary">{q}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.composeRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          editable={!sending}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        />
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim() || sending}
          style={[styles.sendButton, { backgroundColor: theme.primary, opacity: !draft.trim() || sending ? 0.5 : 1 }]}>
          {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <ThemedText type="smallBold" style={styles.sendLabel}>Send</ThemedText>}
        </Pressable>
      </View>
    </View>
  );
}

export default ReplyThread;

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  replies: { gap: Spacing.one },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: Radii.md, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  author: { marginBottom: 2 },
  messageMe: { color: '#ffffff' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  quickChip: { paddingHorizontal: Spacing.two, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  composeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  input: { flex: 1, borderWidth: 1, borderRadius: Radii.md, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  sendButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radii.md, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  sendLabel: { color: '#ffffff' },
});
