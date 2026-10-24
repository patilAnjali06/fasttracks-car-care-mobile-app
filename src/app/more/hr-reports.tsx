import DateTimePicker from '@react-native-community/datetimepicker';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { downloadHrReport, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { HrReportFormat, HrReportKind } from '@/types/api';

// Whole /hr-reports router is router.use(verifyToken, requireHROrOwner) =
// OWNER/STORE_MANAGER/HR/ACCOUNTING (backend/src/routes/hrReports.ts,
// middleware/auth.ts) — a static role check with no hr_module override, same
// as onboarding.tsx.
const REPORT_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

const REPORTS: { key: HrReportKind; label: string; description: string }[] = [
  { key: 'hiring', label: 'Hiring', description: 'Applications, status, and AI interview/assignment scores for the range.' },
  { key: 'onboarding', label: 'Onboarding', description: 'Checklists started, document verification activity, and probation check-ins.' },
  { key: 'attendance', label: 'Attendance', description: 'Per-employee day-by-day attendance and rankings for the range.' },
  { key: 'discipline', label: 'Discipline', description: 'Warnings, disciplinary actions, and acknowledgements issued in the range.' },
];

// The backend wants YYYY-MM-DD. Built from local date parts — toISOString()
// would shift the day for anyone east of UTC late at night / early morning.
function toYmd(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(s: string) {
  return fromYmd(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYmd(d);
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (ymd: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.flex1}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <Pressable onPress={() => setOpen(true)} style={[styles.input, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText>{fmtDate(value)}</ThemedText>
      </Pressable>
      {open && (
        <DateTimePicker
          value={fromYmd(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e, selected) => {
            setOpen(Platform.OS === 'ios');
            if (selected) onChange(toYmd(selected));
          }}
        />
      )}
      {open && Platform.OS === 'ios' && (
        <Pressable onPress={() => setOpen(false)} style={styles.doneLink}>
          <ThemedText type="small">Done</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

export default function HrReportsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const allowed = REPORT_ROLES.includes(user?.role ?? '');

  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => daysAgo(0));
  const [format, setFormat] = useState<HrReportFormat>('pdf');
  const [downloading, setDownloading] = useState<HrReportKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<HrReportKind, string>>>({});

  // YYYY-MM-DD strings compare correctly as text, same check the backend makes.
  const invalidRange = from > to;

  const download = async (kind: HrReportKind) => {
    if (invalidRange || downloading) return;
    setDownloading(kind);
    setErrors((e) => ({ ...e, [kind]: undefined }));
    try {
      const { uri, mimeType } = await downloadHrReport(kind, from, to, format);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'HR report' });
      } else {
        setErrors((e) => ({ ...e, [kind]: 'Sharing isn’t available on this device.' }));
      }
    } catch (err: any) {
      setErrors((e) => ({ ...e, [kind]: err?.message ?? getErrorMessage(err, 'Could not download the report.') }));
    } finally {
      setDownloading(null);
    }
  };

  if (!allowed) {
    return (
      <View style={[styles.content, styles.flex1]}>
        <Stack.Screen options={{ title: 'HR Reports' }} />
        <ThemedText type="small" themeColor="textSecondary">
          HR Reports is available to Owner, Store Manager, HR and Accounting roles only.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'HR Reports' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Export Hiring, Onboarding, Attendance or Discipline data for any date range as PDF or Excel.
        </ThemedText>

        <GlassCard>
          <View style={styles.row}>
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </View>
          {invalidRange && (
            <ThemedText type="small" style={styles.error}>Pick a valid range — &quot;From&quot; must not be after &quot;To&quot;.</ThemedText>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Format</ThemedText>
          <View style={styles.row}>
            {([['pdf', 'PDF'], ['excel', 'Excel']] as const).map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setFormat(key)}
                style={[styles.chip, { backgroundColor: format === key ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={format === key ? styles.chipLabelActive : undefined}>{label}</ThemedText>
              </Pressable>
            ))}
          </View>
        </GlassCard>

        {REPORTS.map((r) => (
          <ThemedView key={r.key} type="backgroundElement" style={styles.report}>
            <ThemedText type="smallBold">{r.label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{r.description}</ThemedText>
            {errors[r.key] && <ThemedText type="small" style={styles.error}>{errors[r.key]}</ThemedText>}
            <Pressable
              onPress={() => download(r.key)}
              disabled={invalidRange || downloading !== null}
              style={[styles.button, (invalidRange || (downloading !== null && downloading !== r.key)) && styles.disabled]}>
              {downloading === r.key ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText style={styles.buttonLabel}>Download {format === 'pdf' ? 'PDF' : 'Excel'}</ThemedText>
              )}
            </Pressable>
          </ThemedView>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: Spacing.two },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, justifyContent: 'center' },
  doneLink: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  report: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  error: { color: '#B83030', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
