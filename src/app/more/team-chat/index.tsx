import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchTeamChatEmployees,
  fetchTeamChats,
  getErrorMessage,
  hideTeamChat,
  pinTeamChat,
  startTeamChat,
  unpinTeamChat,
  updateTeamChatNickname,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { TeamChat, TeamChatEmployee } from '@/types/api';

type ListTab = 'all' | 'unread' | 'groups';

// Self-membership-scoped: GET /team-chat filters to chats the caller is a
// member of server-side (backend/src/routes/team_chat_route.ts) — any
// authenticated user, no elevated role gate.
function chatTitle(chat: TeamChat, selfId: string | undefined) {
  if (chat.isGroup) return chat.name ?? 'Group chat';
  const other = chat.members.find((m) => m.userId !== selfId);
  return other?.user.name ?? 'Chat';
}

function lastMessagePreview(chat: TeamChat) {
  const msg = chat.messages[0];
  if (!msg) return 'No messages yet.';
  if (msg.deleted) return '🚫 This message was deleted';
  if (msg.content) return msg.content;
  if (msg.mediaType?.startsWith('image/')) return 'Photo';
  if (msg.mediaType?.startsWith('audio/')) return 'Voice message';
  return 'Attachment';
}

export default function TeamChatListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const theme = useTheme();
  const [chats, setChats] = useState<TeamChat[] | null>(null);
  const [employees, setEmployees] = useState<TeamChatEmployee[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  // Group chat creation — >2 total members makes it a group server-side.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');

  // Nickname editing (PUT /team-chat/contacts/:id/nickname), per-owner.
  const [editingNickId, setEditingNickId] = useState<string | null>(null);
  const [nickInput, setNickInput] = useState('');
  const [isSavingNick, setIsSavingNick] = useState(false);

  // Filter tabs + search — purely client-side over the already-fetched
  // chat list, matching the dashboard exactly (GET /team-chat takes no
  // filter/search query params at all).
  const [listTab, setListTab] = useState<ListTab>('all');
  const [search, setSearch] = useState('');
  const [togglingPinId, setTogglingPinId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChats(await fetchTeamChats());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load team chat.'));
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

  const onOpenPicker = async () => {
    setShowPicker(true);
    setSelectedIds([]);
    setGroupName('');
    if (!employees) {
      try {
        setEmployees(await fetchTeamChatEmployees());
      } catch (err: any) {
        setError(getErrorMessage(err, 'Could not load employees.'));
      }
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onStartChat = async () => {
    if (selectedIds.length === 0) return;
    setIsStarting(true);
    setError(null);
    try {
      const chat = await startTeamChat(selectedIds, selectedIds.length > 1 ? groupName.trim() || undefined : undefined);
      setShowPicker(false);
      await load();
      router.push(`/more/team-chat/${chat.id}`);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not start this chat.'));
    } finally {
      setIsStarting(false);
    }
  };

  const startEditNick = (e: TeamChatEmployee) => {
    setEditingNickId(e.id);
    setNickInput(e.nickname ?? '');
  };

  const onSaveNick = async (contactId: string) => {
    setIsSavingNick(true);
    setError(null);
    try {
      await updateTeamChatNickname(contactId, nickInput.trim());
      setEmployees((prev) => prev?.map((e) => (e.id === contactId ? { ...e, nickname: nickInput.trim() || null } : e)) ?? prev);
      setEditingNickId(null);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save that nickname.'));
    } finally {
      setIsSavingNick(false);
    }
  };

  const onTogglePin = async (chat: TeamChat) => {
    setTogglingPinId(chat.id);
    setError(null);
    try {
      const result = chat.pinnedAt ? await unpinTeamChat(chat.id) : await pinTeamChat(chat.id);
      setChats((prev) => prev?.map((c) => (c.id === chat.id ? { ...c, pinnedAt: result.pinnedAt } : c)) ?? prev);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update this pin.'));
    } finally {
      setTogglingPinId(null);
    }
  };

  const onHideChat = (chat: TeamChat) => {
    Alert.alert('Delete this chat?', 'This removes it from your list only — the other person keeps it, and it comes back if they message you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await hideTeamChat(chat.id);
            setChats((prev) => prev?.filter((c) => c.id !== chat.id) ?? prev);
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete this chat.'));
          }
        },
      },
    ]);
  };

  const filteredChats = useMemo(() => {
    if (!chats) return null;
    const q = search.trim().toLowerCase();
    const filtered = chats.filter((c) => {
      if (listTab === 'unread' && (c.unreadCount ?? 0) === 0) return false;
      if (listTab === 'groups' && !c.isGroup) return false;
      if (q && !chatTitle(c, user?.id).toLowerCase().includes(q)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      return new Date(b.lastMsgAt ?? 0).getTime() - new Date(a.lastMsgAt ?? 0).getTime();
    });
  }, [chats, listTab, search, user?.id]);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      <Pressable onPress={onOpenPicker} style={styles.newButton}>
        <ThemedText style={styles.newButtonLabel}>+ New chat</ThemedText>
      </Pressable>

      {error && <ThemedText style={styles.error}>{error}</ThemedText>}

      {showPicker && (
        <ThemedView type="backgroundElement" style={styles.picker}>
          <ThemedText type="smallBold">Start a chat with (select one or more)</ThemedText>
          {employees === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : (
            employees
              .filter((e) => e.id !== user?.id)
              .map((e) => (
                <View key={e.id}>
                  {editingNickId === e.id ? (
                    <View style={styles.nickRow}>
                      <TextInput
                        value={nickInput}
                        onChangeText={setNickInput}
                        placeholder={e.name}
                        placeholderTextColor={theme.textSecondary}
                        autoFocus
                        style={[styles.nickInput, { color: theme.text, backgroundColor: theme.background }]}
                      />
                      <Pressable onPress={() => onSaveNick(e.id)} disabled={isSavingNick}>
                        {isSavingNick ? <ActivityIndicator size="small" /> : <ThemedText type="link">Save</ThemedText>}
                      </Pressable>
                      <Pressable onPress={() => setEditingNickId(null)}>
                        <ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.pickerRow}>
                      <Pressable onPress={() => toggleSelected(e.id)} style={styles.flex1}>
                        <View style={styles.pickerRowInner}>
                          <ThemedText type="small">{selectedIds.includes(e.id) ? '☑' : '☐'} {e.nickname ?? e.name}</ThemedText>
                        </View>
                      </Pressable>
                      <Pressable onPress={() => startEditNick(e)} accessibilityLabel={`Edit nickname for ${e.name}`}>
                        <ThemedText type="small" themeColor="textSecondary">✎</ThemedText>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))
          )}
          {selectedIds.length > 1 && (
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group name (optional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.nickInput, { color: theme.text, backgroundColor: theme.background, marginTop: Spacing.two }]}
            />
          )}
          <View style={styles.pickerActions}>
            <Pressable onPress={() => setShowPicker(false)} style={styles.cancelRow}>
              <ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText>
            </Pressable>
            <Pressable onPress={onStartChat} disabled={selectedIds.length === 0 || isStarting} style={styles.startButton}>
              {isStarting ? <ActivityIndicator color="#ffffff" size="small" /> : (
                <ThemedText style={styles.newButtonLabel}>{selectedIds.length > 1 ? 'Create group' : 'Start chat'}</ThemedText>
              )}
            </Pressable>
          </View>
        </ThemedView>
      )}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search chats"
        placeholderTextColor={theme.textSecondary}
        style={[styles.searchInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <View style={styles.tabRow}>
        {(['all', 'unread', 'groups'] as ListTab[]).map((t) => (
          <Pressable key={t} onPress={() => setListTab(t)} style={[styles.tabButton, { backgroundColor: listTab === t ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={listTab === t ? styles.newButtonLabel : undefined}>{t === 'all' ? 'All' : t === 'unread' ? 'Unread' : 'Groups'}</ThemedText>
          </Pressable>
        ))}
      </View>

      {filteredChats === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : filteredChats.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No chats match.</ThemedText>
      ) : (
        filteredChats.map((chat) => (
          <View key={chat.id} style={styles.chatRowWrap}>
            <Pressable onPress={() => router.push(`/more/team-chat/${chat.id}`)} style={styles.flex1}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold">{chat.pinnedAt ? '📌 ' : ''}{chatTitle(chat, user?.id)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {lastMessagePreview(chat)}
                  </ThemedText>
                </View>
                {chat.unreadCount > 0 && (
                  <ThemedView type="backgroundElement" style={styles.badge}>
                    <ThemedText type="small" style={styles.badgeLabel}>{chat.unreadCount}</ThemedText>
                  </ThemedView>
                )}
              </ThemedView>
            </Pressable>
            <View style={styles.chatActions}>
              <Pressable onPress={() => onTogglePin(chat)} disabled={togglingPinId === chat.id}>
                {togglingPinId === chat.id ? <ActivityIndicator size="small" /> : <ThemedText type="small" themeColor="textSecondary">{chat.pinnedAt ? 'Unpin' : 'Pin'}</ThemedText>}
              </Pressable>
              {!chat.isGroup && (
                <Pressable onPress={() => onHideChat(chat)}><ThemedText type="small" style={styles.error}>Delete</ThemedText></Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  error: { color: '#B83030', marginTop: Spacing.one },
  spinner: { marginTop: Spacing.three },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  flex1: { flex: 1 },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  newButtonLabel: { color: '#ffffff', fontWeight: '600' },
  picker: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.one, gap: Spacing.two },
  pickerRowInner: { paddingVertical: 2 },
  cancelRow: { paddingTop: Spacing.one },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  nickInput: { flex: 1, height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 14 },
  pickerActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.one },
  startButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  badge: { backgroundColor: '#7A1C2E', borderRadius: 12, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeLabel: { color: '#ffffff', fontWeight: '700' },
  searchInput: { height: 40, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 14 },
  tabRow: { flexDirection: 'row', gap: Spacing.one },
  tabButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999 },
  chatRowWrap: { gap: Spacing.half },
  chatActions: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.one },
});
