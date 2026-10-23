import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { isDegradedScreening, scoreColor } from '@/components/applications/scoring';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getErrorMessage, runAiScreening } from '@/lib/api';
import type { Application } from '@/types/api';

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Mirrors POST /:id/ai-screen's own gate: a résumé on file, a role set, and
// not converted. The server re-checks all three and returns a specific message.
function screenBlockedReason(a: Application): string | null {
  if (a.convertedUserId) return 'Already converted to a candidate — AI screening no longer applies.';
  if (!a.resumeFilename) return 'No résumé uploaded — AI screening needs one.';
  if (!a.roleApplied) return 'No role set — AI screening needs a role applied for.';
  return null;
}

export function AiScreeningSection({ application, onApplicationChanged }: {
  application: Application;
  onApplicationChanged: (app: Application) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = application.aiScreeningResult;
  const degraded = isDegradedScreening(result);
  const blocked = screenBlockedReason(application);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      onApplicationChanged(await runAiScreening(application.id));
    } catch (err: any) {
      // The server's message states the exact reason (no résumé / no role / …).
      setError(getErrorMessage(err, 'Could not run AI screening.'));
    } finally {
      setRunning(false);
    }
  };

  const confirmRun = () => {
    Alert.alert(
      result ? 'Re-run AI screening?' : 'Run AI screening?',
      `Reads ${application.name}'s résumé and scores the fit for ${application.roleApplied}. This can take up to a minute or two.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: result ? 'Re-run' : 'Run', onPress: run },
      ],
    );
  };

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">AI screening (advisory only)</ThemedText>

      {result && (
        <GlassCard>
          {degraded ? (
            <>
              <ThemedText type="smallBold" style={styles.warn}>Not scored</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Screening didn&apos;t produce a score: {result.rationale}</ThemedText>
            </>
          ) : (
            <>
              <ThemedText type="smallBold" style={{ color: scoreColor(result.fitScore) }}>Fit score: {result.fitScore}</ThemedText>
              {result.skillsMatched.length > 0 && (
                <View style={styles.skills}>
                  {result.skillsMatched.map((s, i) => (
                    <View key={`${s}-${i}`} style={styles.skillChip}>
                      <ThemedText type="small">{s}</ThemedText>
                    </View>
                  ))}
                </View>
              )}
              {result.experienceSummary ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Experience</ThemedText>
                  <ThemedText type="small">{result.experienceSummary}</ThemedText>
                </>
              ) : null}
              {result.rationale ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Rationale</ThemedText>
                  <ThemedText type="small">{result.rationale}</ThemedText>
                </>
              ) : null}
            </>
          )}
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
            {application.aiScreenedAt ? fmtDateTime(application.aiScreenedAt) : ''} · {result.modelUsed}
          </ThemedText>
        </GlassCard>
      )}

      {!result && !blocked && <ThemedText type="small" themeColor="textSecondary">Not screened yet.</ThemedText>}
      {blocked && <ThemedText type="small" themeColor="textSecondary">{blocked}</ThemedText>}
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {!blocked && (
        <Pressable onPress={confirmRun} disabled={running} style={styles.button}>
          {running ? (
            <View style={styles.runningRow}>
              <ActivityIndicator color="#ffffff" />
              <ThemedText style={styles.buttonLabel}>Screening… this can take a minute</ThemedText>
            </View>
          ) : (
            <ThemedText style={styles.buttonLabel}>{result ? 'Re-run AI screening' : 'Run AI screening'}</ThemedText>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  label: { marginTop: Spacing.two },
  warn: { color: '#A86018' },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  skillChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four, backgroundColor: 'rgba(127,127,127,0.18)' },
  error: { color: '#B83030' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  runningRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
