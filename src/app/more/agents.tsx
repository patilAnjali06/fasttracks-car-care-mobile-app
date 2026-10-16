import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { fetchAgentActivity, fetchAgentStatuses, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AgentActivity, AgentStatus } from '@/types/api';

// requireManagerOrOwner (backend/src/middleware/auth.ts) gates every
// /agents/* route (backend/src/routes/agents.ts, verified 2026-09-19) —
// resolves to [OWNER,STORE_MANAGER,HR,ACCOUNTING,CASHIER] despite the route
// file's own stale "All agent routes are OWNER only" comment; trusting the
// actual middleware, not the comment. Marketing/ops automation agents
// (review-requests, re-engagement, reel-ideas) — status + last-20 activity
// log, read-only. Trigger (POST /trigger/:name) and toggle (PATCH/PUT
// /:agentName/toggle) are deliberately left out of this pass: both fire a
// live webhook to an outside automation system (triggerManualTrigger /
// triggerAgentToggle) with real side effects (e.g. sending review-request or
// re-engagement messages to real customers), which is a bigger action than
// a first read-only mobile pass should take on cheaply from a phone —
// better added deliberately later with its own confirmation UX than bundled
// in here.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING', 'CASHIER'];

export default function AgentsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');

  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [a, act] = await Promise.all([fetchAgentStatuses(), fetchAgentActivity()]);
      setAgents(a);
      setActivity(act);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load agents.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Agents is only available to Owner, Store Manager, HR, Accounting, or Cashier accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Agents' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {agents === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {agents.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No agents configured.</ThemedText>
          ) : (
            agents.map((a) => (
              <ThemedView key={a.agentName} type="backgroundElement" style={styles.row}>
                <ThemedText type="smallBold">{a.agentName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {a.isActive ? 'Active' : 'Inactive'} · {a.todayCount} today
                  {a.lastActivity ? ` · Last: ${new Date(a.lastActivity).toLocaleString()}` : ''}
                </ThemedText>
              </ThemedView>
            ))
          )}

          <ThemedText type="smallBold" style={styles.sectionTitle}>Recent Activity</ThemedText>
          {activity.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No recent activity.</ThemedText>
          ) : (
            activity.map((act) => (
              <ThemedView key={act.id} type="backgroundElement" style={styles.row}>
                <ThemedText type="small">{act.agentName}: {act.action}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(act.createdAt).toLocaleString()}
                </ThemedText>
              </ThemedView>
            ))
          )}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  sectionTitle: { marginTop: Spacing.two },
});
