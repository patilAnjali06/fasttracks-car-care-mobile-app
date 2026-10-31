import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { scoreColor, scorecardScore, screeningScore } from '@/components/applications/scoring';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCandidateComparison, fetchRoleCoverage, getErrorMessage } from '@/lib/api';
import type { ApplicationStatus, CompareCandidate, RoleCoverage } from '@/types/api';

type SortKey = 'name' | 'screening' | 'interview' | 'assignment';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'screening', label: 'Screening' },
  { key: 'interview', label: 'Interview' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'name', label: 'Name' },
];

function ScoreLine({ label, score, emptyText }: { label: string; score: number | null; emptyText: string }) {
  return (
    <View style={styles.scoreLine}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      {score === null ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>{emptyText}</ThemedText>
      ) : (
        <ThemedText type="smallBold" style={{ color: scoreColor(score) }}>{score}</ThemedText>
      )}
    </View>
  );
}

function scoreOf(c: CompareCandidate, key: SortKey): number | null {
  if (key === 'screening') return screeningScore(c.aiScreeningResult);
  if (key === 'interview') return scorecardScore(c.aiInterviewScorecard);
  if (key === 'assignment') return c.aiAssignmentScorecard?.weightedOverallScore ?? null;
  return null;
}

// Read-only candidate comparison for one role. Stages the backend returns as
// null render as "not yet completed" — never as 0.
export function CompareView({ statusLabels, onBack, initialRole }: {
  statusLabels: Record<ApplicationStatus, string>;
  onBack: () => void;
  /** Open straight on one role (the row's own Compare button); empty/omitted = pick a role. */
  initialRole?: string;
}) {
  const theme = useTheme();
  const [roles, setRoles] = useState<RoleCoverage[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(initialRole || null);
  const [candidates, setCandidates] = useState<CompareCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('screening');

  const loadRoles = useCallback(async () => {
    setRolesError(null);
    try {
      setRoles(await fetchRoleCoverage());
    } catch (err: any) {
      setRolesError(getErrorMessage(err, 'Could not load roles.'));
    }
  }, []);

  const loadCandidates = useCallback(async (r: string) => {
    setError(null);
    setCandidates(null);
    try {
      setCandidates(await fetchCandidateComparison(r));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load the comparison.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    loadRoles();
    if (initialRole) loadCandidates(initialRole);
  }, [loadRoles, loadCandidates, initialRole]);

  const sorted = useMemo(() => {
    if (!candidates) return [];
    return [...candidates].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      const av = scoreOf(a, sortKey);
      const bv = scoreOf(b, sortKey);
      // Incomplete candidates sort last — never like a zero-scorer.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [candidates, sortKey]);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack} style={styles.backLink}>
        <ThemedText type="small">← All applications</ThemedText>
      </Pressable>
      <ThemedText type="smallBold">Compare candidates</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Active candidates (not rejected or already converted) for one role, side by side.
      </ThemedText>

      {rolesError ? (
        <GlassCard>
          <ThemedText style={styles.error}>{rolesError}</ThemedText>
          <Pressable onPress={loadRoles} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </GlassCard>
      ) : roles === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : roles.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No applications with a role yet.</ThemedText>
      ) : (
        <View style={styles.chipRow}>
          {roles.map((r) => (
            <Pressable
              key={r.roleApplied}
              onPress={() => { setRole(r.roleApplied); loadCandidates(r.roleApplied); }}
              style={[styles.chip, { backgroundColor: role === r.roleApplied ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={role === r.roleApplied ? styles.chipLabelActive : undefined}>
                {r.roleApplied} ({r.applicantCount})
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      {role && (
        error ? (
          <GlassCard>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <Pressable onPress={() => loadCandidates(role)} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </GlassCard>
        ) : candidates === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : candidates.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No active candidates for this role.</ThemedText>
        ) : (
          <>
            <View style={styles.chipRow}>
              <ThemedText type="small" themeColor="textSecondary">Sort by</ThemedText>
              {SORTS.map((s) => (
                <Pressable key={s.key} onPress={() => setSortKey(s.key)} style={[styles.chip, { backgroundColor: sortKey === s.key ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={sortKey === s.key ? styles.chipLabelActive : undefined}>{s.label}</ThemedText>
                </Pressable>
              ))}
            </View>
            {sorted.map((c) => (
              <ThemedView key={c.id} type="backgroundElement" style={styles.card}>
                <View style={styles.cardHeader}>
                  <ThemedText type="smallBold" style={styles.flex1} numberOfLines={1} ellipsizeMode="tail">{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{statusLabels[c.status]}</ThemedText>
                </View>
                <ScoreLine label="Screening" score={screeningScore(c.aiScreeningResult)} emptyText={c.aiScreeningResult ? 'not scored' : 'not yet completed'} />
                <ScoreLine
                  label="Interview"
                  score={scorecardScore(c.aiInterviewScorecard)}
                  emptyText={c.aiInterviewScorecard ? 'not enough data' : 'not yet completed'}
                />
                <ScoreLine label="Assignment" score={c.aiAssignmentScorecard?.weightedOverallScore ?? null} emptyText="not yet completed" />
              </ThemedView>
            ))}
          </>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  wrap: { gap: Spacing.two },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  spinner: { marginTop: Spacing.three },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  scoreLine: { flexDirection: 'row', justifyContent: 'space-between' },
  italic: { fontStyle: 'italic' },
  error: { color: '#B83030' },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
