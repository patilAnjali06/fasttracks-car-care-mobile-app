import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { openExternalUrl } from '@/lib/open-url';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCallCapabilities, fetchCallLog, fetchCallRecordingDetail, fetchMyCallRecordingSummary, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CallCapabilities, CallLogEntry, CallRecordingDetail, CallRecordingSummary } from '@/types/api';

const STATUSES = ['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'BUSY', 'NO_ANSWER', 'CANCELED', 'UNKNOWN'];
const DIRECTIONS: { value: 'INBOUND' | 'OUTBOUND'; label: string }[] = [
  { value: 'INBOUND', label: 'Incoming' },
  { value: 'OUTBOUND', label: 'Outgoing' },
];
type SortKey = 'date' | 'duration' | 'person';

// GET /calls — requireRoles(CALL_ROLES=[OWNER,STORE_MANAGER,SALES])
// (backend/src/routes/calls.ts). GET /call-recordings/my-summary allows the
// same three roles. Full recording listen (GET /call-recordings/:id) is
// narrower still — OWNER/STORE_MANAGER only (requireFullRecordingAccess) —
// SALES never gets a usable callRecordingId from this list (calls.ts's own
// comment: SALES's "own" grant on calls:recording.listen only resolves for
// a specific resource, never this global list).
// Playback is in-app via expo-audio (RecordingPlayer below); "Open in
// browser" (openExternalUrl) remains as the fallback if the player fails.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'SALES'];
const RECORDING_ROLES = ['OWNER', 'STORE_MANAGER'];

// expo-audio has no error event on the status, so a source that never reaches
// isLoaded within this window is treated as a playback failure.
const LOAD_TIMEOUT_MS = 15000;

function formatDuration(seconds: number | null) {
  if (seconds == null) return '—';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Mounted only while a row is expanded, so collapsing the row or expanding a
// different one unmounts it — useAudioPlayer releases the player on unmount,
// which stops playback. Keyed by audioUrl so a new source gets a fresh player.
function RecordingPlayer({ audioUrl }: { audioUrl: string }) {
  const theme = useTheme();
  const player = useAudioPlayer(audioUrl);
  const status = useAudioPlayerStatus(player);
  const [timedOut, setTimedOut] = useState(false);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (status.isLoaded) return;
    const t = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status.isLoaded]);

  const failed = timedOut && !status.isLoaded;
  const loading = !status.isLoaded && !failed;
  const duration = status.duration > 0 ? status.duration : 0;
  const progress = duration ? Math.min(status.currentTime / duration, 1) : 0;

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Replay from the start once it has finished.
    if (duration && status.currentTime >= duration - 0.25) player.seekTo(0);
    player.play();
  };

  const onSeek = (x: number) => {
    if (!duration || !barWidth) return;
    player.seekTo(Math.max(0, Math.min(x / barWidth, 1)) * duration);
  };

  if (failed) {
    return (
      <View style={styles.playerWrap}>
        <ThemedText type="small" style={styles.playerError}>Couldn&apos;t play this recording in the app.</ThemedText>
        <Pressable onPress={() => openExternalUrl(audioUrl)} style={styles.playButton}>
          <ThemedText style={styles.playButtonLabel}>Open in browser</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.playerWrap}>
      <View style={styles.playerRow}>
        <Pressable onPress={togglePlay} disabled={loading} style={[styles.playButton, loading && styles.playButtonDisabled]}>
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <ThemedText style={styles.playButtonLabel}>{status.playing ? 'Pause' : 'Play'}</ThemedText>
          )}
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          {loading ? 'Loading…' : status.isBuffering && status.playing ? 'Buffering…' : `${formatDuration(status.currentTime)} / ${formatDuration(duration)}`}
        </ThemedText>
      </View>
      <Pressable
        disabled={loading}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        onPress={(e) => onSeek(e.nativeEvent.locationX)}
        hitSlop={{ top: Spacing.two, bottom: Spacing.two }}
        style={[styles.progressTrack, { backgroundColor: theme.background }]}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: theme.primary }]} />
      </Pressable>
    </View>
  );
}

export default function CallsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');

  const canPlayRecordings = RECORDING_ROLES.includes(user?.role ?? '');
  const [calls, setCalls] = useState<CallLogEntry[] | null>(null);
  const [recordings, setRecordings] = useState<CallRecordingSummary[] | null>(null);
  const [capabilities, setCapabilities] = useState<CallCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters — direction is a real server-side query param; everything else
  // is client-side over the fetched rows, same as the dashboard's own
  // FullCallsView (backend/src/routes/calls.ts only accepts customerId/
  // direction).
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [hasRecordingOnly, setHasRecordingOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<CallRecordingDetail | null>(null);
  const [expandLoading, setExpandLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [callLog, recSummary, caps] = await Promise.all([
        fetchCallLog({ direction: direction ?? undefined }),
        fetchMyCallRecordingSummary().catch(() => []),
        canPlayRecordings ? fetchCallCapabilities().catch(() => null) : Promise.resolve(null),
      ]);
      setCalls(callLog);
      setRecordings(recSummary);
      setCapabilities(caps);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load calls.'));
    }
  }, [isAuthorized, direction, canPlayRecordings]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const agents = useMemo(() => {
    const names = new Set<string>();
    (calls ?? []).forEach((c) => { if (c.agentName) names.add(c.agentName); });
    return Array.from(names).sort();
  }, [calls]);

  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    const q = search.trim().toLowerCase();
    const filtered = calls.filter((c) => {
      if (status && c.status !== status) return false;
      if (agent && c.agentName !== agent) return false;
      if (hasRecordingOnly && !c.hasRecording) return false;
      if (dateFrom && c.startedAt < dateFrom) return false;
      if (dateTo && c.startedAt > `${dateTo}T23:59:59`) return false;
      if (q) {
        const haystack = [c.customerName, c.counterpartyDisplay, c.agentName].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      else if (sortKey === 'duration') cmp = (a.durationSeconds ?? -1) - (b.durationSeconds ?? -1);
      else cmp = (a.agentName ?? '').localeCompare(b.agentName ?? '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [calls, search, status, agent, hasRecordingOnly, dateFrom, dateTo, sortKey, sortDir]);

  const toggleExpandRecording = async (call: CallLogEntry) => {
    if (expandedId === call.id) { setExpandedId(null); setExpandedData(null); return; }
    setExpandedId(call.id);
    setExpandedData(null);
    if (!call.callRecordingId) return;
    setExpandLoading(true);
    try {
      setExpandedData(await fetchCallRecordingDetail(call.callRecordingId));
    } catch {
      // silent — row still shows, just no detail
    } finally {
      setExpandLoading(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Calls is only available to Owner, Store Manager, or Sales accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Calls' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {calls === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {capabilities && !capabilities.callingEnabled && (
            <ThemedView type="backgroundElement" style={styles.banner}>
              <ThemedText type="small" style={styles.bannerText}>
                Exotel calling isn&apos;t set up yet. Existing call history and recordings are still shown below.
              </ThemedText>
            </ThemedView>
          )}
          {recordings && recordings.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="smallBold">My Recording Summary</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {recordings.length} recording{recordings.length === 1 ? '' : 's'} · transcripts available for{' '}
                {recordings.filter((r) => r.transcriptAvailable).length}
              </ThemedText>
            </View>
          )}
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search customer or agent"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setDirection(null)} style={[styles.chip, { backgroundColor: direction === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={direction === null ? styles.chipLabelActive : undefined}>All directions</ThemedText>
            </Pressable>
            {DIRECTIONS.map((d) => (
              <Pressable key={d.value} onPress={() => setDirection(d.value)} style={[styles.chip, { backgroundColor: direction === d.value ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={direction === d.value ? styles.chipLabelActive : undefined}>{d.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setStatus(null)} style={[styles.chip, { backgroundColor: status === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={status === null ? styles.chipLabelActive : undefined}>All statuses</ThemedText>
            </Pressable>
            {STATUSES.map((s) => (
              <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, { backgroundColor: status === s ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={status === s ? styles.chipLabelActive : undefined}>{s.replace(/_/g, ' ')}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          {agents.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
              <Pressable onPress={() => setAgent(null)} style={[styles.chip, { backgroundColor: agent === null ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={agent === null ? styles.chipLabelActive : undefined}>All agents</ThemedText>
              </Pressable>
              {agents.map((a) => (
                <Pressable key={a} onPress={() => setAgent(a)} style={[styles.chip, { backgroundColor: agent === a ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={agent === a ? styles.chipLabelActive : undefined}>{a}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable onPress={() => setHasRecordingOnly((v) => !v)} style={[styles.chip, styles.selfChip, { backgroundColor: hasRecordingOnly ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={hasRecordingOnly ? styles.chipLabelActive : undefined}>Has recording only</ThemedText>
          </Pressable>

          <View style={styles.dateRow}>
            <TextInput
              value={dateFrom}
              onChangeText={setDateFrom}
              placeholder="From YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TextInput
              value={dateTo}
              onChangeText={setDateTo}
              placeholder="To YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
          </View>

          <View style={styles.sortRow}>
            <ThemedText type="small" themeColor="textSecondary">Sort by</ThemedText>
            {(['date', 'duration', 'person'] as SortKey[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => { if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir('desc'); } }}
                style={[styles.chip, { backgroundColor: sortKey === k ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={sortKey === k ? styles.chipLabelActive : undefined}>
                  {k === 'date' ? 'Date' : k === 'duration' ? 'Duration' : 'Person'} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Call Log ({filteredCalls.length})</ThemedText>
            {filteredCalls.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No calls match these filters.</ThemedText>
            ) : (
              filteredCalls.map((call) => (
                <ThemedView key={call.id} type="backgroundElement" style={styles.row}>
                  <ThemedText type="smallBold">
                    {call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} · {call.customerName ?? call.counterpartyDisplay ?? 'Unknown'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(call.startedAt).toLocaleString('en-IN')} · {formatDuration(call.durationSeconds)} · {call.status}
                  </ThemedText>
                  {call.agentName && <ThemedText type="small" themeColor="textSecondary">Agent: {call.agentName}</ThemedText>}
                  {call.callRecordingId ? (
                    <Pressable onPress={() => toggleExpandRecording(call)}>
                      <ThemedText type="link">{expandedId === call.id ? 'Hide' : '▶ Play'}</ThemedText>
                    </Pressable>
                  ) : call.recordingProcessing ? (
                    <ThemedText type="small" style={styles.processing}>Processing…</ThemedText>
                  ) : call.hasRecording ? (
                    <ThemedText type="small" themeColor="textSecondary">Recording available</ThemedText>
                  ) : null}
                  {expandedId === call.id && (
                    expandLoading ? (
                      <ActivityIndicator size="small" />
                    ) : expandedData ? (
                      <View style={styles.recordingDetail}>
                        <RecordingPlayer key={expandedData.audioUrl} audioUrl={expandedData.audioUrl} />
                        {expandedData.transcriptText ? (
                          <ThemedText type="small" themeColor="textSecondary">{expandedData.transcriptText}</ThemedText>
                        ) : (
                          <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>
                            {expandedData.transcriptStatus === 'PROCESSING' ? 'Transcript in progress…' : 'Transcript not yet available'}
                          </ThemedText>
                        )}
                      </View>
                    ) : (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>Couldn&apos;t load this recording.</ThemedText>
                    )
                  )}
                </ThemedView>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  section: { gap: Spacing.two },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  chipScroller: { flexDirection: 'row' },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, marginRight: Spacing.one },
  selfChip: { alignSelf: 'flex-start' },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  banner: { borderRadius: Spacing.two, padding: Spacing.two, borderWidth: 1, borderColor: 'rgba(232,168,40,0.3)', backgroundColor: 'rgba(232,168,40,0.12)' },
  bannerText: { color: '#A86018' },
  dateRow: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap' },
  processing: { color: '#A86018' },
  recordingDetail: { gap: Spacing.one, marginTop: Spacing.one, paddingTop: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
  playButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.two, backgroundColor: '#7A1C2E' },
  playButtonLabel: { color: '#ffffff', fontWeight: '600' },
  playButtonDisabled: { opacity: 0.6, minWidth: 64, alignItems: 'center' },
  playerWrap: { gap: Spacing.two },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  playerError: { color: '#B83030' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  italic: { fontStyle: 'italic' },
});
