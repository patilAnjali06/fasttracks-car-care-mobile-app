import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { downloadPayslipPdf, fetchMyPayslips, getErrorMessage } from '@/lib/api';
import type { PayslipListItem } from '@/types/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmt(n: number) {
  return `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function MyPayslipsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [payslips, setPayslips] = useState<PayslipListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPayslips(await fetchMyPayslips());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load your payslips.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const download = async (p: PayslipListItem) => {
    setDownloadError(null);
    setDownloadingId(p.id);
    try {
      const { uri } = await downloadPayslipPdf(p.id, p.month, p.year);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch (err: any) {
      setDownloadError(getErrorMessage(err, 'Failed to download this payslip.'));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'My Payslips' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}>

        <View style={styles.header}>
          <ThemedText type="title">My Payslips</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Issued payslips, newest first.</ThemedText>
        </View>

        {downloadError && (
          <View style={[styles.errorBanner, { backgroundColor: 'rgba(224,104,104,0.1)' }]}>
            <ThemedText type="small" style={{ color: theme.danger }}>{downloadError}</ThemedText>
          </View>
        )}

        <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
          {payslips === null ? (
            error ? (
              <View style={styles.center}>
                <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText>
                <Pressable onPress={load} hitSlop={8}>
                  <ThemedText type="smallBold" style={[styles.retry, { color: theme.primary }]}>Try again</ThemedText>
                </Pressable>
              </View>
            ) : (
              <ActivityIndicator style={styles.loader} />
            )
          ) : payslips.length === 0 ? (
            <View style={styles.center}>
              <View style={[styles.emptyIcon, { backgroundColor: theme.background }]}>
                <ThemedText type="subtitle">🧾</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">No payslips issued yet.</ThemedText>
            </View>
          ) : (
            payslips.map((p, i) => (
              <View key={p.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderColor: theme.border }]}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold">{MONTH_NAMES[p.month - 1]} {p.year}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Issued {formatDateTime(p.generatedAt)}</ThemedText>
                </View>
                <View style={styles.rowRight}>
                  <ThemedText type="smallBold" style={styles.netPay}>{fmt(p.netPay)}</ThemedText>
                  <Pressable
                    onPress={() => download(p)}
                    disabled={downloadingId === p.id}
                    style={[styles.downloadButton, { backgroundColor: theme.background, borderColor: theme.border, opacity: downloadingId === p.id ? 0.6 : 1 }]}>
                    {downloadingId === p.id ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <ThemedText type="small" style={styles.downloadLabel}>Download</ThemedText>
                    )}
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </ThemedView>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: 2 },
  flex1: { flex: 1 },
  errorBanner: { borderRadius: Radii.md, padding: Spacing.two },
  card: { borderRadius: Radii.lg, borderWidth: 1, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.six, gap: Spacing.two },
  loader: { padding: Spacing.six },
  retry: { marginTop: Spacing.one },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, padding: Spacing.three },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 0 },
  netPay: { color: '#22c55e', fontVariant: ['tabular-nums'] },
  downloadButton: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Radii.md, borderWidth: 1, minWidth: 84, alignItems: 'center' },
  downloadLabel: { fontWeight: '600' },
});
