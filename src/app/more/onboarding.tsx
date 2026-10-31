import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ADMIN_ROLES } from '@/components/applications/application-format';
import { ChecklistTab } from '@/components/onboarding/checklist-tab';
import { LettersTab } from '@/components/onboarding/letters-tab';
import { BUILT_TABS, TABS, type CheckInFilter, type OverviewTarget, type TabKey } from '@/components/onboarding/onboarding-format';
import { OverviewTab } from '@/components/onboarding/overview-tab';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Card } from '@/components/ui';
import { FontWeights, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchOnboardingEmployees } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { OnboardingEmployee } from '@/types/api';

const WIDE_MIN = 560;
const isTabKey = (v: unknown): v is TabKey => TABS.some((t) => t.key === v);

export default function OnboardingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  // 4 roles only — this page carries salary / ID-number / approval data (dashboard ADMIN_ROLES).
  const allowed = ADMIN_ROLES.includes(user?.role ?? '');

  // Deep links: ?tab=…&userId=… (Applications "View Candidate" / "Start Onboarding");
  // a bare ?userId= still lands on that person's checklist, as before.
  const params = useLocalSearchParams<{ tab?: string; userId?: string }>();
  const startTab: TabKey = isTabKey(params.tab) ? params.tab : params.userId ? 'onboarding' : 'overview';
  const startUser = params.userId || '';

  const [tab, setTab] = useState<TabKey>(startTab);
  const [employees, setEmployees] = useState<OnboardingEmployee[]>([]);
  const [lettersUserId, setLettersUserId] = useState(startTab === 'letters' ? startUser : '');
  const [onboardingUserId, setOnboardingUserId] = useState(startTab === 'onboarding' ? startUser : '');
  // Phase 2 tabs keep their targets so the cards/rows already route correctly.
  const [, setCheckInTarget] = useState<{ filter: CheckInFilter; userId?: string } | null>(null);
  const [width, setWidth] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const tabBar = useRef<ScrollView>(null);

  useEffect(() => {
    if (!allowed) return;
    fetchOnboardingEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, [allowed, refreshKey]);

  const openFromOverview = (target: OverviewTarget) => {
    if (target.tab === 'onboarding') setOnboardingUserId(target.userId ?? '');
    if (target.tab === 'letters') setLettersUserId(target.userId ?? '');
    if (target.tab === 'checkins') setCheckInTarget({ filter: target.checkInFilter, userId: target.userId });
    setTab(target.tab);
  };

  const pressTab = (key: TabKey) => {
    // The tab strip clears a pre-selected person, like the dashboard.
    if (key === 'letters') setLettersUserId('');
    if (key === 'onboarding') setOnboardingUserId('');
    if (key === 'checkins') setCheckInTarget(null);
    setTab(key);
  };

  const onRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 800);
  };

  if (!allowed) {
    return (
      <ThemedView style={styles.flex1}>
        <Stack.Screen options={{ title: 'Onboarding' }} />
        <View style={styles.denied}>
          <ThemedText type="small" themeColor="textSecondary">
            Onboarding is available to Owner, Store Manager, HR and Accounting roles only.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const pad = width >= WIDE_MIN ? Spacing.four : Spacing.three;

  return (
    <ThemedView style={styles.flex1} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Stack.Screen options={{ title: 'Onboarding' }} />
      <View style={{ paddingHorizontal: pad, paddingTop: pad }}>
        <ThemedText style={styles.title}>Onboarding</ThemedText>
        <ThemedText themeColor="textMuted" style={styles.subtitle}>Offer &amp; experience letters and onboarding checklists.</ThemedText>
      </View>

      <View style={[styles.tabBarWrap, { borderBottomColor: theme.border, marginHorizontal: pad }]}>
        <ScrollView ref={tabBar} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => pressTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, { borderBottomColor: active ? theme.primary : 'transparent' }]}>
                <ThemedText style={[styles.tabLabel, { color: active ? theme.primary : theme.textMuted }]}>{t.label}</ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={{ padding: pad, paddingBottom: insets.bottom + Spacing.four }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {tab === 'overview' ? (
          <OverviewTab employees={employees} onOpen={openFromOverview} onViewDetails={() => router.push('/more/employees' as never)} refreshKey={refreshKey} />
        ) : tab === 'onboarding' ? (
          <ChecklistTab key={onboardingUserId} initialUserId={onboardingUserId} refreshKey={refreshKey} />
        ) : tab === 'letters' ? (
          <LettersTab
            key={lettersUserId}
            employees={employees}
            initialUserId={lettersUserId}
            refreshKey={refreshKey}
            onVerifyDocuments={(userId) => openFromOverview({ tab: 'documents', userId })}
          />
        ) : !BUILT_TABS.includes(tab) ? (
          <Card padding="lg">
            <ThemedText style={styles.comingTitle}>{TABS.find((t) => t.key === tab)?.label}</ThemedText>
            <ThemedText themeColor="textMuted" style={styles.subtitle}>Coming next.</ThemedText>
          </Card>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  denied: { padding: Spacing.three },
  title: { fontSize: 24, lineHeight: 32, fontFamily: FontWeights.bold },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  tabBarWrap: { borderBottomWidth: 1, marginTop: Spacing.three },
  tabBar: { gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 2, marginBottom: -1, minHeight: 44, justifyContent: 'center' },
  tabLabel: { fontSize: 14, lineHeight: 20, fontFamily: FontWeights.medium },
  comingTitle: { fontSize: 16, lineHeight: 22, fontFamily: FontWeights.semiBold },
});
