import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ActionLogEntry, DocumentAccessEntry } from '@/types/api';

// The dashboard's ACTION_LABELS (Document Access Log) and ACTION_LOG_LABELS
// (Action Log) — the latter's keys are exactly the backend's ACTION_TYPES.
export const ACCESS_ACTION_LABELS: Record<string, string> = {
  VIEW_FILE: 'Viewed File',
  REVEAL_VALUE: 'Revealed Value',
};

export const ACTION_LOG_LABELS: Record<string, string> = {
  DOCUMENT_VERIFIED: 'Document Verified',
  DOCUMENT_REJECTED: 'Document Rejected',
  LETTER_ISSUED: 'Letter Issued',
  DISCIPLINE_ISSUED: 'Discipline Issued',
  TEMPLATE_CREATED: 'Template Created',
  TEMPLATE_UPDATED: 'Template Updated',
  TEMPLATE_APPROVED: 'Template Approved',
  INVITE_SENT: 'Onboarding Invite Sent',
  CANDIDATE_APPROVED: 'Candidate Approved',
  APPLICATION_INVITE_SENT: 'Application Invite Sent',
  APPLICATION_STATUS_CHANGED: 'Application Status Changed',
  INTERVIEW_SCHEDULED: 'Interview Scheduled',
};

// IST, like the dashboard.
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

// Built from local date parts (toISOString would shift the day east of UTC);
// the server reads the string as an IST calendar day.
function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A From / To filter: blank until set (like the dashboard's empty date input),
// with a × to clear it.
export function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (ymd: string) => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.flex1}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.filterLabel}>{label}</ThemedText>
      <View style={[styles.dateBox, { backgroundColor: theme.backgroundElement }]}>
        <Pressable onPress={() => setOpen(true)} style={styles.flex1}>
          <ThemedText type="small" themeColor={value ? undefined : 'textSecondary'}>
            {value ? fromYmd(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Any date'}
          </ThemedText>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel={`Clear ${label}`}>
            <ThemedText type="small" themeColor="textSecondary">×</ThemedText>
          </Pressable>
        ) : null}
      </View>
      {open && (
        <DateTimePicker
          value={value ? fromYmd(value) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e, selected) => {
            setOpen(Platform.OS === 'ios');
            if (selected) onChange(toYmd(selected));
          }}
        />
      )}
      {open && Platform.OS === 'ios' && (
        <Pressable onPress={() => setOpen(false)} style={styles.done}>
          <ThemedText type="small">Done</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function Field({ label, children, sub }: { label: string; children: string; sub?: string | null }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label.toUpperCase()}</ThemedText>
      <ThemedText type="small">{children}</ThemedText>
      {sub ? <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText> : null}
    </View>
  );
}

// One Document Access Log row — the dashboard's Employee / Document / Action /
// Viewed By / When columns.
export function AccessCard({ row }: { row: DocumentAccessEntry }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Field label="Employee" sub={row.document.user.employeeId}>{row.document.user.name}</Field>
      <Field label="Document">{row.document.label || row.document.type.replace(/_/g, ' ')}</Field>
      <Field label="Action">{ACCESS_ACTION_LABELS[row.action] ?? row.action}</Field>
      <Field label="Viewed By">{row.viewedBy.name}</Field>
      <ThemedText type="small" themeColor="textSecondary">{fmtWhen(row.createdAt)}</ThemedText>
    </ThemedView>
  );
}

// One Action Log row — Action / Subject / Detail / Actor / When.
export function ActionCard({ row }: { row: ActionLogEntry }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Field label="Action">{ACTION_LOG_LABELS[row.actionType] ?? row.actionType}</Field>
      <Field label="Subject" sub={row.subjectEmployeeId}>{row.subjectName ?? '—'}</Field>
      <Field label="Detail">{row.detail}</Field>
      <Field label="Actor">{row.actorName}</Field>
      <ThemedText type="small" themeColor="textSecondary">{fmtWhen(row.timestamp)}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  filterLabel: { marginBottom: Spacing.half },
  dateBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three },
  done: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  field: { gap: 1 },
  fieldLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
});
