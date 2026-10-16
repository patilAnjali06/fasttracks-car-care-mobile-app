import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createPayslip, downloadPayslipPdf, fetchEmployees, fetchPayslipPrefill, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { EmployeeListItem, Payslip, PayslipLineItem, PayslipPrefill } from '@/types/api';

// PAYSLIP_ADMIN_ROLES = SALARY_ADMIN_ROLES + 'HR' (backend/src/routes/
// payslips.ts, re-verified 2026-09-28) — a role array deliberately
// distinct from plain SALARY_ADMIN_ROLES=[OWNER,STORE_MANAGER,CASHIER]:
// HR was removed from payroll export/disbursement/salary-edit access but
// is explicitly re-added here for payslip generation only. The router has
// no router-level gate (only per-route requireRoles calls) — no tab-
// permission/mode system involved anywhere in this route file.
const PAYSLIP_ROLES = ['OWNER', 'STORE_MANAGER', 'CASHIER', 'HR'];

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PayslipsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const theme = useTheme();
  const isAuthorized = PAYSLIP_ROLES.includes(user?.role ?? '');

  const now = new Date();
  const [employees, setEmployees] = useState<EmployeeListItem[] | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeListItem | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [prefill, setPrefill] = useState<PayslipPrefill | null>(null);
  const [issued, setIssued] = useState<Payslip | null>(null);
  const [isLoadingPrefill, setIsLoadingPrefill] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Editable form — dashboard's PayslipDialog lets the admin edit employee
  // name/role and every earnings/deductions row (label + amount, add/
  // remove) before saving; server always recomputes netPay from these rows
  // regardless of what's sent (backend/src/routes/payslips.ts POST /).
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formEarnings, setFormEarnings] = useState<PayslipLineItem[]>([]);
  const [formDeductions, setFormDeductions] = useState<PayslipLineItem[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const loadEmployees = useCallback(async () => {
    if (!isAuthorized) return;
    try {
      setEmployees(await fetchEmployees());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load employees.'));
    }
  }, [isAuthorized, setEmployees, setError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    loadEmployees();
  }, [loadEmployees]);

  const loadPrefill = useCallback(async (employee: EmployeeListItem, m: number, y: number) => {
    setIsLoadingPrefill(true);
    setError(null);
    setNotice(null);
    setPrefill(null);
    setIssued(null);
    setConfirmOverwrite(false);
    try {
      const p = await fetchPayslipPrefill(employee.id, m, y);
      setPrefill(p);
      setFormName(p.employeeName || employee.name);
      setFormRole(p.employeeRole || employee.designation || employee.role);
      setFormEarnings(p.earnings);
      setFormDeductions(p.deductions);
      setFormNotes('');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not build the payslip suggestion.'));
    } finally {
      setIsLoadingPrefill(false);
    }
  }, []);

  const netPayPreview = formEarnings.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    - formDeductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const updateRow = (kind: 'earnings' | 'deductions', i: number, patch: Partial<PayslipLineItem>) => {
    const setRows = kind === 'earnings' ? setFormEarnings : setFormDeductions;
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };
  const addRow = (kind: 'earnings' | 'deductions') => {
    const setRows = kind === 'earnings' ? setFormEarnings : setFormDeductions;
    setRows((prev) => [...prev, { label: '', amount: 0 }]);
  };
  const removeRow = (kind: 'earnings' | 'deductions', i: number) => {
    const setRows = kind === 'earnings' ? setFormEarnings : setFormDeductions;
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  };

  const onSelectEmployee = (employee: EmployeeListItem) => {
    setSelectedEmployee(employee);
    setShowPicker(false);
    loadPrefill(employee, month, year);
  };

  const onChangeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m);
    setYear(y);
    if (selectedEmployee) loadPrefill(selectedEmployee, m, y);
  };

  const onGenerate = async (overwrite: boolean) => {
    if (!selectedEmployee || !prefill) return;
    if ([...formEarnings, ...formDeductions].some((r) => !r.label.trim())) {
      setError('Every earnings/deductions row needs a label.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const payslip = await createPayslip({
        userId: selectedEmployee.id,
        month,
        year,
        employeeName: formName.trim() || prefill.employeeName,
        employeeRole: formRole.trim() || prefill.employeeRole,
        earnings: formEarnings,
        deductions: formDeductions,
        notes: formNotes.trim() || undefined,
        overwrite,
      });
      setIssued(payslip);
      setConfirmOverwrite(false);
      setNotice(overwrite ? 'Payslip regenerated.' : 'Payslip generated.');
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setConfirmOverwrite(true);
        setError('A payslip for this employee and month already exists.');
      } else {
        setError(getErrorMessage(err, 'Could not generate the payslip.'));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadEmployees();
    if (selectedEmployee) await loadPrefill(selectedEmployee, month, year);
    setIsRefreshing(false);
  };

  const onDownloadPdf = async (payslipId: string) => {
    setIsDownloading(true);
    setError(null);
    try {
      const { uri } = await downloadPayslipPdf(payslipId, month, year);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to download this payslip.'));
    } finally {
      setIsDownloading(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Payslips is only available to Owner, Store Manager, Cashier, or HR accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Payslips' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="smallBold">Employee</ThemedText>
        <Pressable onPress={() => setShowPicker((v) => !v)} style={[styles.picker, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText>{selectedEmployee ? selectedEmployee.name : 'Select an employee'}</ThemedText>
        </Pressable>

        {showPicker && (
          <ThemedView type="backgroundElement" style={styles.pickerList}>
            {employees === null ? (
              <ActivityIndicator />
            ) : employees.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">No employees found.</ThemedText>
            ) : (
              employees.map((e) => (
                <Pressable key={e.id} onPress={() => onSelectEmployee(e)} style={styles.pickerRow}>
                  <ThemedText>{e.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{e.designation ?? e.role}</ThemedText>
                </Pressable>
              ))
            )}
          </ThemedView>
        )}

        <View style={styles.monthRow}>
          <Pressable onPress={() => onChangeMonth(-1)} style={styles.monthButton}>
            <ThemedText>{'‹'}</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">{MONTH_NAMES[month - 1]} {year}</ThemedText>
          <Pressable onPress={() => onChangeMonth(1)} style={styles.monthButton}>
            <ThemedText>{'›'}</ThemedText>
          </Pressable>
        </View>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

        {isLoadingPrefill && <ActivityIndicator style={styles.spinner} />}

        {issued ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">{issued.employeeName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{issued.employeeRole}</ThemedText>
            {issued.earnings.map((e, i) => (
              <Row key={`e${i}`} label={e.label} value={formatCurrency(e.amount)} />
            ))}
            {issued.deductions.map((d, i) => (
              <Row key={`d${i}`} label={d.label} value={`-${formatCurrency(d.amount)}`} />
            ))}
            <Row label="Net Pay" value={formatCurrency(issued.netPay)} bold />
            {issued.notes ? <ThemedText type="small" themeColor="textSecondary">Notes: {issued.notes}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">
              Issued {new Date(issued.generatedAt).toLocaleDateString('en-IN')}
            </ThemedText>
            <Pressable onPress={() => onDownloadPdf(issued.id)} disabled={isDownloading} style={styles.downloadButton}>
              {isDownloading ? <ActivityIndicator /> : <ThemedText type="link">Download PDF</ThemedText>}
            </Pressable>
          </ThemedView>
        ) : prefill && !isLoadingPrefill ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Employee name</ThemedText>
            <TextInput
              value={formName}
              onChangeText={setFormName}
              style={[styles.rowInput, { color: theme.text, backgroundColor: theme.background }]}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Role / Designation</ThemedText>
            <TextInput
              value={formRole}
              onChangeText={setFormRole}
              style={[styles.rowInput, { color: theme.text, backgroundColor: theme.background }]}
            />

            <ThemedText type="smallBold" style={styles.fieldLabel}>Earnings</ThemedText>
            {formEarnings.length === 0 && <ThemedText type="small" themeColor="textSecondary">No earnings rows.</ThemedText>}
            {formEarnings.map((e, i) => (
              <View key={i} style={styles.editableRow}>
                <TextInput
                  value={e.label}
                  onChangeText={(t) => updateRow('earnings', i, { label: t })}
                  placeholder="Label"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.rowInput, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                />
                <TextInput
                  value={e.amount ? String(e.amount) : ''}
                  onChangeText={(t) => updateRow('earnings', i, { amount: Number(t) || 0 })}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.rowInput, styles.amountInput, { color: theme.text, backgroundColor: theme.background }]}
                />
                <Pressable onPress={() => removeRow('earnings', i)} accessibilityLabel="Remove row" style={styles.removeRowButton}>
                  <ThemedText style={styles.removeRowLabel}>✕</ThemedText>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => addRow('earnings')}><ThemedText type="link">+ Add row</ThemedText></Pressable>

            <ThemedText type="smallBold" style={styles.fieldLabel}>Deductions</ThemedText>
            {formDeductions.length === 0 && <ThemedText type="small" themeColor="textSecondary">No deduction rows.</ThemedText>}
            {formDeductions.map((d, i) => (
              <View key={i} style={styles.editableRow}>
                <TextInput
                  value={d.label}
                  onChangeText={(t) => updateRow('deductions', i, { label: t })}
                  placeholder="Label"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.rowInput, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                />
                <TextInput
                  value={d.amount ? String(d.amount) : ''}
                  onChangeText={(t) => updateRow('deductions', i, { amount: Number(t) || 0 })}
                  keyboardType="decimal-pad"
                  placeholder="₹"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.rowInput, styles.amountInput, { color: theme.text, backgroundColor: theme.background }]}
                />
                <Pressable onPress={() => removeRow('deductions', i)} accessibilityLabel="Remove row" style={styles.removeRowButton}>
                  <ThemedText style={styles.removeRowLabel}>✕</ThemedText>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => addRow('deductions')}><ThemedText type="link">+ Add row</ThemedText></Pressable>

            <Row label="Net Pay" value={formatCurrency(netPayPreview)} bold />
            <ThemedText type="small" themeColor="textSecondary" style={styles.helperText}>
              Always earnings − deductions — edit a row above to change it.
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes (optional)</ThemedText>
            <TextInput
              value={formNotes}
              onChangeText={setFormNotes}
              multiline
              style={[styles.rowInput, styles.notesInput, { color: theme.text, backgroundColor: theme.background }]}
            />

            {prefill.existing && !confirmOverwrite && (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.existingNote}>
                  A payslip already exists for this period (issued {new Date(prefill.existing.generatedAt).toLocaleDateString('en-IN')}).
                </ThemedText>
                <Pressable onPress={() => onDownloadPdf(prefill.existing!.id)} disabled={isDownloading} style={styles.downloadButton}>
                  {isDownloading ? <ActivityIndicator /> : <ThemedText type="link">Download PDF</ThemedText>}
                </Pressable>
              </>
            )}

            {confirmOverwrite ? (
              <View style={styles.confirmRow}>
                <Pressable onPress={() => onGenerate(true)} disabled={isGenerating} style={styles.generateButton}>
                  {isGenerating ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save & Print (overwrite issued payslip)</ThemedText>}
                </Pressable>
                <Pressable onPress={() => setConfirmOverwrite(false)} style={styles.cancelButton}>
                  <ThemedText type="small">Cancel</ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => onGenerate(false)} disabled={isGenerating} style={styles.generateButton}>
                {isGenerating ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.buttonLabel}>{prefill.existing ? 'Regenerate anyway' : 'Save & Print'}</ThemedText>
                )}
              </Pressable>
            )}
          </ThemedView>
        ) : (
          !isLoadingPrefill &&
          selectedEmployee && (
            <ThemedText type="small" themeColor="textSecondary">
              No data for this period.
            </ThemedText>
          )
        )}
      </ScrollView>
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type={bold ? 'smallBold' : 'small'} style={styles.tabularNums}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  picker: { borderRadius: Spacing.two, padding: Spacing.three },
  pickerList: { borderRadius: Spacing.two, maxHeight: 260 },
  pickerRow: { padding: Spacing.three, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.three, marginTop: Spacing.one },
  monthButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  spinner: { marginTop: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  existingNote: { marginTop: Spacing.one },
  confirmRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  generateButton: { marginTop: Spacing.two, height: 48, flex: 1, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { marginTop: Spacing.two, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  tabularNums: { fontVariant: ['tabular-nums'] },
  fieldLabel: { marginTop: Spacing.two },
  rowInput: { height: 42, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, fontSize: 15, marginTop: Spacing.half },
  editableRow: { flexDirection: 'row', gap: Spacing.one, alignItems: 'center', marginTop: Spacing.half },
  flex1: { flex: 1 },
  amountInput: { width: 90, marginTop: 0 },
  removeRowButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(184,48,48,0.15)' },
  removeRowLabel: { color: '#B83030', fontWeight: '700' },
  helperText: { marginTop: 2 },
  notesInput: { height: 60, textAlignVertical: 'top', paddingTop: Spacing.one },
  downloadButton: { marginTop: Spacing.two, minHeight: 40, justifyContent: 'center' },
});
