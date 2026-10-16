import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteTeamChatMessage,
  editTeamChatMessage,
  fetchTeamChatMessages,
  fetchTeamChatPins,
  getErrorMessage,
  markTeamChatRead,
  pinTeamChatMessage,
  sendTeamChatMessage,
  unpinTeamChatMessage,
  uploadTeamChatMedia,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { TeamChatMessage } from '@/types/api';

const EDIT_WINDOW_MS = 60 * 60 * 1000;

function quoteText(q: { deleted: boolean; mediaType: string | null; content: string | null }) {
  if (q.deleted) return 'This message was deleted';
  if (q.mediaType?.startsWith('image/')) return '📷 Image';
  if (q.mediaType?.startsWith('audio/')) return '🎤 Voice';
  return q.content ?? '';
}

// Images only — audio (voice messages) is a real backend-supported type here
// too, but recording/playback needs expo-av/expo-audio, not installed in
// this project. Flagged, not silently built around.
const UPLOAD_RULES = { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], maxSizeBytes: 25 * 1024 * 1024 };

// Membership-scoped: GET/POST /team-chat/:id/messages 403s a caller who
// isn't a member of this chat (backend/src/routes/team_chat_route.ts) — no
// separate client role gate needed.
export default function TeamChatThreadScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const [messages, setMessages] = useState<TeamChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const listRef = useRef<FlatList<TeamChatMessage>>(null);
  const upload = useFileUpload<{ url: string; type: 'image' | 'audio'; mimeType: string }>(UPLOAD_RULES);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<TeamChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [pins, setPins] = useState<TeamChatMessage[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchTeamChatMessages(id);
      setMessages(data);
      markTeamChatRead(id).catch(() => {});
      fetchTeamChatPins(id).then(setPins).catch(() => {});
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load this chat.'));
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onSend = async () => {
    const content = draft.trim();
    if (!content) return;
    setIsSending(true);
    setDraft('');
    setError(null);
    try {
      const message = await sendTeamChatMessage(id, content, undefined, replyingTo?.id);
      setMessages((prev) => (prev ? [...prev, message] : [message]));
      setReplyingTo(null);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that message.'));
      setDraft(content);
    } finally {
      setIsSending(false);
    }
  };

  const onStartEdit = (m: TeamChatMessage) => {
    setSelectedId(null);
    setEditingId(m.id);
    setEditDraft(m.content ?? '');
  };

  const onSaveEdit = async () => {
    if (!editingId || !editDraft.trim()) return;
    setError(null);
    try {
      const updated = await editTeamChatMessage(id, editingId, editDraft.trim());
      setMessages((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? prev);
      setEditingId(null);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save this edit.'));
    }
  };

  const onDeleteMessage = (m: TeamChatMessage) => {
    setSelectedId(null);
    Alert.alert('Delete this message?', 'This deletes it for everyone in the chat.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const updated = await deleteTeamChatMessage(id, m.id);
            setMessages((prev) => prev?.map((x) => (x.id === updated.id ? updated : x)) ?? prev);
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete this message.'));
          }
        },
      },
    ]);
  };

  const onTogglePin = async (m: TeamChatMessage) => {
    setSelectedId(null);
    setError(null);
    try {
      const updatedPins = m.pinnedAt ? await unpinTeamChatMessage(id, m.id) : await pinTeamChatMessage(id, m.id);
      setPins(updatedPins);
      const pinnedIds = new Set(updatedPins.map((p) => p.id));
      setMessages((prev) => prev?.map((x) => ({ ...x, pinnedAt: pinnedIds.has(x.id) ? (x.pinnedAt ?? new Date().toISOString()) : (x.id === m.id ? null : x.pinnedAt) })) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update pin.'));
    }
  };

  const jumpToMessage = (messageId: string) => {
    const idx = messages?.findIndex((m) => m.id === messageId) ?? -1;
    if (idx >= 0) listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
  };

  const onPickCamera = async () => {
    const file = await pickFromCamera();
    if (file) upload.pick(file);
  };
  const onPickGallery = async () => {
    const file = await pickFromGallery();
    if (file) upload.pick(file);
  };

  const onSendMedia = async () => {
    setIsSendingMedia(true);
    setError(null);
    try {
      const result = await upload.upload((file, ctrl) => uploadTeamChatMedia(file, ctrl));
      if (!result) return;
      const message = await sendTeamChatMessage(id, null, { mediaUrl: result.url, mediaType: result.mimeType }, replyingTo?.id);
      setMessages((prev) => (prev ? [...prev, message] : [message]));
      setReplyingTo(null);
      upload.reset();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that photo.'));
    } finally {
      setIsSendingMedia(false);
    }
  };

  if (messages === null) {
    return (
      <ThemedView style={styles.center}>
        {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Chat' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) => {
            const fromMe = item.senderId === user?.id;
            const canChange = fromMe && !item.deleted;
            const canEdit = canChange && !!item.content && !item.mediaUrl && new Date().getTime() - new Date(item.sentAt).getTime() < EDIT_WINDOW_MS;
            const isEditing = editingId === item.id;
            return (
              <View style={[styles.bubbleRow, fromMe && styles.bubbleRowRight]}>
                <Pressable
                  onLongPress={() => !item.deleted && setSelectedId(selectedId === item.id ? null : item.id)}
                  style={styles.bubbleWrap}
                >
                  <ThemedView type="backgroundElement" style={[styles.bubble, fromMe && { backgroundColor: '#7A1C2E' }]}>
                    {!fromMe && <ThemedText type="small" themeColor="textSecondary">{item.sender.name}</ThemedText>}
                    {item.deleted ? (
                      <ThemedText type="small" style={[styles.deletedText, fromMe ? styles.bubbleTextLight : undefined]}>
                        🚫 This message was deleted
                      </ThemedText>
                    ) : (
                      <>
                        {item.forwarded && (
                          <ThemedText type="small" style={fromMe ? styles.bubbleTextLight : undefined}>↪ Forwarded</ThemedText>
                        )}
                        {item.replyTo && (
                          <Pressable onPress={() => jumpToMessage(item.replyTo!.id)} style={styles.quoteBlock}>
                            <ThemedText type="small" style={fromMe ? styles.bubbleTextLight : undefined}>
                              {item.replyTo.senderId === user?.id ? 'You' : item.replyTo.sender.name}
                            </ThemedText>
                            <ThemedText type="small" numberOfLines={1} style={fromMe ? styles.bubbleTextLight : undefined}>
                              {quoteText(item.replyTo)}
                            </ThemedText>
                          </Pressable>
                        )}
                        {item.mediaUrl && item.mediaType?.startsWith('image/') && (
                          <Pressable onPress={() => item.mediaUrl && Linking.openURL(item.mediaUrl)}>
                            <Image source={{ uri: item.mediaUrl }} style={styles.mediaImage} />
                          </Pressable>
                        )}
                        {isEditing ? (
                          <View style={styles.editRow}>
                            <TextInput
                              value={editDraft}
                              onChangeText={setEditDraft}
                              style={[styles.editInput, { color: theme.text, backgroundColor: theme.background }]}
                              multiline
                              autoFocus
                            />
                            <View style={styles.editActions}>
                              <Pressable onPress={onSaveEdit}><ThemedText type="link">Save</ThemedText></Pressable>
                              <Pressable onPress={() => setEditingId(null)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                            </View>
                          </View>
                        ) : item.content ? (
                          <ThemedText style={fromMe ? styles.bubbleTextLight : undefined}>{item.content}</ThemedText>
                        ) : !item.mediaType?.startsWith('image/') && item.mediaType ? (
                          <ThemedText style={fromMe ? styles.bubbleTextLight : undefined} type="small">
                            {item.mediaType?.startsWith('audio/') ? 'Voice message' : 'Attachment'}
                          </ThemedText>
                        ) : null}
                        {item.edited && (
                          <ThemedText type="small" style={[styles.editedLabel, fromMe ? styles.bubbleTextLight : undefined]}>edited</ThemedText>
                        )}
                        {item.pinnedAt && <ThemedText type="small" style={fromMe ? styles.bubbleTextLight : undefined}>📌</ThemedText>}
                      </>
                    )}
                  </ThemedView>
                  {selectedId === item.id && !item.deleted && (
                    <View style={[styles.actionMenu, fromMe && styles.actionMenuRight]}>
                      <Pressable onPress={() => { setSelectedId(null); setReplyingTo(item); }}><ThemedText type="small">Reply</ThemedText></Pressable>
                      <Pressable onPress={() => onTogglePin(item)}><ThemedText type="small">{item.pinnedAt ? 'Unpin' : 'Pin'}</ThemedText></Pressable>
                      {canEdit && <Pressable onPress={() => onStartEdit(item)}><ThemedText type="small">Edit</ThemedText></Pressable>}
                      {canChange && <Pressable onPress={() => onDeleteMessage(item)}><ThemedText type="small" style={styles.deleteLabel}>Delete</ThemedText></Pressable>}
                    </View>
                  )}
                </Pressable>
              </View>
            );
          }}
        />

        {pins && pins.length > 0 && (
          <View style={styles.pinsBar}>
            {pins.map((p) => (
              <Pressable key={p.id} onPress={() => jumpToMessage(p.id)} style={styles.pinRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.flex1}>📌 {p.sender.name}: {quoteText({ deleted: !!p.deleted, mediaType: p.mediaType, content: p.content })}</ThemedText>
              </Pressable>
            ))}
          </View>
        )}

        {replyingTo && (
          <View style={styles.replyBar}>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary">Replying to {replyingTo.senderId === user?.id ? 'yourself' : replyingTo.sender.name}</ThemedText>
              <ThemedText type="small" numberOfLines={1}>{quoteText({ deleted: !!replyingTo.deleted, mediaType: replyingTo.mediaType, content: replyingTo.content })}</ThemedText>
            </View>
            <Pressable onPress={() => setReplyingTo(null)}><ThemedText type="small" themeColor="textSecondary">✕</ThemedText></Pressable>
          </View>
        )}

        {error && (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        )}

        {upload.file && (
          <View style={styles.mediaPreviewRow}>
            <Image source={{ uri: upload.file.uri }} style={styles.mediaPreviewThumb} />
            <ThemedText type="small" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>{upload.file.name}</ThemedText>
            {upload.status === 'uploading' || isSendingMedia ? (
              <ActivityIndicator size="small" />
            ) : upload.status === 'error' ? (
              <Pressable onPress={upload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
            ) : (
              <>
                <Pressable onPress={onSendMedia}><ThemedText type="link">Send</ThemedText></Pressable>
                <Pressable onPress={upload.reset}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
              </>
            )}
          </View>
        )}
        {upload.error && <ThemedText type="small" style={styles.error}>{upload.error}</ThemedText>}

        <View style={[styles.composer, { paddingBottom: Spacing.three + insets.bottom }]}>
          <Pressable onPress={onPickCamera} style={styles.attachButton} accessibilityLabel="Take a photo to send">
            <ThemedText type="link">📷</ThemedText>
          </Pressable>
          <Pressable onPress={onPickGallery} style={styles.attachButton} accessibilityLabel="Choose a photo from gallery to send">
            <ThemedText type="link">🖼</ThemedText>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            multiline
          />
          <Pressable onPress={onSend} disabled={isSending || !draft.trim()} style={styles.sendButton}>
            {isSending ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.sendLabel}>Send</ThemedText>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  messages: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: Spacing.three, padding: Spacing.two },
  bubbleTextLight: { color: '#ffffff' },
  error: { color: '#B83030', paddingHorizontal: Spacing.three },
  composer: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, alignItems: 'flex-end' },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 },
  sendButton: { height: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  sendLabel: { color: '#ffffff', fontWeight: '600' },
  attachButton: { height: 44, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  mediaImage: { width: 200, height: 150, borderRadius: Spacing.two, marginBottom: Spacing.one },
  mediaPreviewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.one, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  mediaPreviewThumb: { width: 40, height: 40, borderRadius: Spacing.one },
  flex1: { flex: 1 },
  bubbleWrap: { maxWidth: '80%' },
  deletedText: { fontStyle: 'italic' },
  deleteLabel: { color: '#B83030' },
  quoteBlock: { borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.4)', paddingLeft: Spacing.one, marginBottom: Spacing.half },
  editedLabel: { fontStyle: 'italic', opacity: 0.7 },
  editRow: { gap: Spacing.one },
  editInput: { minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 15 },
  editActions: { flexDirection: 'row', gap: Spacing.two },
  actionMenu: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.half, paddingHorizontal: Spacing.one },
  actionMenuRight: { justifyContent: 'flex-end' },
  pinsBar: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, gap: 2, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  pinRow: { paddingVertical: 2 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
