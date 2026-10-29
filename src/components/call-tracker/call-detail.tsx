import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, FadeIn, PRESSED_OPACITY, Segmented } from '@/components/call-tracker/primitives';
import { ThemedText } from '@/components/themed-text';
import { Badge, type BadgeVariant } from '@/components/ui';
import { Fonts, FontWeights, Radii, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { directionLabel, formatClock, type CallTrackerEntry } from '@/lib/call-tracker';
import { longDay, timeRange } from '@/lib/call-tracker-format';

const TABULAR = { fontVariant: ['tabular-nums' as const] };

type DetailTab = 'summary' | 'transcript' | 'details';
const TABS = [
  { value: 'summary', label: 'Summary' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'details', label: 'Details' },
];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  available: 'success',
  completed: 'success',
  processing: 'warning',
  failed: 'danger',
  missing: 'danger',
  none: 'muted',
};

function Metric({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText themeColor="textMuted" style={styles.metricLabel}>{label}</ThemedText>
      <ThemedText style={[styles.metricValue, TABULAR]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{value}</ThemedText>
    </View>
  );
}

// Disabled player: there is no audio or playback backend yet.
function PlayerCard({ call }: { call: CallTrackerEntry }) {
  const theme = useTheme();
  return (
    <View style={[styles.player, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.playerRow}>
        <View style={[styles.play, { backgroundColor: withAlpha(theme.primary, 0.35) }]} accessibilityLabel="Play recording (unavailable)" accessibilityState={{ disabled: true }}>
          <Ionicons name="play" size={24} color="#FFFFFF" style={styles.playIcon} />
        </View>
        <View style={styles.flex1}>
          <View style={[styles.progress, { backgroundColor: theme.border }]} />
          <ThemedText themeColor="textMuted" style={[styles.time, TABULAR]}>0:00 / {formatClock(call.durationSeconds)}</ThemedText>
        </View>
      </View>
      <ThemedText themeColor="textMuted" style={styles.playerNote}>
        {call.audioUrl ? 'Playback will be added soon' : 'Recording will be available when the backend is connected'}
      </ThemedText>
    </View>
  );
}

function KeyValue({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.kv, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <ThemedText themeColor="textMuted" style={styles.kvLabel}>{label}</ThemedText>
      <View style={styles.kvValue}>{children}</View>
    </View>
  );
}

function CopyButton({ text }: { text: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Pressable onPress={copy} hitSlop={Spacing.two} accessibilityRole="button" accessibilityLabel="Copy call ID" style={({ pressed }) => [styles.copy, pressed && { opacity: PRESSED_OPACITY }]}>
      <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={copied ? theme.success : theme.textSecondary} />
    </Pressable>
  );
}

// The selected call: header, metrics, player and Summary / Transcript / Details.
// Give it key={callId} so the tab resets when the call changes.
export function CallDetail({ call }: { call: CallTrackerEntry }) {
  const theme = useTheme();
  const [tab, setTab] = useState<DetailTab>('summary');

  return (
    <View style={styles.detail}>
      <View style={styles.hero}>
        <Avatar name={call.salesperson} size={56} />
        <View style={styles.flex1}>
          <ThemedText style={[styles.number, TABULAR]}>{call.customerPhoneMasked}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.when}>{longDay(call.startedAt)} · {timeRange(call.startedAt, call.endedAt)}</ThemedText>
        </View>
      </View>
      <View style={[styles.pill, { backgroundColor: withAlpha(theme.primary, 0.1) }]}>
        <Ionicons name={call.direction === 'OUTBOUND' ? 'arrow-up-outline' : 'arrow-down-outline'} size={14} color={theme.primary} style={styles.pillIcon} />
        <ThemedText style={[styles.pillText, { color: theme.primary }]}>{directionLabel(call.direction)}</ThemedText>
      </View>

      <View style={styles.metrics}>
        <Metric label="Duration" value={formatClock(call.durationSeconds)} />
        <Metric label="Talk time" value={formatClock(call.talkTimeSeconds)} />
        <Metric label="Salesperson" value={call.salesperson} />
      </View>

      <PlayerCard call={call} />

      <Segmented options={TABS} value={tab} onChange={(v) => setTab(v as DetailTab)} />

      {/* Fixed minimum height so switching tabs does not make the page jump. */}
      <View style={styles.tabBody}>
        <FadeIn key={tab}>
          {tab === 'summary' ? (
            <ThemedText style={styles.prose}>{call.summary ?? 'No summary available.'}</ThemedText>
          ) : tab === 'transcript' ? (
            <ThemedText style={[styles.prose, styles.transcript]}>{call.transcript ?? 'No transcript available.'}</ThemedText>
          ) : (
            <View>
              <KeyValue label="Call ID">
                <ThemedText style={styles.mono} selectable numberOfLines={1} ellipsizeMode="middle">{call.callId}</ThemedText>
                <CopyButton text={call.callId} />
              </KeyValue>
              <KeyValue label="Salesperson no."><ThemedText style={[styles.kvText, TABULAR]}>{call.salespersonPhoneMasked}</ThemedText></KeyValue>
              <KeyValue label="Source"><ThemedText style={styles.kvText}>{call.source}</ThemedText></KeyValue>
              <KeyValue label="Recording"><Badge size="sm" variant={STATUS_VARIANT[call.recordingStatus]}>{call.recordingStatus}</Badge></KeyValue>
              <KeyValue label="Transcript"><Badge size="sm" variant={STATUS_VARIANT[call.transcriptStatus]}>{call.transcriptStatus}</Badge></KeyValue>
              <KeyValue label="Summary" last><Badge size="sm" variant={STATUS_VARIANT[call.summaryStatus]}>{call.summaryStatus}</Badge></KeyValue>
            </View>
          )}
        </FadeIn>
      </View>
    </View>
  );
}

// Phone: full-height sheet with a close button.
export function CallDetailModal({ call, onClose }: { call: CallTrackerEntry | null; onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={!!call} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [styles.close, pressed && { opacity: PRESSED_OPACITY }]}>
            <Ionicons name="chevron-down" size={26} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.modalTitle}>Call details</ThemedText>
          <View style={styles.close} />
        </View>
        {call ? (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.four }}>
            <CallDetail key={call.callId} call={call} />
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, minWidth: 0 },
  detail: { padding: Spacing.three, gap: Spacing.three },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  number: { fontSize: 22, lineHeight: 28, fontFamily: FontWeights.bold },
  when: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: 12, minHeight: 28, borderRadius: Radii.pill },
  pillIcon: { transform: [{ rotate: '45deg' }] },
  pillText: { fontSize: 13, lineHeight: 18, fontFamily: FontWeights.semiBold },
  metrics: { flexDirection: 'row', gap: 12 },
  metric: { flex: 1, minWidth: 0, gap: 4, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.md },
  metricLabel: { fontSize: 12, lineHeight: 16 },
  metricValue: { fontSize: 16, lineHeight: 22, fontFamily: FontWeights.semiBold },
  player: { gap: 12, padding: Spacing.three, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radii.md },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  playIcon: { marginLeft: 3 },
  progress: { height: 4, borderRadius: 2 },
  time: { fontSize: 12, lineHeight: 16, marginTop: Spacing.two },
  playerNote: { fontSize: 13, lineHeight: 18 },
  tabBody: { minHeight: 240 },
  prose: { fontSize: 15, lineHeight: 22 },
  transcript: { lineHeight: 22 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 48 },
  kvLabel: { width: 110, fontSize: 13, lineHeight: 18 },
  kvValue: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.two },
  kvText: { fontSize: 15, lineHeight: 22 },
  mono: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontFamily: Fonts?.mono },
  copy: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.two },
  modalTitle: { fontSize: 16, lineHeight: 22, fontFamily: FontWeights.semiBold },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
