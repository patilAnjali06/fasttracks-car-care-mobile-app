import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { type ScreenMeta } from '@/constants/screen-registry';
import { Spacing } from '@/constants/theme';

// All 9 screens in the trimmed app have dedicated route files, so this stub
// should never actually render in normal use — it's kept only as a safety
// fallback for the more/[id].tsx catch-all.
export function ScreenStub({ meta }: { meta: ScreenMeta }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.badge}>
        <ThemedText type="smallBold" style={styles.badgeText}>
          Not available
        </ThemedText>
      </View>

      <ThemedText type="title" style={styles.title}>
        {meta.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary">{meta.purpose}</ThemedText>

      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold">Will call</ThemedText>
        <View style={styles.chipRow}>
          {meta.endpoints.map((ep) => (
            <ThemedText key={ep} type="code" style={styles.chip}>
              {ep}
            </ThemedText>
          ))}
        </View>
      </ThemedView>

      {meta.note && (
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Note</ThemedText>
          <ThemedText themeColor="textSecondary">{meta.note}</ThemedText>
        </ThemedView>
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
        Dashboard route: {meta.dashboardRoute}
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
    backgroundColor: '#E3E4E8',
  },
  badgeText: { color: '#1A1A1A' },
  title: { fontSize: 30, lineHeight: 36 },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    backgroundColor: 'rgba(127,127,127,0.15)',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    overflow: 'hidden',
  },
  footnote: { marginTop: Spacing.two },
});
