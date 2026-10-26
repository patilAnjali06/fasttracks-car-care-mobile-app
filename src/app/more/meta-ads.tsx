import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { AdsList, DailyTable, LeadList, TeamTable, type Drill } from '@/components/meta-ads/ads-lists';
import {
  clock, dayLabel, dur, Empty, FilterChip, FollowRow, inr, num, Panel, SelectField, Stat,
} from '@/components/meta-ads/ads-ui';
import { LeadFlowChart, SourceDonut } from '@/components/meta-ads/lead-charts';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  fetchAdLeadList,
  fetchAdsDaily,
  fetchAdsFollowThrough,
  fetchAdsRunning,
  getErrorMessage,
  refreshAds,
} from '@/lib/api';
import { usePermissions } from '@/lib/permissions-context';
import type { AdLead, AdLeadFilters, AdsDayRow, AdsFollowThrough, AdsRunningRow } from '@/types/api';

// Mirrors the dashboard's ads page (dashboard/ads/page.tsx). Gate: every route
// is requireAdsAccess = OWNER, or an explicit `ads` grant (backend/src/
// middleware/auth.ts hasAdsAccess) — resolved by PermissionsProvider from
// GET /auth/me, fail-closed. Two rules carried over from the page:
//   1. Totals are SERVER aggregates (/ads/daily, /ads/follow-through);
//      /ads/lead-list is a paged list and is never summed for a headline.
//   2. Nothing is invented — no ROAS, no revenue; a missing value prints "—"
//      and a failed request shows an error, never a confident zero.

// Opens on the widest window on purpose (the server caps these endpoints at 90).
const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'All time' },
] as const;
const DEFAULT_DAYS = 90;
const PAGE_SIZE = 200;

const TABS = ['Overview', 'Ads & campaigns', 'All leads', 'Daily report', 'Team activity'] as const;
type Tab = (typeof TABS)[number];

function MetaAdsContent() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scroller = useRef<ScrollView>(null);

  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [tab, setTab] = useState<Tab>('Overview');

  const [daily, setDaily] = useState<AdsDayRow[]>([]);
  const [ads, setAds] = useState<AdsRunningRow[]>([]);
  const [leads, setLeads] = useState<AdLead[]>([]);
  const [leadTotal, setLeadTotal] = useState(0);
  const [leadsMore, setLeadsMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [follow, setFollow] = useState<AdsFollowThrough | null>(null);
  const [leadsSince, setLeadsSince] = useState<string | null>(null);

  // All-leads filters; they compose. Drill-down filters (an ad, a day,
  // "waiting") arrive by tapping a count elsewhere and show as removable chips.
  const [fTier, setFTier] = useState('all');
  const [fOwner, setFOwner] = useState('all');
  const [fSource, setFSource] = useState('all');
  const [fVehicle, setFVehicle] = useState('all');
  const [fAd, setFAd] = useState<{ id: string; name: string } | null>(null);
  const [fDate, setFDate] = useState('');
  const [fWaiting, setFWaiting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Only the filters the API understands, and only when set.
  const leadFilters = useMemo(() => {
    const f: AdLeadFilters = {};
    if (fTier !== 'all') f.tier = fTier;
    if (fSource !== 'all') f.paid = fSource === 'paid' ? '1' : '0';
    if (fOwner !== 'all') f.owner = fOwner;
    if (fVehicle !== 'all') f.vehicle = fVehicle;
    if (fAd) f.adId = fAd.id;
    if (fDate) f.date = fDate;
    if (fWaiting) f.waiting = '1';
    return f;
  }, [fTier, fSource, fOwner, fVehicle, fAd, fDate, fWaiting]);

  const clearFilters = () => {
    setFTier('all'); setFOwner('all'); setFSource('all'); setFVehicle('all');
    setFAd(null); setFDate(''); setFWaiting(false);
  };

  // Every count is a door into the leads it counted: tapping one opens All
  // leads already filtered to exactly those rows, from a clean slate.
  const drill: Drill = (f) => {
    clearFilters();
    if (f.owner) setFOwner(f.owner);
    if (f.ad) setFAd(f.ad);
    if (f.date) setFDate(f.date);
    if (f.tier) setFTier(f.tier);
    if (f.paid) setFSource(f.paid === '1' ? 'paid' : 'direct');
    if (f.waiting) setFWaiting(true);
    setTab('All leads');
    scroller.current?.scrollTo({ y: 0, animated: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [d, a, l, f] = await Promise.all([
        fetchAdsDaily(days),
        fetchAdsRunning(days),
        fetchAdLeadList(days, PAGE_SIZE, 0, leadFilters),
        fetchAdsFollowThrough(days),
      ]);
      setDaily(Array.isArray(d) ? d : []);
      setAds(Array.isArray(a?.rows) ? a.rows : []);
      setLeadsSince(a?.leadsSince ?? null);
      setLeads(Array.isArray(l?.rows) ? l.rows : []);
      setLeadTotal(l?.total ?? 0);
      setLeadsMore(Boolean(l?.hasMore));
      setFollow(f ?? null);
      setLastLoaded(new Date());
    } catch {
      // Never render zeros as if they were verified — say the load failed.
      setErr('Could not load live data. Check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [days, leadFilters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount / range or filter change
    load();
  }, [load]);

  // Leads keep arriving while the screen is open (the desk syncs every minute
  // server-side), so re-read on the same cadence — only while the app is in
  // the foreground.
  useEffect(() => {
    const t = setInterval(() => { if (AppState.currentState === 'active') load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const onPullRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const r = await fetchAdLeadList(days, PAGE_SIZE, leads.length, leadFilters);
      setLeads((prev) => [...prev, ...(Array.isArray(r?.rows) ? r.rows : [])]);
      setLeadTotal(r?.total ?? leadTotal);
      setLeadsMore(Boolean(r?.hasMore));
    } catch {
      setMsg('Could not load more leads.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Refresh pulls Meta spend + new leads + ownership (POST /ads/refresh, 60s
  // server cooldown), so it asks first.
  const runRefresh = async () => {
    setSyncing(true);
    setMsg('');
    try {
      const d = await refreshAds();
      const bits: string[] = [];
      if (d.newLeads) bits.push(`${d.newLeads} new lead${d.newLeads === 1 ? '' : 's'}`);
      if (d.ownersUpdated) bits.push(`${d.ownersUpdated} ownership update${d.ownersUpdated === 1 ? '' : 's'}`);
      if (d.spendOk) bits.push('ad spend updated');
      let text = bits.length ? bits.join(' · ') : 'Already up to date';
      // The server says which sources did not refresh; don't imply all did.
      if (d.failed?.length) text += ` · could not refresh: ${d.failed.join(', ')}`;
      setMsg(text);
      await load();
    } catch (e: any) {
      setMsg(getErrorMessage(e, 'Refresh failed. Try again shortly.'));
    } finally {
      setSyncing(false);
    }
  };

  const confirmRefresh = () => {
    Alert.alert(
      'Refresh from Meta?',
      'Pulls the latest ad spend from Meta, new leads from the lead desk and current ownership. It can only run once a minute.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Refresh', onPress: runRefresh },
      ],
    );
  };

  // Totals come from the SERVER-side daily aggregate, never the lead rows.
  const totals = useMemo(() => {
    const sum = (rows: AdsDayRow[]) => rows.reduce((acc, r) => ({
      leads: acc.leads + r.leads, paid: acc.paid + r.paid, organic: acc.organic + r.organic, spend: acc.spend + r.spend,
    }), { leads: 0, paid: 0, organic: 0, spend: 0 });
    const t = sum(daily);
    // Cost per lead only ever divides spend by leads from the SAME days — ads
    // ran for weeks before lead capture began, so restrict both sides to days
    // on or after capture and say so on the card.
    const comparableRows = leadsSince ? daily.filter((r) => r.date >= leadsSince) : daily;
    const c = sum(comparableRows);
    return { ...t, cpl: c.paid > 0 ? c.spend / c.paid : null, cplClipped: comparableRows.length < daily.length };
  }, [daily, leadsSince]);

  const owners = follow?.owners ?? [];
  const vehicles = follow?.vehicles ?? [];
  const tierCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of follow?.tiers ?? []) m[t.tier] = t.leads;
    return m;
  }, [follow]);

  const filtersOn = fTier !== 'all' || fOwner !== 'all' || fSource !== 'all' || fVehicle !== 'all'
    || fAd !== null || fDate !== '' || fWaiting;
  const rangeLabel = RANGES.find((r) => r.days === days)?.label ?? `${days} days`;

  const viewAll = (label: string, to: Tab) => (
    <Pressable onPress={() => setTab(to)} hitSlop={8}>
      <ThemedText type="small" style={{ color: theme.primary, fontWeight: '600' }}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Meta Ads' }} />
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onPullRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.eyebrow}>MARKETING PERFORMANCE</ThemedText>
          <ThemedText type="subtitle">Meta Ads</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Your ads, enquiries and team follow-through. In one place.</ThemedText>
        </View>

        <View style={styles.headerRow}>
          {lastLoaded ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>Updated {clock(lastLoaded.toISOString())} IST</ThemedText>
          ) : <View style={styles.flex1} />}
          <Pressable onPress={confirmRefresh} disabled={syncing} style={[styles.refreshBtn, syncing && styles.disabled]}>
            {syncing ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <ThemedText style={styles.btnLabel}>{syncing ? 'Refreshing' : 'Refresh'}</ThemedText>
          </Pressable>
        </View>

        <View style={styles.rangeRow}>
          {RANGES.map((r) => (
            <Pressable
              key={r.days}
              onPress={() => setDays(r.days)}
              style={[styles.rangeChip, { backgroundColor: days === r.days ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={days === r.days ? styles.chipActive : undefined}>{r.label}</ThemedText>
            </Pressable>
          ))}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Dates and totals are Asia/Kolkata{msg ? ` · ${msg}` : ''}
        </ThemedText>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.tabs, { borderBottomColor: theme.backgroundElement }]}>
          {TABS.map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: theme.primary }]}>
              <ThemedText type="small" style={tab === t ? { color: theme.primary, fontWeight: '600' } : { fontWeight: '600' }} themeColor={tab === t ? undefined : 'textSecondary'}>
                {t}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {err ? (
          <GlassCard>
            <ThemedText style={styles.error}>{err}</ThemedText>
            <Pressable onPress={load} style={styles.retry}>
              <ThemedText style={styles.btnLabel}>Retry</ThemedText>
            </Pressable>
          </GlassCard>
        ) : null}
        {loading && !daily.length && !err ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">Loading live data…</ThemedText>
          </View>
        ) : null}

        {tab === 'Overview' && (
          <View style={styles.stack}>
            <View style={styles.tiles}>
              <Stat label="Total leads" icon="people-outline" value={num(totals.leads)}
                sub={`${num(totals.paid)} paid · ${num(totals.organic)} direct`} onPress={() => drill({})} />
              <Stat label="Meta ad spend" icon="wallet-outline" value={inr(totals.spend)}
                sub={`Spend across ${rangeLabel.toLowerCase()}`} />
              <Stat label="Cost per paid lead" icon="trending-up-outline" value={inr(totals.cpl)}
                sub={totals.cplClipped && leadsSince
                  ? `Spend ÷ paid leads, from ${dayLabel(leadsSince)} when lead capture began`
                  : 'Meta spend ÷ attributed paid leads'} />
              <Stat label="Remarks recorded" icon="chatbubble-outline" value={num(follow?.remarks)}
                sub={follow ? `Of ${num(follow.accepted)} accepted leads` : undefined} />
            </View>

            <Panel title="Lead flow" note="Daily enquiries by acquisition source">
              {daily.length ? <LeadFlowChart daily={daily} onDrill={drill} /> : <Empty />}
            </Panel>

            <Panel title="Where leads came from" note="Paid versus direct enquiries">
              {totals.paid + totals.organic > 0 ? (
                <SourceDonut paid={totals.paid} organic={totals.organic} onDrill={(p) => drill({ paid: p })} />
              ) : <Empty />}
            </Panel>

            <Panel title="Ad performance" note="Spend connected to attributed enquiries" right={viewAll('View all ads', 'Ads & campaigns')}>
              <AdsList rows={ads.slice(0, 5)} onDrill={drill} />
            </Panel>

            <Panel title="Team follow-through" note="What happened after the enquiry arrived">
              {follow ? (
                <View style={styles.followStack}>
                  <FollowRow label="Accepted by the team" note="Ownership recorded in the app" value={follow.accepted}
                    onPress={() => setTab('Team activity')} />
                  <FollowRow label="Accepted, no remark yet" note="No written outcome available" value={follow.acceptedNoRemark} />
                  <FollowRow label="Not accepted" note="No team member recorded" value={follow.notAccepted}
                    onPress={() => drill({ waiting: true })} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Median response {dur(follow.medianResponseSec)} · {num(follow.underTwoMin)} answered under 2 min
                  </ThemedText>
                </View>
              ) : <Empty />}
            </Panel>

            <Panel title="Recent leads" note="Acceptance and remarks, exactly where you need them" right={viewAll('View all leads', 'All leads')}>
              <LeadList rows={leads.slice(0, 8)} />
            </Panel>
          </View>
        )}

        {tab === 'Ads & campaigns' && (
          <Panel title="Which ads are running"
            note={leadsSince ? `Lead capture began ${dayLabel(leadsSince)} — ads that ran before it cannot show a fair cost per lead` : undefined}>
            <AdsList rows={ads} onDrill={drill} />
          </Panel>
        )}

        {tab === 'All leads' && (
          <Panel title="All leads"
            note={filtersOn
              ? `${num(leadTotal)} match these filters · showing ${num(leads.length)}`
              : `Showing ${num(leads.length)} of ${num(leadTotal)} in this range`}
            right={filtersOn ? (
              <Pressable onPress={clearFilters} hitSlop={8}>
                <ThemedText type="small" style={{ color: theme.primary, fontWeight: '600' }}>Clear filters</ThemedText>
              </Pressable>
            ) : undefined}>
            {(fAd || fDate || fWaiting) && (
              <View style={styles.chips}>
                {fAd && <FilterChip label={`Ad: ${fAd.name}`} onClear={() => setFAd(null)} />}
                {fDate && <FilterChip label={`Day: ${dayLabel(fDate)}`} onClear={() => setFDate('')} />}
                {fWaiting && <FilterChip label="Waiting — not yet accepted" onClear={() => setFWaiting(false)} />}
              </View>
            )}

            <View style={styles.filters}>
              <SelectField label="Vehicle grade" value={fTier} onChange={setFTier} options={[
                { v: 'all', t: 'All grades' },
                { v: 'premium', t: `Premium (${tierCounts.premium ?? 0})` },
                { v: 'mid', t: `Mid (${tierCounts.mid ?? 0})` },
                { v: 'premium,mid', t: `Premium + Mid (${(tierCounts.premium ?? 0) + (tierCounts.mid ?? 0)})` },
                { v: 'low', t: `Low (${tierCounts.low ?? 0})` },
                { v: 'unknown', t: `Not stated (${tierCounts.unknown ?? 0})` },
              ]} />
              <SelectField label="Accepted by" value={fOwner} onChange={setFOwner} options={[
                { v: 'all', t: 'Anyone' },
                { v: 'none', t: `Not accepted (${follow?.notAccepted ?? 0})` },
                ...owners.map((o) => ({ v: o.name, t: `${o.name} (${o.leads})` })),
              ]} />
              <SelectField label="Source" value={fSource} onChange={setFSource} options={[
                { v: 'all', t: 'All sources' },
                { v: 'paid', t: 'Meta · Paid' },
                { v: 'direct', t: 'Direct' },
              ]} />
              <SelectField label="Vehicle" value={fVehicle} onChange={setFVehicle} options={[
                { v: 'all', t: 'All vehicles' },
                ...vehicles.map((v) => ({ v: v.vehicle, t: `${v.vehicle} (${v.leads})` })),
              ]} />
            </View>

            <LeadList rows={leads} />
            {leadsMore && (
              <Pressable onPress={loadMore} disabled={loadingMore} style={[styles.moreBtn, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="small" style={styles.moreLabel}>
                  {loadingMore ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, leadTotal - leads.length)} more`}
                </ThemedText>
              </Pressable>
            )}
          </Panel>
        )}

        {tab === 'Daily report' && (
          <Panel title="Day by day" note="Leads, spend and cost per lead by IST date">
            <DailyTable rows={daily} onDrill={drill} />
          </Panel>
        )}

        {tab === 'Team activity' && (
          <Panel title="Who picked up what" note="Counted over the whole selected range. Names differing only by capitalisation are treated as one person.">
            <TeamTable owners={follow?.owners ?? []} accepted={follow?.accepted ?? 0} onDrill={drill} />
          </Panel>
        )}
      </ScrollView>
    </View>
  );
}

export default function MetaAdsScreen() {
  const { status, hasAdsAccess, refresh } = usePermissions();

  if (status === 'idle' || status === 'loading') {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }
  if (status === 'error') {
    return (
      <View style={styles.center}>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>Couldn&apos;t load your permissions.</ThemedText>
        <Pressable onPress={() => refresh()} style={styles.retry}>
          <ThemedText style={styles.btnLabel}>Retry</ThemedText>
        </Pressable>
      </View>
    );
  }
  if (!hasAdsAccess) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Meta Ads' }} />
        <ThemedText themeColor="textSecondary" style={styles.centerText}>You do not have access to the ads workspace.</ThemedText>
      </View>
    );
  }
  return <MetaAdsContent />;
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  centerText: { textAlign: 'center' },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', justifyContent: 'center' },
  disabled: { opacity: 0.6 },
  btnLabel: { color: '#ffffff', fontWeight: '600' },
  rangeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  rangeChip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipActive: { color: '#ffffff', fontWeight: '600' },
  tabs: { borderBottomWidth: 1, flexGrow: 0 },
  tab: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  error: { color: '#B83030' },
  retry: { marginTop: Spacing.two, height: 48, paddingHorizontal: Spacing.four, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  stack: { gap: Layout.cardGap },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  followStack: { gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.three },
  filters: { gap: Spacing.three, marginBottom: Spacing.three },
  moreBtn: { marginTop: Spacing.three, alignSelf: 'center', paddingHorizontal: Spacing.four, minHeight: 44, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  moreLabel: { fontWeight: '600' },
});
