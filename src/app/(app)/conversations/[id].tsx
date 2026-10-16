import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { fetchConversation, sendConversationMessage } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';
import type { Conversation, ConversationMessage } from '@/types/api';

export default function ConversationThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList<ConversationMessage>>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setConversation(await fetchConversation(id));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not load this conversation.');
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onSend = async () => {
    const content = draft.trim();
    if (!content) return;
    setIsSending(true);
    setDraft('');
    try {
      const message = await sendConversationMessage(id, content);
      setConversation((prev) => (prev ? { ...prev, messages: [...prev.messages, message] } : prev));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not send that message.');
      setDraft(content);
    } finally {
      setIsSending(false);
    }
  };

  if (!conversation) {
    return (
      <ThemedView style={styles.center}>
        {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: conversation.customerName || conversation.customerPhone }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}>
        <FlatList
          ref={listRef}
          data={conversation.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const fromUs = item.senderType === 'EMPLOYEE';
            return (
              <View style={[styles.bubbleRow, fromUs && styles.bubbleRowRight]}>
                <ThemedView
                  type="backgroundElement"
                  style={[styles.bubble, fromUs && { backgroundColor: '#7A1C2E' }]}>
                  <ThemedText style={fromUs ? styles.bubbleTextLight : undefined}>{item.content}</ThemedText>
                </ThemedView>
              </View>
            );
          }}
        />

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        <View style={[styles.composer, { paddingBottom: Spacing.three + insets.bottom }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
          />
          <Pressable onPress={onSend} disabled={isSending || !draft.trim()} style={styles.sendButton}>
            <ThemedText style={styles.sendLabel}>{isSending ? '…' : 'Send'}</ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messages: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: Spacing.three, padding: Spacing.two },
  bubbleTextLight: { color: '#ffffff' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sendButton: {
    height: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: '#7A1C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#B83030', paddingHorizontal: Spacing.three },
});
