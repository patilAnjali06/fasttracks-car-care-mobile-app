import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SCREEN_REGISTRY } from '@/constants/screen-registry';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

export default function MoreScreen() {
  const { user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.six + insets.bottom }]}>
      <ThemedView type="backgroundElement" style={styles.profileCard}>
        <ThemedText type="smallBold">{user?.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {user?.role}
        </ThemedText>
      </ThemedView>

      {(() => {
        const items = SCREEN_REGISTRY.filter(
          (s) => !s.visibleToRoles || s.visibleToRoles.includes(user?.role ?? '')
        );
        if (items.length === 0) return null;
        return (
          <View style={styles.section}>
            <ThemedView type="backgroundElement" style={styles.list}>
              {items.map((item, i) => (
                <Link key={item.id} href={`/more/${item.id}`} asChild>
                  <Pressable
                    style={StyleSheet.flatten([styles.row, i < items.length - 1 && styles.rowDivider])}>
                    <ThemedText style={styles.rowTitle}>{item.title}</ThemedText>
                    <ThemedText themeColor="textSecondary">›</ThemedText>
                  </Pressable>
                </Link>
              ))}
            </ThemedView>
          </View>
        );
      })()}

      <Pressable style={styles.signOut} onPress={signOut}>
        <ThemedText type="link" themeColor="textSecondary">
          Sign out
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  profileCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  section: { gap: Spacing.one },
  sectionTitle: { marginTop: Spacing.one },
  sectionHint: { marginBottom: Spacing.one },
  list: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.25)',
  },
  rowTitle: { fontSize: 15 },
  signOut: { alignItems: 'center', paddingVertical: Spacing.three },
});
