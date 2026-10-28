import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { avatarColor, formatCallDuration, formatCallTime, isMissedCall } from '@/lib/call-format';
import type { CallLogEntry } from '@/types/api';

const GREEN = '#1E8E3E';
const RED = '#B83030';

export function CallRow({ call }: { call: CallLogEntry }) {
  const theme = useTheme();
  const missed = isMissedCall(call.status);
  const inbound = call.direction === 'INBOUND';
  const iconColor = missed ? RED : inbound ? GREEN : theme.textSecondary;
  const name = call.customerName ?? call.counterpartyDisplay ?? 'Unknown';
  const letter = call.customerName?.trim().charAt(0).toUpperCase();
  const label = missed ? 'Missed' : inbound ? 'Incoming' : 'Outgoing';
  const duration = missed ? null : formatCallDuration(call.durationSeconds);

  // UI only — Exotel calling is wired up separately. The number is shown
  // exactly as the API returns it (the backend masks it on purpose).
  const callBack = () => {
    const who = call.customerName && call.counterpartyDisplay ? `${name}\n${call.counterpartyDisplay}` : name;
    Alert.alert('Calling not connected yet', `${who}\n\nCalling through Exotel will be added soon.`);
  };

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}>
        {letter ? (
          <ThemedText style={styles.avatarLetter}>{letter}</ThemedText>
        ) : (
          <Ionicons name="person" size={22} color="#ffffff" />
        )}
      </View>
      <View style={styles.middle}>
        <ThemedText
          numberOfLines={1}
          adjustsFontSizeToFit={!call.customerName}
          minimumFontScale={0.8}
          style={missed ? { color: RED } : undefined}>
          {name}
        </ThemedText>
        <View style={styles.subRow}>
          <Ionicons
            name={inbound ? 'arrow-down' : 'arrow-up'}
            size={14}
            color={iconColor}
            style={styles.rotated}
          />
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.subText}>
            <ThemedText type="small" style={{ color: missed ? RED : theme.textSecondary }}>{label}</ThemedText>
            {call.agentName ? ` · ${call.agentName}` : ''}
          </ThemedText>
        </View>
      </View>
      <View style={styles.right}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{formatCallTime(call.startedAt)}</ThemedText>
        {duration ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{duration}</ThemedText> : null}
      </View>
      <Pressable
        onPress={callBack}
        accessibilityLabel="Call back"
        accessibilityRole="button"
        hitSlop={Spacing.half * 2}
        style={styles.callButton}>
        <Ionicons name="call" size={20} color="#ffffff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: Spacing.two, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarLetter: { color: '#ffffff', fontSize: 18, lineHeight: 22, fontWeight: '700' },
  middle: { flex: 1, minWidth: 0, gap: Spacing.half },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  rotated: { transform: [{ rotate: '45deg' }] },
  subText: { flexShrink: 1 },
  right: { alignItems: 'flex-end', gap: Spacing.half, flexShrink: 0 },
  callButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN, flexShrink: 0 },
});
