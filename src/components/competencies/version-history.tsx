import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Layout, Spacing } from '@/constants/theme';
import { fetchCompetencyTemplateVersions, getErrorMessage } from '@/lib/api';
import type { CompetencyTemplate } from '@/types/api';

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Read-only list of every version of a role's template (newest first).
export function VersionHistory({ templateId, roleName, onBack }: { templateId: string; roleName: string; onBack: () => void }) {
  const [versions, setVersions] = useState<CompetencyTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setVersions(await fetchCompetencyTemplateVersions(templateId));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load version history.'));
    }
  }, [templateId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} style={styles.backLink}>
        <ThemedText type="small">← Back to template</ThemedText>
      </Pressable>
      <ThemedText type="smallBold">History — {roleName}</ThemedText>

      {error ? (
        <GlassCard>
          <ThemedText style={styles.error}>{error}</ThemedText>
          <Pressable onPress={load} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </GlassCard>
      ) : versions === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : versions.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No versions found.</ThemedText>
      ) : (
        versions.map((v) => (
          <Pressable key={v.id} onPress={() => setOpenId(openId === v.id ? null : v.id)}>
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={styles.head}>
                <ThemedText type="smallBold">Version {v.version}{v.isCurrent ? ' · current' : ''}</ThemedText>
                <ThemedText type="small" style={{ color: v.status === 'APPROVED' ? '#167A48' : '#A86018', fontWeight: '600' }}>
                  {v.status === 'APPROVED' ? 'Approved' : 'Draft'}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {v.source === 'AI_SUGGESTED' ? 'AI suggested' : 'Manual'} · updated {fmtDate(v.updatedAt)}
                {v.updatedBy ? ` by ${v.updatedBy.name}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {v.competencies.length} competenc{v.competencies.length === 1 ? 'y' : 'ies'} · {openId === v.id ? 'tap to hide' : 'tap to view'}
              </ThemedText>
              {openId === v.id && (
                <View style={styles.list}>
                  {v.competencies.map((c) => (
                    <View key={c.id} style={styles.line}>
                      <ThemedText type="small" style={styles.flex1}>{c.name}</ThemedText>
                      <ThemedText type="smallBold">{c.weightage}%</ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </ThemedView>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  wrap: { gap: Spacing.two },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  spinner: { marginTop: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  list: { marginTop: Spacing.two, gap: Spacing.one },
  line: { flexDirection: 'row', gap: Spacing.two },
  error: { color: '#B83030' },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
