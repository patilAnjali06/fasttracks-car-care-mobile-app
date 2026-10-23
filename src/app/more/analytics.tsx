import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart } from '@/components/analytics/bar-chart';
import { GlassCard } from '@/components/home/glass-card';
import { PermissionGate } from '@/components/permission-gate';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { fetchHiringAnalytics, fetchRetentionAnalytics, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { HiringAnalytics, RetentionAnalytics } from '@/types/api';

// GET /analytics/* is router.use(verifyToken, requireHRModuleAccess)
// (backend/src/routes/analytics.ts): OWNER/STORE_MANAGER/HR/ACCOUNTING, or
// anyone granted the hr_module tab. Those four roles pass statically; anyone
// else goes through PermissionGate('hr_module') — fail-closed, same as the
// server.
const ANALYTICS_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

const STAGE_LABELS: Record<keyof HiringAnalytics['stagesCompletedBeforeRejection'], string> = {
  NONE: 'None',
  SCREENED_ONLY: 'Screened',
  INTERVIEWED: 'Interviewed',
  ASSESSED: 'Assessed',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function StatTile({ label, value, color, note }: { label: string; value: string | number | null; color?: string; note?: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="subtitle" style={color ? { color } : undefined}>{value === null ? '—' : value}</ThemedText>
      {note ? <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText> : null}
    </ThemedView>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GlassCard>
      <ThemedText style={styles.error}>{message}</ThemedText>
      <Pressable onPress={onRetry} style={styles.button}>
        <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
      </Pressable>
    </GlassCard>
  );
}

function HiringSection({ data }: { data: HiringAnalytics }) {
  const stageRows = (Object.keys(STAGE_LABELS) as (keyof typeof STAGE_LABELS)[])
    .map((k) => ({ label: STAGE_LABELS[k], value: data.stagesCompletedBeforeRejection[k] }));
  // Roles with no averageable scorecard (all flagged) are skipped, as on the dashboard.
  const roleRows = data.avgScoreByRole
    .filter((r) => r.avgScore !== null)
    .map((r) => ({ label: r.role, value: r.avgScore as number, caption: `${plural(r.scoredCount, 'scorecard')}${r.flaggedCount > 0 ? ` · ${r.flaggedCount} flagged excluded` : ''}` }));

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Hiring</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Time-to-hire, rejection funnel and interview scores across the AI recruitment pipeline.
      </ThemedText>

      {data.totalApplications === 0 ? (
        <GlassCard>
          <ThemedText type="small" themeColor="textSecondary">No applications yet.</ThemedText>
        </GlassCard>
      ) : (
        <>
          <View style={styles.tileGrid}>
            <StatTile label="Total applications" value={data.totalApplications} />
            <StatTile label="Hired" value={data.totalHired} color="#167A48" />
            <StatTile label="Rejection rate" value={data.rejectionRate !== null ? `${data.rejectionRate}%` : null} color="#B83030" />
            <StatTile
              label="Avg. time to hire"
              value={data.avgTimeToHireDays !== null ? `${data.avgTimeToHireDays}d` : null}
              color="#A86018"
              note={data.avgTimeToHireDays !== null ? `Based on ${plural(data.timeToHireSampleSize, 'hire')}` : 'No hires yet'}
            />
          </View>

          <GlassCard>
            <ThemedText type="smallBold">Stages completed before rejection</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.cardNote}>
              There is no exact &quot;rejected from stage X&quot; record, so this shows which AI stages had run by the time each application was rejected.
            </ThemedText>
            {data.totalRejected === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No rejected applications yet.</ThemedText>
            ) : (
              <BarChart rows={stageRows} color="#B83030" />
            )}
          </GlassCard>

          <GlassCard>
            <ThemedText type="smallBold">Average interview score by role</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.cardNote}>
              Out of 100. Excludes applicants never interviewed and AI-flagged scorecards.
            </ThemedText>
            {roleRows.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No completed interview scorecards yet.</ThemedText>
            ) : (
              <BarChart rows={roleRows} max={100} />
            )}
          </GlassCard>
        </>
      )}
    </View>
  );
}

function RetentionSection({ data }: { data: RetentionAnalytics }) {
  const hasTracked = data.departedTrackedCount > 0;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Retention</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Departure date and reason are only captured going forward, from each deactivation — there is no historical backfill.
      </ThemedText>

      <View style={styles.tileGrid}>
        <StatTile label="Active employees" value={data.activeCount} />
        <StatTile label="Tracked departures" value={data.departedTrackedCount} color="#B83030" />
        <StatTile
          label="Avg. tenure (tracked)"
          value={data.avgTenureDays !== null ? `${data.avgTenureDays}d` : null}
          color="#A86018"
          note={data.avgTenureDays !== null ? `Based on ${plural(data.tenureSampleSize, 'departure')}` : 'No data'}
        />
      </View>

      {!hasTracked ? (
        <GlassCard>
          <ThemedText type="small">
            No tracked departures yet — this fills in as employees are deactivated with a departure date.
          </ThemedText>
          {data.departedNoDataCount > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.cardNote}>
              {plural(data.departedNoDataCount, 'earlier deactivation')} with no departure date on file — excluded from these numbers, not counted as zero.
            </ThemedText>
          )}
        </GlassCard>
      ) : (
        <GlassCard>
          <ThemedText type="smallBold">Departure reasons</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.cardNote}>
            Tracking since {data.earliestTrackedDeparture ? fmtDate(data.earliestTrackedDeparture) : '—'}.
            {data.departedNoDataCount > 0 ? ` ${plural(data.departedNoDataCount, 'additional past deactivation')} with no departure date are not included.` : ''}
          </ThemedText>
          <BarChart rows={data.reasonBreakdown.map((r) => ({ label: r.reason, value: r.count }))} />
        </GlassCard>
      )}
    </View>
  );
}

function AnalyticsContent() {
  const insets = useSafeAreaInsets();
  const [hiring, setHiring] = useState<HiringAnalytics | null>(null);
  const [retention, setRetention] = useState<RetentionAnalytics | null>(null);
  const [hiringError, setHiringError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Each section loads on its own so one failing endpoint never blanks the other.
  const loadHiring = useCallback(async () => {
    setHiringError(null);
    try {
      setHiring(await fetchHiringAnalytics());
    } catch (err: any) {
      setHiringError(getErrorMessage(err, 'Could not load hiring analytics.'));
    }
  }, []);

  const loadRetention = useCallback(async () => {
    setRetentionError(null);
    try {
      setRetention(await fetchRetentionAnalytics());
    } catch (err: any) {
      setRetentionError(getErrorMessage(err, 'Could not load retention analytics.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    loadHiring();
    loadRetention();
  }, [loadHiring, loadRetention]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([loadHiring(), loadRetention()]);
    setIsRefreshing(false);
  };

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Analytics' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {hiringError ? (
          <ErrorCard message={hiringError} onRetry={loadHiring} />
        ) : hiring === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <HiringSection data={hiring} />
        )}

        {retentionError ? (
          <ErrorCard message={retentionError} onRetry={loadRetention} />
        ) : retention === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <RetentionSection data={retention} />
        )}
      </ScrollView>
    </View>
  );
}

export default function AnalyticsScreen() {
  const { user } = useAuth();
  if (ANALYTICS_ROLES.includes(user?.role ?? '')) return <AnalyticsContent />;
  return (
    <PermissionGate tabKey="hr_module" deniedMessage="Analytics is available to Owner, Store Manager, HR and Accounting roles, or users granted HR module access.">
      <AnalyticsContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  section: { gap: Spacing.two },
  spinner: { marginTop: Spacing.three },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexBasis: '47%', flexGrow: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half, minHeight: Layout.minTouchTarget },
  cardNote: { marginTop: Spacing.one, marginBottom: Spacing.two },
  error: { color: '#B83030' },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
