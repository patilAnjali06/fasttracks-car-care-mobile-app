import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as XLSX from 'xlsx';

import { AbsentToday, AdminHeader, TodayAttendance } from '@/components/attendance/admin-today';
import { fmtIST as fmtTime, todayStr as todayISO } from '@/components/attendance/attendance-format';
import { DayModal } from '@/components/attendance/day-modal';
import { ErrorBanner } from '@/components/overview/parts';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Layout, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { attendanceStatusColor, attendanceStatusLabel } from '@/constants/attendance-status';
import { useTheme } from '@/hooks/use-theme';
import {
  bulkMarkAttendance, downloadAttendanceReport, fetchAttendanceDailyLog, fetchAttendancePunches,
  fetchAttendanceRegister, fetchEmployees, fetchMyMonthlyAttendance, getErrorMessage,
  importDeviceAttendance, overrideAttendance,
  type AttendanceRegisterEmployee, type DeviceImportResult,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AttendanceRecord, EmployeeListItem } from '@/types/api';

// Mirrors the dashboard's exact role gates for these same actions
// (frontend/src/app/(dashboard)/dashboard/attendance/page.tsx: canBulkMark,
// canImport, canDownload, canOverride) -- not a re-derived or simplified
// version, the same arrays.
const CAN_BULK_MARK = ['OWNER', 'STORE_MANAGER'];
const CAN_IMPORT = ['OWNER', 'STORE_MANAGER'];
const CAN_DOWNLOAD = ['OWNER', 'STORE_MANAGER', 'HR'];
const CAN_OVERRIDE = ['OWNER', 'STORE_MANAGER'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BULK_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'] as const;
const OVERRIDE_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE'] as const;

// ── Status chip row (shared by Bulk Mark + Override) ──────────────────────
function StatusChips({
  options, value, onChange, theme,
}: { options: readonly string[]; value: string; onChange: (v: string) => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.chipRow}>
      {options.map((s) => (
        <Pressable
          key={s}
          onPress={() => onChange(s)}
          style={[styles.chip, { backgroundColor: value === s ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={value === s ? styles.chipLabelActive : undefined}>
            {s.replace('_', ' ')}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

// ── Override Modal — identical fields to the dashboard's cell editor ──────
function OverrideModal({
  empId, empName, date, currentStatus, selfBlocked, onClose, onSaved,
}: {
  empId: string; empName: string; date: string; currentStatus: string; selfBlocked: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const theme = useTheme();
  const [status, setStatus] = useState(currentStatus || 'ABSENT');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await overrideAttendance(empId, date, { status, reason });
      setMsg({ ok: true, text: '✓ Attendance updated' });
      setTimeout(onSaved, 700);
    } catch (err: any) {
      setMsg({ ok: false, text: getErrorMessage(err, 'Failed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !saving && onClose()}>
        <Pressable style={[styles.dialog, { backgroundColor: theme.backgroundElement }]} onPress={(e) => e.stopPropagation()}>
          <ThemedText type="subtitle">Override Attendance</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.three }}>
            {empName} · {new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
          </ThemedText>

          <View style={styles.currentRow}>
            <ThemedText type="small" themeColor="textSecondary">Current: </ThemedText>
            <View style={[styles.badge, { backgroundColor: attendanceStatusColor(currentStatus as any) }]}>
              <ThemedText type="small" style={styles.badgeLabel}>{currentStatus || 'No record'}</ThemedText>
            </View>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>New Status</ThemedText>
          <StatusChips options={OVERRIDE_STATUSES} value={status} onChange={setStatus} theme={theme} />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Reason (optional)</ThemedText>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Device didn't sync"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
            returnKeyType="done"
            onSubmitEditing={() => !saving && !selfBlocked && save()}
          />

          {msg && (
            <ThemedText type="small" style={{ color: msg.ok ? theme.success : theme.danger, marginTop: Spacing.two }}>
              {msg.text}
            </ThemedText>
          )}
          {selfBlocked && (
            <ThemedText type="small" style={{ color: theme.danger, marginTop: Spacing.two }}>
              You cannot modify your own attendance. Contact Rakesh Sir.
            </ThemedText>
          )}

          <View style={styles.actionRow}>
            <Pressable
              onPress={save}
              disabled={saving || selfBlocked}
              style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving || selfBlocked ? 0.5 : 1 }]}>
              <ThemedText type="smallBold" style={styles.chipLabelActive}>{saving ? 'Saving…' : 'Save'}</ThemedText>
            </Pressable>
            <Pressable onPress={onClose} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Employee → their month as a list (agreed layout exception, the other
// half of the register-grid replacement). ────────────────────────────────
function EmployeeMonthView({
  employee, canOverride, myId, myRole, onClose, onOverrideSaved,
}: {
  employee: { id: string; name: string; role: string }; canOverride: boolean; myId: string; myRole: string;
  onClose: () => void; onOverrideSaved: () => void;
}) {
  const theme = useTheme();
  const now = new Date();
  const [monthYear, setMonthYear] = useState({ month: now.getMonth(), year: now.getFullYear() });
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [overrideDate, setOverrideDate] = useState<{ date: string; status: string } | null>(null);

  const load = useCallback(() => {
    setRecords(null);
    fetchMyMonthlyAttendance(monthYear.month + 1, monthYear.year, employee.id).then(setRecords).catch(() => setRecords([]));
  }, [monthYear, employee.id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / month change
  useEffect(() => { load(); }, [load]);

  const prevMonth = () => setMonthYear((p) => (p.month === 0 ? { month: 11, year: p.year - 1 } : { ...p, month: p.month - 1 }));
  const nextMonth = () => setMonthYear((p) => (p.month === 11 ? { month: 0, year: p.year + 1 } : { ...p, month: p.month + 1 }));

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ThemedView type="background" style={styles.flex1}>
        <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
          <View style={styles.flex1}>
            <ThemedText type="subtitle">{employee.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{employee.role.replace(/_/g, ' ')}</ThemedText>
          </View>
          <Pressable onPress={onClose} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
        </View>

        <View style={styles.monthNav}>
          <Pressable onPress={prevMonth} hitSlop={8}><ThemedText type="subtitle">‹</ThemedText></Pressable>
          <ThemedText type="smallBold">{MONTH_NAMES[monthYear.month]} {monthYear.year}</ThemedText>
          <Pressable onPress={nextMonth} hitSlop={8}><ThemedText type="subtitle">›</ThemedText></Pressable>
        </View>

        {records === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.four }} />
        ) : (
          <ScrollView contentContainerStyle={styles.sheetScroll}>
            {records.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No attendance records this month.</ThemedText>
            ) : (
              records.filter((r) => r.status !== 'WEEKEND').map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => canOverride && setOverrideDate({ date: r.date.slice(0, 10), status: r.status })}
                  style={[styles.row, { borderColor: theme.border }]}>
                  <View style={[styles.avatarBadge, { backgroundColor: attendanceStatusColor(r.status) }]}>
                    <ThemedText type="small" style={styles.chipLabelActive}>{attendanceStatusLabel(r.status).slice(0, 2)}</ThemedText>
                  </View>
                  <ThemedText type="small" style={styles.flex1}>
                    {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </ThemedText>
                  <View style={styles.rowRight}>
                    <ThemedText type="small" themeColor="textSecondary">In: {r.clockIn ? fmtTime(r.clockIn) : '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Out: {r.clockOut ? fmtTime(r.clockOut) : '—'}</ThemedText>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        )}

        {overrideDate && (
          <OverrideModal
            empId={employee.id}
            empName={employee.name}
            date={overrideDate.date}
            currentStatus={overrideDate.status}
            selfBlocked={myRole === 'STORE_MANAGER' && employee.id === myId}
            onClose={() => setOverrideDate(null)}
            onSaved={() => { setOverrideDate(null); load(); onOverrideSaved(); }}
          />
        )}
      </ThemedView>
    </Modal>
  );
}

// ── Bulk Mark Modal — identical fields to the dashboard's ────────────────
function BulkMarkModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const theme = useTheme();
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string>('PRESENT');
  const [date, setDate] = useState(todayISO());
  const [clockIn, setClockIn] = useState('09:00');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchEmployees().then((list) => setEmployees(list.filter((e) => e.role !== 'OWNER'))).catch(() => setError('Failed to load employees.'));
  }, []);

  const filtered = (employees ?? []).filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));
  const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (allSelected) filtered.forEach((e) => s.delete(e.id));
      else filtered.forEach((e) => s.add(e.id));
      return s;
    });
  };
  const toggleOne = (id: string) => setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const showClockIn = status === 'PRESENT' || status === 'LATE' || status === 'HALF_DAY';

  const submit = async () => {
    if (selected.size === 0) { setError('Select at least one employee.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await bulkMarkAttendance({ userIds: Array.from(selected), date, status, ...(showClockIn && clockIn ? { clockIn } : {}) });
      onSuccess();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to mark attendance.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ThemedView type="background" style={styles.flex1}>
        <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
          <ThemedText type="subtitle" style={styles.flex1}>Bulk Mark Attendance</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetScroll}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Date</ThemedText>
          <TextInput
            value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Status</ThemedText>
          <StatusChips options={BULK_STATUSES} value={status} onChange={setStatus} theme={theme} />

          {showClockIn && (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Clock-in Time (IST)</ThemedText>
              <TextInput
                value={clockIn} onChangeText={setClockIn} placeholder="HH:MM" placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
              />
            </>
          )}

          <View style={styles.searchHeaderRow}>
            <TextInput
              value={search} onChangeText={setSearch} placeholder="Search employees..." placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            />
            <ThemedText type="small" themeColor="textSecondary">{selected.size} selected</ThemedText>
          </View>

          {employees === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.three }} />
          ) : (
            <View style={[styles.listBox, { borderColor: theme.border }]}>
              <Pressable onPress={toggleAll} style={[styles.selectAllRow, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {allSelected ? 'Deselect All' : 'Select All'} ({filtered.length})
                </ThemedText>
              </Pressable>
              {filtered.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.three, textAlign: 'center' }}>No employees found.</ThemedText>
              ) : (
                filtered.map((emp) => (
                  <Pressable
                    key={emp.id}
                    onPress={() => toggleOne(emp.id)}
                    style={[styles.empRow, { borderColor: theme.border, backgroundColor: selected.has(emp.id) ? `${theme.primary}18` : 'transparent' }]}>
                    <View style={[styles.checkbox, { borderColor: theme.border, backgroundColor: selected.has(emp.id) ? theme.primary : 'transparent' }]} />
                    <ThemedText type="small" style={styles.flex1}>{emp.name}</ThemedText>
                    <View style={[styles.roleBadge, { backgroundColor: theme.background }]}>
                      <ThemedText type="small" themeColor="textSecondary">{emp.role.replace('_', ' ')}</ThemedText>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          )}

          {error ? <ThemedText type="small" style={{ color: theme.danger, marginTop: Spacing.two }}>{error}</ThemedText> : null}

          <View style={styles.actionRow}>
            <Pressable onPress={submit} disabled={submitting} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: submitting ? 0.6 : 1 }]}>
              <ThemedText type="smallBold" style={styles.chipLabelActive}>
                {submitting ? 'Marking…' : `Mark ${selected.size > 0 ? `${selected.size} Employee${selected.size > 1 ? 's' : ''}` : 'Attendance'}`}
              </ThemedText>
            </Pressable>
            <Pressable onPress={onClose} disabled={submitting} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

// ── Import Results Modal ──────────────────────────────────────────────────
function ImportResultsModal({ result, onClose }: { result: DeviceImportResult; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ThemedView type="background" style={styles.flex1}>
        <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
          <View style={styles.flex1}>
            <ThemedText type="subtitle">Import Results</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Updated: {result.summary.updated} · Skipped: {result.summary.skipped} · Not found: {result.summary.notFound}
            </ThemedText>
          </View>
          <Pressable onPress={onClose} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetScroll}>
          {result.results.map((row, i) => (
            <View key={i} style={[styles.row, { borderColor: theme.border }]}>
              <ThemedText type="small" style={styles.flex1}>{row.employeeName || row.deviceUserId}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{row.punchTime ? row.punchTime.slice(0, 16).replace('T', ' ') : '—'}</ThemedText>
              <View style={[styles.roleBadge, { backgroundColor: theme.background, marginLeft: Spacing.two }]}>
                <ThemedText type="small" themeColor="textSecondary">{row.result}</ThemedText>
              </View>
            </View>
          ))}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

// ── Main manager screen ───────────────────────────────────────────────────
export function AdminAttendance() {
  const theme = useTheme();
  const { user } = useAuth();
  const myId = (user as any)?.id ?? '';
  const myRole = user?.role ?? '';
  const canBulkMark = CAN_BULK_MARK.includes(myRole);
  const canImport = CAN_IMPORT.includes(myRole);
  const canDownload = CAN_DOWNLOAD.includes(myRole);
  const canOverride = CAN_OVERRIDE.includes(myRole);

  const now = new Date();
  const today = todayISO();
  const [viewMonth, setViewMonth] = useState({ month: now.getMonth(), year: now.getFullYear() });
  const isCurrentMonth = viewMonth.month === now.getMonth() && viewMonth.year === now.getFullYear();

  const [todayData, setTodayData] = useState<Awaited<ReturnType<typeof fetchAttendanceDailyLog>> | null>(null);
  const [regData, setRegData] = useState<Awaited<ReturnType<typeof fetchAttendanceRegister>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedPunches, setExpandedPunches] = useState<{ direction: 'IN' | 'OUT'; time: string }[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const [modalDate, setModalDate] = useState<string | null>(null);
  const [modalStatus, setModalStatus] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [monthViewEmployee, setMonthViewEmployee] = useState<AttendanceRegisterEmployee | null>(null);
  const [bulkMarkOpen, setBulkMarkOpen] = useState(false);
  const [importResults, setImportResults] = useState<DeviceImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [dlLoading, setDlLoading] = useState<string | null>(null);
  const [dlMsg, setDlMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const yyyy = viewMonth.year;
  const mm = String(viewMonth.month + 1).padStart(2, '0');
  const fromDate = `${yyyy}-${mm}-01`;
  const toDate = isCurrentMonth ? today : new Date(Date.UTC(viewMonth.year, viewMonth.month + 1, 0)).toISOString().split('T')[0];

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [td, rd] = await Promise.all([fetchAttendanceDailyLog(today), fetchAttendanceRegister(fromDate, toDate)]);
      setTodayData(td);
      setRegData(rd);
    } catch (err: any) {
      setErrorMsg(getErrorMessage(err, 'Failed to load attendance.'));
    } finally {
      setLoading(false);
    }
  }, [today, fromDate, toDate]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / month change
  useEffect(() => { void load(); }, [load]);

  // ?date=YYYY-MM-DD&status=PRESENT|LATE|ABSENT: jump the register to that month
  // and open the day sheet pre-filtered, like the dashboard's deep link.
  const params = useLocalSearchParams<{ date?: string; status?: string }>();
  useEffect(() => {
    const d = params.date;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const [y, m] = d.split('-').map(Number);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep link
    setViewMonth({ month: m - 1, year: y });
    setModalDate(d);
    if (params.status) setModalStatus(params.status);
  }, [params.date, params.status]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleExpanded = async (empId: string) => {
    if (expandedId === empId) { setExpandedId(null); return; }
    setExpandedId(empId);
    setExpandedLoading(true);
    try { setExpandedPunches(await fetchAttendancePunches(empId, today)); }
    catch { setExpandedPunches([]); }
    finally { setExpandedLoading(false); }
  };

  const copyAbsentees = async () => {
    if (!todayData?.absentees?.length) return;
    const text = todayData.absentees.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImportFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setImporting(true);
    setErrorMsg(null);
    try {
      const b64 = await FileSystem.readAsStringAsync(picked.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
      const workbook = XLSX.read(b64, { type: 'base64' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
      // Same file format and same first-punch-per-(id,date) dedupe as the
      // dashboard's Import from Device (attendance/page.tsx handleImportFile).
      const seen = new Map<string, { deviceUserId: string; name: string; punchTime: string }>();
      for (const row of rawRows) {
        if (!row || row.length < 3) continue;
        const deviceUserId = String(row[0] || '').trim();
        const name = String(row[1] || '').trim();
        const timeStr = String(row[2] || '').trim();
        if (!deviceUserId || !timeStr || !/\d{4}\/\d{2}\/\d{2}/.test(timeStr)) continue;
        const iso = timeStr.replace(/\//g, '-').replace(' ', 'T') + '+05:30';
        const dateKey = timeStr.slice(0, 10);
        const key = `${deviceUserId}::${dateKey}`;
        if (!seen.has(key)) seen.set(key, { deviceUserId, name, punchTime: iso });
      }
      const rows = Array.from(seen.values());
      if (rows.length === 0) { setErrorMsg('No valid rows found in file'); return; }
      const result = await importDeviceAttendance(rows);
      setImportResults(result);
      void load();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDownload = async (kind: 'daily' | 'monthly', format: 'pdf' | 'excel') => {
    const key = `${kind}-${format}`;
    setDlLoading(key);
    setDlMsg(null);
    try {
      const { uri } = kind === 'daily'
        ? await downloadAttendanceReport('daily', { date: today, format })
        : await downloadAttendanceReport('monthly', { month: viewMonth.month + 1, year: viewMonth.year, format });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
      setDlMsg({ ok: true, text: `${kind === 'daily' ? 'Daily' : 'Monthly'} ${format.toUpperCase()} downloaded` });
    } catch {
      setDlMsg({ ok: false, text: `Failed to download ${kind} ${format.toUpperCase()}` });
    } finally {
      setDlLoading(null);
      setTimeout(() => setDlMsg(null), 4000);
    }
  };

  const daysInMonth = new Date(yyyy, viewMonth.month + 1, 0).getDate();
  const firstDow = new Date(yyyy, viewMonth.month, 1).getDay();
  const todayDate = now.getDate();

  const registerSummary = useMemo(() => {
    if (!regData) return [];
    const GO_LIVE = '2026-05-28';
    const countableDates = regData.dates.filter((d) => d >= GO_LIVE);
    return [...regData.employees].sort((a, b) => a.name.localeCompare(b.name)).map((emp) => {
      let presentCount = 0, absentCount = 0;
      for (const d of countableDates) {
        const s = emp.attendance[d]?.status;
        if (s === 'PRESENT' || s === 'LATE' || s === 'HALF_DAY') presentCount++;
        else if (s === 'ABSENT') absentCount++;
      }
      return { emp, presentCount, absentCount, workingDays: countableDates.length };
    });
  }, [regData]);

  return (
    <View style={styles.flex1} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <AdminHeader
          wide={width >= 560}
          primaryActions={
            <>
              {canBulkMark && (
                <Pressable onPress={() => setBulkMarkOpen(true)} style={[styles.actionChip, { backgroundColor: theme.primary }]}>
                  <ThemedText type="small" style={styles.chipLabelActive}>Bulk Mark Attendance</ThemedText>
                </Pressable>
              )}
              {canImport && (
                <Pressable onPress={handleImportFile} disabled={importing} style={[styles.actionChip, { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border }]}>
                  <ThemedText type="small">{importing ? 'Importing...' : 'Import from Device'}</ThemedText>
                </Pressable>
              )}
            </>
          }
          canDownload={canDownload}
          monthTitle={`${MONTH_NAMES[viewMonth.month]} ${viewMonth.year}`}
          dlLoading={dlLoading}
          dlMsg={dlMsg}
          onDownload={handleDownload}
        />
        {errorMsg ? <ErrorBanner message={errorMsg} onRetry={load} /> : null}

        <AbsentToday data={todayData} loading={loading} copied={copied} onCopy={copyAbsentees} />
        <TodayAttendance
          data={todayData}
          regData={regData}
          loading={loading}
          today={today}
          search={search}
          onSearch={setSearch}
          expandedId={expandedId}
          expandedLoading={expandedLoading}
          expandedPunches={expandedPunches}
          onToggle={toggleExpanded}
        />

        {/* Month nav */}
        <View style={styles.monthNav}>
          <Pressable onPress={() => setViewMonth((p) => (p.month === 0 ? { month: 11, year: p.year - 1 } : { ...p, month: p.month - 1 }))} hitSlop={8}>
            <ThemedText type="subtitle">‹</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Monthly Register — {MONTH_NAMES[viewMonth.month]} {yyyy}</ThemedText>
          <Pressable
            onPress={() => !isCurrentMonth && setViewMonth((p) => (p.month === 11 ? { month: 0, year: p.year + 1 } : { ...p, month: p.month + 1 }))}
            hitSlop={8} disabled={isCurrentMonth}>
            <ThemedText type="subtitle" style={{ opacity: isCurrentMonth ? 0.3 : 1 }}>›</ThemedText>
          </Pressable>
        </View>

        {/* Monthly per-employee summary — tap for that employee's month as a list
            (agreed layout exception, replaces the dashboard's wide date-by-date
            register table). */}
        {loading || !regData ? <ActivityIndicator /> : registerSummary.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No employee data yet.</ThemedText>
        ) : (
          registerSummary.map(({ emp, presentCount, absentCount, workingDays }) => (
            <Pressable key={emp.id} onPress={() => setMonthViewEmployee(emp)} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.flex1}>
                <ThemedText type="smallBold">{emp.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{emp.role.replace(/_/g, ' ')}</ThemedText>
              </View>
              <View style={styles.rowRight}>
                <ThemedText type="smallBold" style={{ color: theme.success }}>{presentCount}/{workingDays} present</ThemedText>
                <ThemedText type="small" style={{ color: absentCount > 0 ? theme.danger : theme.textSecondary }}>{absentCount} absent</ThemedText>
              </View>
            </Pressable>
          ))
        )}

        {/* Calendar — tap any day to see that day's employee list */}
        <ThemedText type="smallBold" style={styles.sectionTitle}>{MONTH_NAMES[viewMonth.month]} {yyyy} — tap any day</ThemedText>
        <View style={styles.calendarDowRow}>
          {DAY_SHORT.map((d) => <ThemedText key={d} type="small" themeColor="textSecondary" style={styles.calendarDow}>{d}</ThemedText>)}
        </View>
        <View style={styles.calendarGrid}>
          {Array.from({ length: firstDow }).map((_, i) => <View key={`e-${i}`} style={styles.calendarCell} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const isToday = isCurrentMonth && day === todayDate;
            const isFuture = isCurrentMonth && day > todayDate;
            const dateStr = `${yyyy}-${mm}-${String(day).padStart(2, '0')}`;
            return (
              <Pressable
                key={day}
                disabled={isFuture}
                onPress={() => setModalDate(dateStr)}
                style={[styles.calendarCell, { backgroundColor: isToday ? theme.primary : isFuture ? 'transparent' : theme.backgroundElement }]}>
                <ThemedText type="small" style={isToday ? styles.chipLabelActive : (isFuture ? { color: theme.border } : undefined)}>{day}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {modalDate && (
        <DayModal date={modalDate} initialSearch={search} onSearchChange={setSearch} initialStatus={modalStatus} onClose={() => { setModalDate(null); setModalStatus(null); }} />
      )}
      {monthViewEmployee && (
        <EmployeeMonthView
          employee={monthViewEmployee} canOverride={canOverride} myId={myId} myRole={myRole}
          onClose={() => setMonthViewEmployee(null)} onOverrideSaved={() => void load()}
        />
      )}
      {bulkMarkOpen && (
        <BulkMarkModal onClose={() => setBulkMarkOpen(false)} onSuccess={() => { setBulkMarkOpen(false); void load(); }} />
      )}
      {importResults && <ImportResultsModal result={importResults} onClose={() => setImportResults(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  headerRow: { paddingHorizontal: Layout.screenPaddingH, paddingTop: Spacing.three },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Layout.screenPaddingH, marginTop: Spacing.two },
  actionChip: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Radii.pill },
  dlGroup: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: Radii.md, overflow: 'hidden' },
  dlGroupLabel: { paddingHorizontal: Spacing.two },
  dlButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  content: { padding: Layout.screenPaddingH, gap: 24, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.three },
  sectionTitle: { marginTop: Spacing.four },
  copyButton: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: Radii.md, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: Radii.pill, borderWidth: 1 },
  chipLabelActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, borderBottomWidth: 1, minHeight: Layout.minTouchTarget },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  avatarBadge: { width: 28, height: 28, borderRadius: Radii.md, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingVertical: 4, paddingHorizontal: Spacing.two, borderRadius: Radii.sm },
  badgeLabel: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: Radii.md, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, minHeight: Layout.minTouchTarget },
  fieldLabel: { marginTop: Spacing.three, marginBottom: Spacing.one },
  currentRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.two },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  dialog: { width: '100%', maxWidth: 420, borderRadius: Radii.lg, padding: Spacing.four },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.four },
  actionButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three, borderRadius: Radii.md, minHeight: Layout.minTouchTarget },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Layout.screenPaddingH, borderBottomWidth: 1 },
  sheetScroll: { padding: Layout.screenPaddingH, paddingBottom: Spacing.six },
  searchWrap: { paddingHorizontal: Layout.screenPaddingH, paddingTop: Spacing.two },
  searchHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  listBox: { borderWidth: 1, borderRadius: Radii.md, marginTop: Spacing.two, overflow: 'hidden' },
  selectAllRow: { padding: Spacing.two, borderBottomWidth: 1 },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderBottomWidth: 1, minHeight: Layout.minTouchTarget },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1 },
  roleBadge: { paddingVertical: 2, paddingHorizontal: Spacing.two, borderRadius: Radii.pill },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginTop: Spacing.four },
  expandedPanel: { borderWidth: 1, borderRadius: Radii.md, padding: Spacing.three, marginBottom: Spacing.two },
  summaryRow: { flexDirection: 'row', gap: Spacing.two },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  calendarDowRow: { flexDirection: 'row', marginTop: Spacing.two },
  calendarDow: { flex: 1, textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: `${100 / 7}%`, aspectRatio: 1.2, alignItems: 'center', justifyContent: 'center', borderRadius: Radii.md },
});
