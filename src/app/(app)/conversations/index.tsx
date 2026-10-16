import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { fetchConversations } from '@/lib/api';
import type { Conversation } from '@/types/api';

const STATUS_COLOR: Record<Conversation['status'], string> = {
  ACTIVE: '#167A48',
  WAITING: '#A86018',
  CLOSED: '#5A5A6A',
};

function formatWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ConversationsScreen() {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setConversations(await fetchConversations());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not load conversations.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  if (conversations === null) {
    return (
      <ThemedView style={styles.center}>
        {error ? <ThemedText>{error}</ThemedText> : <ActivityIndicator />}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>
        {conversations.length === 0 && (
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            No conversations assigned to you yet.
          </ThemedText>
        )}

        {conversations.map((c) => {
          const lastMessage = c.messages[c.messages.length - 1];
          return (
            <Link key={c.id} href={`/conversations/${c.id}`} asChild>
              <Pressable>
                <ThemedView type="backgroundElement" style={styles.row}>
                  <View style={styles.rowTop}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                      {c.isHighValue ? '★ ' : ''}
                      {c.customerName || c.customerPhone}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatWhen(c.lastMessageAt)}
                    </ThemedText>
                  </View>
                  {lastMessage && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {lastMessage.content}
                    </ThemedText>
                  )}
                  <View style={styles.rowBottom}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {c.category}
                    </ThemedText>
                    <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[c.status] }]} />
                    <ThemedText type="small" themeColor="textSecondary">
                      {c.status}
                    </ThemedText>
                  </View>
                </ThemedView>
              </Pressable>
            </Link>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  row: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.half },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
});
