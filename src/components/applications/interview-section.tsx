import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelInterview,
  fetchEmployees,
  fetchInterviewDefaults,
  getErrorMessage,
  rescheduleInterview,
  scheduleInterview,
} from '@/lib/api';
import type {
  Application,
  EmployeeListItem,
  InterviewLocationType,
  InterviewSchedule,
  InterviewScheduleInput,
  InterviewScheduleResult,
} from '@/types/api';

// Matches the backend's InterviewLocationType (services/interviewSchedule.ts).
const LOCATION_KINDS: { key: InterviewLocationType; label: string }[] = [
  { key: 'COMPANY', label: 'Company office' },
  { key: 'ONLINE', label: 'Online' },
  { key: 'OTHER', label: 'Other address' },
];

const LOCATION_PLACEHOLDER: Record<InterviewLocationType, string> = {
  COMPANY: 'Office address or Maps link',
  ONLINE: 'https://meet.google.com/…',
  OTHER: 'Full address',
};

function fmtDateTime(d: string | Date) {
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function locationLabel(s: { location: string | null; locationType: InterviewLocationType | null }) {
  if (s.locationType === 'ONLINE') return 'Meeting link';
  if (s.locationType === 'COMPANY' || s.locationType === 'OTHER') return 'Location';
  return /^https?:\/\//i.test(s.location ?? '') ? 'Meeting link' : 'Location';
}

function emailLine(who: string, emailed: boolean, hasEmail: boolean) {
  if (emailed) return `${who} emailed`;
  return hasEmail ? `${who}: email failed to send` : `${who} has no email on file`;
}

// One field = a date button + a time button. Android's picker can't do both in
// one dialog, so each opens its own (date | time).
function DateTimeField({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  const theme = useTheme();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  return (
    <View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <View style={styles.row}>
        <Pressable onPress={() => setMode('date')} style={[styles.input, styles.flex1, styles.center, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</ThemedText>
        </Pressable>
        <Pressable onPress={() => setMode('time')} style={[styles.input, styles.flex1, styles.center, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</ThemedText>
        </Pressable>
      </View>
      {mode && (
        <DateTimePicker
          value={value}
          mode={mode}
          display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
          onChange={(_e, selected) => {
            setMode(Platform.OS === 'ios' ? mode : null);
            if (!selected) return;
            // Keep the other half (time / date) of the existing value.
            const next = new Date(value);
            if (mode === 'date') next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
            else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
            onChange(next);
          }}
        />
      )}
      {mode && Platform.OS === 'ios' && (
        <Pressable onPress={() => setMode(null)} style={styles.doneLink}>
          <ThemedText type="small">Done</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function ScheduleForm({
  application, existing, companyLocation, employees, onCancel, onSubmit, submitting, error,
}: {
  application: Application;
  existing: InterviewSchedule | null;
  companyLocation: string | null;
  employees: EmployeeListItem[];
  onCancel?: () => void;
  onSubmit: (body: InterviewScheduleInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const theme = useTheme();
  const initialKind: InterviewLocationType = existing?.locationType ?? (companyLocation ? 'COMPANY' : 'ONLINE');
  const [start, setStart] = useState(() => (existing ? new Date(existing.scheduledStart) : nextHour()));
  const [end, setEnd] = useState(() => (existing ? new Date(existing.scheduledEnd) : new Date(nextHour().getTime() + 60 * 60 * 1000)));
  const [interviewerId, setInterviewerId] = useState(existing?.interviewerId ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<InterviewLocationType>(initialKind);
  const [location, setLocation] = useState(existing?.location ?? (initialKind === 'COMPANY' ? companyLocation ?? '' : ''));
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const interviewer = employees.find((e) => e.id === interviewerId);

  const onStartChange = (d: Date) => {
    // Preserve the chosen duration when the start moves.
    setEnd(new Date(d.getTime() + Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000)));
    setStart(d);
  };

  const pickKind = (k: InterviewLocationType) => {
    if (k === kind) return;
    setKind(k);
    setLocation(k === 'COMPANY' ? companyLocation ?? '' : '');
  };

  const submit = () => {
    if (end <= start) { setFormError('End time must be after the start time.'); return; }
    if (!interviewerId) { setFormError('Choose an interviewer.'); return; }
    const loc = location.trim();
    if (!loc) {
      setFormError(kind === 'ONLINE' ? 'Enter the meeting link.' : kind === 'COMPANY' ? 'Enter the office address, or choose another location type.' : 'Enter the interview address.');
      return;
    }
    if (kind === 'ONLINE' && !/^https?:\/\//i.test(loc)) { setFormError('Enter the full meeting link, starting with https://'); return; }
    setFormError(null);
    onSubmit({
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      interviewerId,
      locationType: kind,
      location: loc,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <GlassCard>
      <ThemedText type="smallBold">{existing ? 'Reschedule Interview' : 'Schedule Interview'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Emails a calendar invite to {application.name} and the interviewer.
      </ThemedText>

      <DateTimeField label="Start *" value={start} onChange={onStartChange} />
      <DateTimeField label="End *" value={end} onChange={setEnd} />

      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Interviewer *</ThemedText>
      <Pressable onPress={() => setPickerOpen((v) => !v)} style={[styles.input, styles.center, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText>{interviewer ? `${interviewer.name}${interviewer.designation ? ` · ${interviewer.designation}` : ''}` : 'Select interviewer ▾'}</ThemedText>
      </Pressable>
      {pickerOpen && (
        <View style={styles.optionList}>
          {employees.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No active employees found.</ThemedText>
          ) : (
            employees.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => { setInterviewerId(e.id); setPickerOpen(false); }}
                style={[styles.option, { backgroundColor: e.id === interviewerId ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={e.id === interviewerId ? styles.chipLabelActive : undefined}>
                  {e.name}{e.designation ? ` · ${e.designation}` : ''}
                </ThemedText>
              </Pressable>
            ))
          )}
        </View>
      )}

      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Location *</ThemedText>
      <View style={styles.chipRow}>
        {LOCATION_KINDS.map((k) => {
          const disabled = k.key === 'COMPANY' && !companyLocation && kind !== 'COMPANY';
          return (
            <Pressable
              key={k.key}
              disabled={disabled}
              onPress={() => pickKind(k.key)}
              style={[styles.chip, { backgroundColor: kind === k.key ? theme.primary : theme.backgroundElement }, disabled && styles.disabled]}>
              <ThemedText type="small" style={kind === k.key ? styles.chipLabelActive : undefined}>{k.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      {!companyLocation && (
        <ThemedText type="small" themeColor="textSecondary">No default office location is configured.</ThemedText>
      )}
      <TextInput
        value={location}
        onChangeText={setLocation}
        placeholder={LOCATION_PLACEHOLDER[kind]}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={[styles.input, styles.fieldGap, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes</ThemedText>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional"
        placeholderTextColor={theme.textSecondary}
        multiline
        style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      {(formError || error) && <ThemedText style={styles.error}>{formError ?? error}</ThemedText>}
      <Pressable onPress={submit} disabled={submitting} style={styles.button}>
        {submitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>{existing ? 'Reschedule' : 'Schedule'}</ThemedText>}
      </Pressable>
      {onCancel && (
        <Pressable onPress={onCancel} disabled={submitting} style={[styles.button, styles.secondary]}>
          <ThemedText style={styles.buttonLabel}>Back</ThemedText>
        </Pressable>
      )}
    </GlassCard>
  );
}

// Rendered only when the backend would accept scheduling: status
// MANAGER_INTERVIEW and not converted.
export function InterviewSection({ application, onApplicationChanged }: {
  application: Application;
  onApplicationChanged: (app: Application) => void;
}) {
  const eligible = application.status === 'MANAGER_INTERVIEW' && !application.convertedUserId;
  const active = application.interviewSchedules?.find((s) => s.status === 'SCHEDULED') ?? null;

  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [companyLocation, setCompanyLocation] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InterviewScheduleResult | null>(null);

  const loadSetup = useCallback(async () => {
    setSetupError(null);
    try {
      const [emps, defaults] = await Promise.all([fetchEmployees(), fetchInterviewDefaults()]);
      setEmployees(emps.filter((e) => e.isActive));
      setCompanyLocation(defaults.companyLocation);
    } catch (err: any) {
      setSetupError(getErrorMessage(err, 'Could not load interview options.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    if (eligible) loadSetup();
  }, [eligible, loadSetup]);

  if (!eligible) return null;

  const run = async (action: () => Promise<InterviewScheduleResult>) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await action();
      setResult(res);
      setRescheduling(false);
      if (res.application) onApplicationChanged(res.application);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update the interview.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmSubmit = (body: InterviewScheduleInput) => {
    const when = fmtDateTime(body.scheduledStart);
    Alert.alert(
      active ? 'Reschedule interview?' : 'Schedule interview?',
      `${active ? 'Reschedules' : 'Schedules'} the interview for ${when} and emails ${application.name} and the interviewer.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: active ? 'Reschedule' : 'Schedule',
          onPress: () => run(() => (active ? rescheduleInterview(application.id, active.id, body) : scheduleInterview(application.id, body))),
        },
      ],
    );
  };

  const confirmCancel = () => {
    if (!active) return;
    Alert.alert('Cancel interview?', `Cancels the interview and emails ${application.name} and the interviewer a cancellation.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Cancel interview', style: 'destructive', onPress: () => run(() => cancelInterview(application.id, active.id)) },
    ]);
  };

  const resultCard = result && (
    <GlassCard>
      {result.message ? <ThemedText type="small" style={styles.notice}>{result.message}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">{emailLine('Candidate', result.candidateEmailed, result.candidateHasEmail)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{emailLine('Interviewer', result.interviewerEmailed, result.interviewerHasEmail)}</ThemedText>
    </GlassCard>
  );

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Manager interview</ThemedText>

      {setupError ? (
        <View>
          <ThemedText style={styles.error}>{setupError}</ThemedText>
          <Pressable onPress={loadSetup} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : employees === null ? (
        <ActivityIndicator size="small" />
      ) : active && !rescheduling ? (
        <GlassCard>
          <ThemedText type="smallBold">{fmtDateTime(active.scheduledStart)} – {fmtDateTime(active.scheduledEnd)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Interviewer: {active.interviewer.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{locationLabel(active)}: {active.location || 'Not set'}</ThemedText>
          {active.notes ? <ThemedText type="small" themeColor="textSecondary">Notes: {active.notes}</ThemedText> : null}
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <View style={styles.row}>
            <Pressable onPress={() => { setRescheduling(true); setResult(null); setError(null); }} disabled={busy} style={[styles.button, styles.flex1]}>
              <ThemedText style={styles.buttonLabel}>Reschedule</ThemedText>
            </Pressable>
            <Pressable onPress={confirmCancel} disabled={busy} style={[styles.button, styles.flex1, styles.danger]}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Cancel</ThemedText>}
            </Pressable>
          </View>
        </GlassCard>
      ) : (
        <ScheduleForm
          // Fresh form state per schedule being edited.
          key={active?.id ?? 'new'}
          application={application}
          existing={active}
          companyLocation={companyLocation}
          employees={employees}
          onCancel={active ? () => setRescheduling(false) : undefined}
          onSubmit={confirmSubmit}
          submitting={busy}
          error={error}
        />
      )}
      {resultCard}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  center: { justifyContent: 'center' },
  fieldLabel: { marginTop: Spacing.two, marginBottom: Spacing.one },
  fieldGap: { marginTop: Spacing.two },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  multiline: { height: 80, textAlignVertical: 'top', paddingTop: Spacing.two },
  chipRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  optionList: { gap: Spacing.one, marginTop: Spacing.one },
  option: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  doneLink: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
  error: { color: '#B83030', marginTop: Spacing.one },
  notice: { color: '#167A48' },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#8A8A8E' },
  danger: { backgroundColor: '#B83030' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
