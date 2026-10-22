import DateTimePicker from '@react-native-community/datetimepicker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelPaymentVoucher,
  cancelPurchaseVoucher,
  cancelDebitNote,
  createAllocation,
  createLedger,
  createPaymentVoucher,
  createPurchaseVoucher,
  deactivateLedger,
  deleteLedger,
  fetchLedgerDetail,
  fetchLedgers,
  fetchPurchaseOrders,
  getErrorMessage,
  postDebitNote,
  postPaidTransporterVoucher,
  reactivateLedger,
  updateLedger,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type {
  AccountingLedger,
  AccountingVoucherLineInput,
  LedgerDetail,
  PurchaseOrder,
  PurchaseVoucher,
  PurchaseVoucherItem,
} from '@/types/api';

// ACC_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING,CASHIER,INVENTORY_MANAGER]
// (backend/src/routes/accounting.ts, verified 2026-09-19, re-confirmed
// 2026-09-27). Hardcoded per-file role array by design — the route file's
// own comment says this deliberately does NOT use the getTabAccess
// tab-permission system because that system is fail-open for any tab not
// already live-enforced, and this is a money-handling route. All 5 roles
// get full power (create/post/cancel) — no entry-vs-cancel split.
const ROLES = ['OWNER', 'STORE_MANAGER', 'ACCOUNTING', 'CASHIER', 'INVENTORY_MANAGER'];

function fmt(n: number | string | null | undefined) {
  if (n == null) return '—';
  return `₹${Number(n).toFixed(2)}`;
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function emptyLine(): AccountingVoucherLineInput {
  return { description: '', rate: 0, amount: 0, quantity: 1 };
}

// ── CSV — same convention as the dashboard's downloadCsv/csvCell: BOM prefix
// so Excel opens as UTF-8, cells with commas/quotes/newlines quoted.
function csvCell(value: string | number): string {
  const s = String(value);
  // Guard against CSV/formula injection: text beginning with = + - @ (or a
  // leading tab/CR) is executed as a formula by Excel/Sheets. Only string
  // values can carry this, so prefix them with ' to keep them plain text;
  // numeric values (including negatives) are left untouched.
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
async function shareCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, '﻿' + csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
}

function Field({
  label, value, onChangeText, theme, placeholder, keyboardType, multiline, autoCapitalize,
}: {
  label: string; value: string; onChangeText: (t: string) => void; theme: ReturnType<typeof useTheme>;
  placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad'; multiline?: boolean;
  autoCapitalize?: 'none' | 'characters';
}) {
  return (
    <View style={styles.fieldGroup}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
      />
    </View>
  );
}

function DateField({
  label, value, onChange, theme,
}: { label: string; value: string; onChange: (iso: string) => void; theme: ReturnType<typeof useTheme> }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <Pressable
        onPress={() => setShowPicker(true)}
        style={[styles.input, styles.dateInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText>{fmtDate(value)}</ThemedText>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={new Date(`${value}T00:00:00`)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_event, selected) => {
            setShowPicker(Platform.OS === 'ios');
            if (selected) onChange(selected.toISOString().slice(0, 10));
          }}
        />
      )}
    </View>
  );
}

function ChipRow<T extends string>({
  options, value, onChange, theme,
}: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.chip, { backgroundColor: value === o.key ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={value === o.key ? styles.chipLabelActive : undefined}>{o.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function ModalShell({
  visible, title, onClose, children, theme,
}: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; theme: ReturnType<typeof useTheme> }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <ThemedView style={styles.flex1}>
        <View style={[styles.sheetHeader, { borderColor: theme.border }]}>
          <ThemedText type="subtitle" style={styles.flex1}>{title}</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}><ThemedText type="subtitle">✕</ThemedText></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

// ── New Ledger modal ────────────────────────────────────────────────────
function NewLedgerModal({ visible, onClose, onCreated, theme }: { visible: boolean; onClose: () => void; onCreated: () => void; theme: ReturnType<typeof useTheme> }) {
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setName(''); setGstin(''); setPhone(''); setEmail(''); setAddress(''); setError(''); };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Ledger name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await createLedger({
        name: name.trim(),
        gstin: gstin.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      });
      reset();
      onCreated();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to create ledger.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell visible={visible} title="New Ledger (Sundry Creditor)" onClose={handleClose} theme={theme}>
      <Field label="Name *" value={name} onChangeText={setName} theme={theme} placeholder="Vendor / supplier name" />
      <Field label="GSTIN (optional — reference only, non-GST purchases only go through this ledger)" value={gstin} onChangeText={setGstin} theme={theme} autoCapitalize="characters" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} theme={theme} keyboardType="phone-pad" />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} theme={theme} />
      <Field label="Address (optional)" value={address} onChangeText={setAddress} theme={theme} multiline />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={handleClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Create</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Edit Ledger modal ────────────────────────────────────────────────────
const PARTY_TYPE_OPTIONS: { key: '' | 'SUPPLIER' | 'TRANSPORTER'; label: string }[] = [
  { key: '', label: '— Unclassified —' },
  { key: 'SUPPLIER', label: 'Supplier' },
  { key: 'TRANSPORTER', label: 'Transporter' },
];

function EditLedgerModal({
  ledger, onClose, onSaved, theme,
}: { ledger: AccountingLedger; onClose: () => void; onSaved: () => void; theme: ReturnType<typeof useTheme> }) {
  const [name, setName] = useState(ledger.name);
  const [gstin, setGstin] = useState(ledger.gstin ?? '');
  const [phone, setPhone] = useState(ledger.phone ?? '');
  const [email, setEmail] = useState(ledger.email ?? '');
  const [address, setAddress] = useState(ledger.address ?? '');
  const [partyType, setPartyType] = useState<'' | 'SUPPLIER' | 'TRANSPORTER'>(ledger.partyType ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Ledger name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      // Full-state save — every field sent explicitly, even blank ones,
      // matching the dashboard exactly (see updateLedger's own comment):
      // omitting a key preserves it server-side, but this modal represents
      // "what you see is what gets saved", not a partial patch.
      await updateLedger(ledger.id, {
        name: name.trim(),
        gstin: gstin.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        partyType: partyType === '' ? null : partyType,
      });
      onSaved();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to update ledger.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title="Edit Ledger" onClose={onClose} theme={theme}>
      <Field label="Name *" value={name} onChangeText={setName} theme={theme} placeholder="Vendor / supplier name" />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        Type (optional — controls which buttons/columns this ledger shows)
      </ThemedText>
      <ChipRow options={PARTY_TYPE_OPTIONS} value={partyType} onChange={setPartyType} theme={theme} />
      <Field label="GSTIN (optional — reference only, non-GST purchases only go through this ledger)" value={gstin} onChangeText={setGstin} theme={theme} autoCapitalize="characters" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} theme={theme} keyboardType="phone-pad" />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} theme={theme} />
      <Field label="Address (optional)" value={address} onChangeText={setAddress} theme={theme} multiline />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Save</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Deactivate / Reactivate confirm modal ────────────────────────────────
function DeactivateReactivateModal({
  ledger, onClose, onDone, theme,
}: { ledger: AccountingLedger; onClose: () => void; onDone: () => void; theme: ReturnType<typeof useTheme> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isActive = ledger.isActive;

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      if (isActive) await deactivateLedger(ledger.id);
      else await reactivateLedger(ledger.id);
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to update ledger status.'));
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title={isActive ? 'Deactivate Ledger' : 'Reactivate Ledger'} onClose={onClose} theme={theme}>
      <ThemedText type="small" style={styles.modalBody}>
        {isActive ? (
          <>No new purchase, payment, or receipt vouchers can be posted against <ThemedText type="smallBold">{ledger.name}</ThemedText> once deactivated. Its existing history and balance stay exactly as they are — nothing is deleted, and this can be undone any time.</>
        ) : (
          <><ThemedText type="smallBold">{ledger.name}</ThemedText> will accept new vouchers again.</>
        )}
      </ThemedText>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Back</ThemedText>
        </Pressable>
        <Pressable onPress={handleConfirm} disabled={saving} style={[styles.actionButton, { backgroundColor: isActive ? theme.danger : theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>{isActive ? 'Deactivate' : 'Reactivate'}</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Delete Ledger modal (two-path: hard-delete only if empty) ────────────
function DeleteLedgerModal({
  ledger, hasTransactions, onClose, onDeleted, onDeactivateInstead, theme,
}: {
  ledger: AccountingLedger; hasTransactions: boolean; onClose: () => void; onDeleted: () => void;
  onDeactivateInstead: () => void; theme: ReturnType<typeof useTheme>;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setError('');
    if (confirmText.trim() !== ledger.name) { setError('Type the ledger name exactly to confirm.'); return; }
    setSaving(true);
    try {
      await deleteLedger(ledger.id);
      onDeleted();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to delete ledger.'));
      setSaving(false);
    }
  };

  if (hasTransactions) {
    return (
      <ModalShell visible title="Cannot Permanently Delete" onClose={onClose} theme={theme}>
        <ThemedText type="small" style={styles.modalBody}>
          <ThemedText type="smallBold">{ledger.name}</ThemedText> has financial transactions on it (purchase, payment, or receipt vouchers — including cancelled ones, since those still carry real posted-and-reversed entries). Permanently deleting it would orphan that history and break the audit trail, so it&apos;s not allowed. Deactivate it instead — it stays fully intact and can no longer accept new vouchers.
        </ThemedText>
        <View style={styles.actionRow}>
          <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
            <ThemedText type="smallBold">Back</ThemedText>
          </Pressable>
          <Pressable onPress={onDeactivateInstead} style={[styles.actionButton, { backgroundColor: theme.danger }]}>
            <ThemedText type="smallBold" style={styles.white}>Deactivate Instead</ThemedText>
          </Pressable>
        </View>
      </ModalShell>
    );
  }

  return (
    <ModalShell visible title="Permanently Delete Ledger" onClose={onClose} theme={theme}>
      <ThemedText type="small" style={[styles.modalBody, { color: theme.danger }]}>
        This ledger has no purchase, payment, or receipt vouchers on it, so this is safe — but it cannot be undone. Type the ledger name to confirm.
      </ThemedText>
      <Field label={`Type "${ledger.name}" to confirm`} value={confirmText} onChangeText={setConfirmText} theme={theme} />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleDelete} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.danger, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Delete Permanently</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── New Purchase Voucher modal ───────────────────────────────────────────
function PurchaseVoucherModal({
  ledgerId, onClose, onDone, theme,
}: { ledgerId: string; onClose: () => void; onDone: () => void; theme: ReturnType<typeof useTheme> }) {
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDate, setVoucherDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [items, setItems] = useState<AccountingVoucherLineInput[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = items.reduce((s, it) => s + (it.quantity || 0) * (it.rate || 0), 0);

  const updateItem = (i: number, patch: Partial<AccountingVoucherLineInput>) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  const handleSubmit = async () => {
    setError('');
    if (!voucherNumber.trim()) { setError('Enter a voucher number.'); return; }
    // A row never touched is silently dropped — but a touched row must be
    // complete and positive, so a typo (e.g. a negative rate) doesn't just
    // vanish from the voucher, posting a different total than reviewed.
    const touchedItems = items.filter((it) => it.description.trim() || it.rate !== 0);
    const incomplete = touchedItems.some((it) => !it.description.trim() || it.rate <= 0);
    if (incomplete) {
      setError('Every item needs a description and a positive rate — fix or remove the incomplete row before posting.');
      return;
    }
    if (!touchedItems.length) { setError('Add at least one item with a description and rate.'); return; }
    setSaving(true);
    try {
      await createPurchaseVoucher({
        ledgerId,
        voucherNumber: voucherNumber.trim(),
        voucherDate,
        narration: narration.trim() || undefined,
        transporterName: transporterName.trim() || undefined,
        items: touchedItems.map((it) => ({ description: it.description.trim(), quantity: it.quantity, rate: it.rate, amount: (it.quantity ?? 1) * it.rate })),
      });
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to post purchase voucher.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title="New Purchase Voucher" onClose={onClose} theme={theme}>
      <Field label="Voucher # *" value={voucherNumber} onChangeText={setVoucherNumber} theme={theme} placeholder="e.g. PV-001" />
      <DateField label="Voucher Date *" value={voucherDate} onChange={setVoucherDate} theme={theme} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Items</ThemedText>
      {items.map((it, i) => (
        <ThemedView key={i} type="backgroundElement" style={styles.lineItemCard}>
          <TextInput
            value={it.description}
            onChangeText={(t) => updateItem(i, { description: t })}
            placeholder="Description"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
          />
          <View style={styles.lineItemRow}>
            <TextInput
              value={it.quantity ? String(it.quantity) : ''}
              onChangeText={(t) => updateItem(i, { quantity: Number(t) || 0 })}
              placeholder="Qty"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, styles.qtyInput, { color: theme.text, backgroundColor: theme.background }]}
            />
            <TextInput
              value={it.rate ? String(it.rate) : ''}
              onChangeText={(t) => updateItem(i, { rate: Number(t) || 0 })}
              placeholder="₹ Rate"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
            />
            {items.length > 1 && (
              <Pressable onPress={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} accessibilityLabel="Remove this line item" style={styles.removeButton}>
                <ThemedText style={styles.removeButtonLabel}>✕</ThemedText>
              </Pressable>
            )}
          </View>
        </ThemedView>
      ))}
      <Pressable onPress={() => setItems((prev) => [...prev, emptyLine()])} style={styles.addLineButton}>
        <ThemedText type="small">+ Add item</ThemedText>
      </Pressable>
      <Field
        label='Transporter (optional — who physically carried the goods, e.g. "Bajrang Transport")'
        value={transporterName} onChangeText={setTransporterName} theme={theme}
      />
      <Field label="Narration (optional)" value={narration} onChangeText={setNarration} theme={theme} multiline />
      <ThemedText type="smallBold" style={styles.fieldLabel}>Total: {fmt(total)}</ThemedText>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Post Voucher</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── New Payment/Receipt Voucher modal ────────────────────────────────────
function PaymentVoucherModal({
  ledgerId, purchaseVouchers, onClose, onDone, theme,
}: {
  ledgerId: string;
  purchaseVouchers: PurchaseVoucher[];
  onClose: () => void;
  onDone: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const [voucherType, setVoucherType] = useState<'PAYMENT' | 'RECEIPT'>('PAYMENT');
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDate, setVoucherDate] = useState(todayISO());
  const [totalAmount, setTotalAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [allocateToId, setAllocateToId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openPurchases = purchaseVouchers.filter((pv) => pv.status === 'ACTIVE' && Number(pv.outstanding) > 0);

  const handleSubmit = async () => {
    setError('');
    if (!voucherNumber.trim()) { setError('Enter a voucher number.'); return; }
    const amount = Number(totalAmount);
    if (!amount || amount <= 0) { setError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await createPaymentVoucher({
        ledgerId,
        voucherType,
        voucherNumber: voucherNumber.trim(),
        voucherDate,
        totalAmount: amount,
        narration: narration.trim() || undefined,
        allocations: voucherType === 'PAYMENT' && allocateToId ? [{ purchaseVoucherId: allocateToId, amount }] : undefined,
      });
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to post voucher.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title="New Payment / Receipt Voucher" onClose={onClose} theme={theme}>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setVoucherType('PAYMENT')} style={[styles.chip, { backgroundColor: voucherType === 'PAYMENT' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={voucherType === 'PAYMENT' ? styles.chipLabelActive : undefined}>Payment (we pay them)</ThemedText>
        </Pressable>
        <Pressable onPress={() => setVoucherType('RECEIPT')} style={[styles.chip, { backgroundColor: voucherType === 'RECEIPT' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={voucherType === 'RECEIPT' ? styles.chipLabelActive : undefined}>Receipt (they pay/refund us)</ThemedText>
        </Pressable>
      </View>
      <Field label="Voucher # *" value={voucherNumber} onChangeText={setVoucherNumber} theme={theme} placeholder="e.g. PAY-001" />
      <DateField label="Date *" value={voucherDate} onChange={setVoucherDate} theme={theme} />
      <Field label="Amount *" value={totalAmount} onChangeText={setTotalAmount} theme={theme} keyboardType="decimal-pad" />
      {voucherType === 'PAYMENT' && (
        <View style={styles.fieldGroup}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Allocate against a purchase (optional)</ThemedText>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setAllocateToId('')} style={[styles.chip, { backgroundColor: allocateToId === '' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText type="small" style={allocateToId === '' ? styles.chipLabelActive : undefined}>Leave as advance</ThemedText>
            </Pressable>
            {openPurchases.map((pv) => (
              <Pressable key={pv.id} onPress={() => setAllocateToId(pv.id)} style={[styles.chip, { backgroundColor: allocateToId === pv.id ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText type="small" style={allocateToId === pv.id ? styles.chipLabelActive : undefined}>{pv.voucherNumber} (outstanding {fmt(pv.outstanding)})</ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helperText}>Leave unselected to record this as an advance instead.</ThemedText>
        </View>
      )}
      <Field label="Narration (optional)" value={narration} onChangeText={setNarration} theme={theme} multiline />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Post Voucher</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Cancel confirm modal (shared: purchase / payment / debit note) ──────
function VoucherCancelModal({
  label, onClose, onConfirm, theme,
}: { label: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>; theme: ReturnType<typeof useTheme> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!reason.trim()) { setError('A cancellation reason is required.'); return; }
    setSaving(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to cancel.'));
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title={`Cancel ${label}`} onClose={onClose} theme={theme}>
      <ThemedText type="small" style={styles.modalBody}>
        This posts a reversing entry — it does not delete the original. This cannot be undone.
      </ThemedText>
      <Field label="Reason *" value={reason} onChangeText={setReason} theme={theme} multiline />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Back</ThemedText>
        </Pressable>
        <Pressable onPress={handleConfirm} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.danger, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Confirm Cancel</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Debit Note modal ─────────────────────────────────────────────────────
// The source voucher is never mutated — only a new DebitNote (and its
// reversing entry pair) gets created. Each item shows what's already been
// returned so the available amount is visible before typing a number;
// over-return is blocked client-side for fast feedback, and again,
// authoritatively, by postDebitNote itself.
function DebitNoteModal({
  sourceVoucher, replacementOptions, onClose, onDone, theme,
}: {
  sourceVoucher: PurchaseVoucher;
  replacementOptions: PurchaseVoucher[];
  onClose: () => void;
  onDone: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDate, setVoucherDate] = useState(todayISO());
  const [narration, setNarration] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // "Already returned" per item, from the ACTIVE debit notes already nested
  // on this voucher (see GET /accounting/ledgers/:id) — no extra fetch needed.
  const alreadyReturnedByItem = new Map<string, number>();
  for (const dn of sourceVoucher.debitNotesAsSource) {
    for (const line of dn.items) {
      alreadyReturnedByItem.set(
        line.purchaseVoucherItemId,
        (alreadyReturnedByItem.get(line.purchaseVoucherItemId) ?? 0) + Number(line.returnedQuantity),
      );
    }
  }
  const availableFor = (item: PurchaseVoucherItem) => Number(item.quantity) - (alreadyReturnedByItem.get(item.id) ?? 0);

  const total = sourceVoucher.items.reduce((s, item) => s + Number(returns[item.id] || 0) * Number(item.rate), 0);

  const handleSubmit = async () => {
    setError('');
    if (!voucherNumber.trim()) { setError('Enter a voucher number.'); return; }
    const touched = sourceVoucher.items
      .map((item) => ({ item, qty: Number(returns[item.id] || 0) }))
      .filter(({ qty }) => qty > 0);
    if (!touched.length) { setError('Enter a quantity for at least one returned item.'); return; }
    for (const { item, qty } of touched) {
      const available = availableFor(item);
      if (qty > available) {
        setError(`Cannot return ${qty} of "${item.description}" — only ${available} available (of ${item.quantity} purchased).`);
        return;
      }
    }
    setSaving(true);
    try {
      await postDebitNote({
        purchaseVoucherId: sourceVoucher.id,
        replacementPurchaseVoucherId: replacementId || undefined,
        voucherNumber: voucherNumber.trim(),
        voucherDate,
        narration: narration.trim() || undefined,
        items: touched.map(({ item, qty }) => ({ purchaseVoucherItemId: item.id, returnedQuantity: qty, amount: qty * Number(item.rate) })),
      });
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to post debit note.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell visible title={`Debit Note — against ${sourceVoucher.voucherNumber}`} onClose={onClose} theme={theme}>
      <Field label="Voucher # *" value={voucherNumber} onChangeText={setVoucherNumber} theme={theme} placeholder="e.g. DN-001" />
      <DateField label="Date *" value={voucherDate} onChange={setVoucherDate} theme={theme} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Items being returned</ThemedText>
      {sourceVoucher.items.map((item) => {
        const available = availableFor(item);
        const already = alreadyReturnedByItem.get(item.id) ?? 0;
        return (
          <ThemedView key={item.id} type="backgroundElement" style={styles.lineItemCard}>
            <ThemedText type="small">{item.description}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.quantity} purchased · {already} returned so far · <ThemedText type="smallBold">{available} available</ThemedText>
            </ThemedText>
            <TextInput
              value={returns[item.id] ?? ''}
              onChangeText={(t) => setReturns((prev) => ({ ...prev, [item.id]: t }))}
              placeholder="Return qty"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              editable={available > 0}
              style={[styles.input, { color: theme.text, backgroundColor: theme.background, opacity: available > 0 ? 1 : 0.5 }]}
            />
          </ThemedView>
        );
      })}
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Apply credit to a replacement purchase (optional)</ThemedText>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setReplacementId('')} style={[styles.chip, { backgroundColor: replacementId === '' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={replacementId === '' ? styles.chipLabelActive : undefined}>Don&apos;t link</ThemedText>
        </Pressable>
        {replacementOptions.map((pv) => (
          <Pressable key={pv.id} onPress={() => setReplacementId(pv.id)} style={[styles.chip, { backgroundColor: replacementId === pv.id ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText type="small" style={replacementId === pv.id ? styles.chipLabelActive : undefined}>{pv.voucherNumber} ({fmt(pv.totalAmount)})</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.helperText}>
        Leave unlinked and the credit reduces this bill&apos;s own outstanding. Link a replacement and the credit reduces that bill&apos;s outstanding instead — this bill&apos;s own figure won&apos;t change.
      </ThemedText>
      <Field label="Narration (optional)" value={narration} onChangeText={setNarration} theme={theme} multiline />
      <ThemedText type="smallBold" style={styles.fieldLabel}>Total credit: {fmt(total)}</ThemedText>
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Post Debit Note</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

// ── Transporter Payment modal ────────────────────────────────────────────
// Single entry point that hides which of the two existing document types
// gets created. Paid now -> postPaidTransporterVoucher (PAYMENT), same as
// any other ledger's payment. Pay later -> postPurchaseVoucher against the
// transporter's own ledger, same as any other purchase voucher — its
// outstanding balance is what makes it show up as payable. Neither posting
// function changes for this; this modal just decides which one to call.
function TransporterVoucherModal({ onClose, onDone, theme }: { onClose: () => void; onDone: () => void; theme: ReturnType<typeof useTheme> }) {
  const [transporters, setTransporters] = useState<AccountingLedger[]>([]);
  const [loadingTransporters, setLoadingTransporters] = useState(true);
  const [ledgerId, setLedgerId] = useState('');

  const [showNewTransporter, setShowNewTransporter] = useState(false);
  const [newTransporterName, setNewTransporterName] = useState('');
  const [newTransporterPhone, setNewTransporterPhone] = useState('');
  const [creatingTransporter, setCreatingTransporter] = useState(false);

  const [status, setStatus] = useState<'PAID' | 'UNPAID'>('PAID');
  const [voucherNumber, setVoucherNumber] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `TRP-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  });
  const [voucherDate, setVoucherDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [showPoPicker, setShowPoPicker] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchLedgers(false, 'TRANSPORTER')
      .then((res) => { if (!cancelled) setTransporters(res); })
      .finally(() => { if (!cancelled) setLoadingTransporters(false); });
    fetchPurchaseOrders()
      .then((res) => { if (!cancelled) setPurchaseOrders(res); })
      .catch(() => { /* purchase link is optional — a failed load just leaves the picker empty */ });
    return () => { cancelled = true; };
  }, []);

  const handleCreateTransporter = async () => {
    if (!newTransporterName.trim()) { setError('Enter a transporter name.'); return; }
    setCreatingTransporter(true);
    setError('');
    try {
      const created = await createLedger({ name: newTransporterName.trim(), phone: newTransporterPhone.trim() || undefined, partyType: 'TRANSPORTER' });
      setTransporters((prev) => [...prev, created]);
      setLedgerId(created.id);
      setShowNewTransporter(false);
      setNewTransporterName('');
      setNewTransporterPhone('');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to create transporter.'));
    } finally {
      setCreatingTransporter(false);
    }
  };

  const buildNarration = (): string | undefined => {
    const parts: string[] = [];
    if (referenceNumber.trim()) parts.push(`LR/Ref: ${referenceNumber.trim()}`);
    if (notes.trim()) parts.push(notes.trim());
    return parts.length ? parts.join(' — ') : undefined;
  };

  const handleSubmit = async () => {
    setError('');
    if (!ledgerId) { setError('Select or add a transporter.'); return; }
    if (!voucherNumber.trim()) { setError('Enter a voucher number.'); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      if (status === 'PAID') {
        // Books the expense AND settles it, atomically — a bare payment
        // voucher never touches PURCHASE_EXPENSE, so "paid now" needs both
        // documents or the expense never appears in the books at all.
        await postPaidTransporterVoucher({
          ledgerId,
          purchaseVoucherNumber: voucherNumber.trim(),
          paymentVoucherNumber: voucherNumber.trim(),
          voucherDate,
          narration: buildNarration(),
          items: [{ description: 'Freight / transport charges', quantity: 1, rate: amt, amount: amt }],
        });
      } else {
        await createPurchaseVoucher({
          ledgerId,
          voucherNumber: voucherNumber.trim(),
          voucherDate,
          narration: buildNarration(),
          purchaseOrderId: purchaseOrderId || undefined,
          items: [{ description: 'Freight / transport charges', quantity: 1, rate: amt, amount: amt }],
        });
      }
      onDone();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to record transporter voucher.'));
    } finally {
      setSaving(false);
    }
  };

  const poOptions = [...purchaseOrders].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());

  return (
    <ModalShell visible title="Transporter Payment" onClose={onClose} theme={theme}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Payment status</ThemedText>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setStatus('PAID')} style={[styles.chip, { backgroundColor: status === 'PAID' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={status === 'PAID' ? styles.chipLabelActive : undefined}>Paid now</ThemedText>
        </Pressable>
        <Pressable onPress={() => setStatus('UNPAID')} style={[styles.chip, { backgroundColor: status === 'UNPAID' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="small" style={status === 'UNPAID' ? styles.chipLabelActive : undefined}>Pay later</ThemedText>
        </Pressable>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Transporter *</ThemedText>
      {!showNewTransporter ? (
        <>
          <View style={styles.chipRow}>
            {loadingTransporters ? (
              <ActivityIndicator size="small" />
            ) : (
              transporters.map((t) => (
                <Pressable key={t.id} onPress={() => setLedgerId(t.id)} style={[styles.chip, { backgroundColor: ledgerId === t.id ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText type="small" style={ledgerId === t.id ? styles.chipLabelActive : undefined}>{t.name}</ThemedText>
                </Pressable>
              ))
            )}
          </View>
          <Pressable onPress={() => setShowNewTransporter(true)} style={styles.helperText}>
            <ThemedText type="link">+ New transporter</ThemedText>
          </Pressable>
        </>
      ) : (
        <ThemedView type="backgroundElement" style={styles.lineItemCard}>
          <Field label="Transporter name" value={newTransporterName} onChangeText={setNewTransporterName} theme={theme} />
          <Field label="Phone (optional)" value={newTransporterPhone} onChangeText={setNewTransporterPhone} theme={theme} keyboardType="phone-pad" />
          <View style={styles.actionRow}>
            <Pressable onPress={handleCreateTransporter} disabled={creatingTransporter} style={[styles.actionButton, { backgroundColor: theme.primary }]}>
              {creatingTransporter ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>Add</ThemedText>}
            </Pressable>
            <Pressable onPress={() => setShowNewTransporter(false)} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      )}

      <Field label="Voucher # *" value={voucherNumber} onChangeText={setVoucherNumber} theme={theme} placeholder="e.g. TRP-001" />
      <DateField label="Date *" value={voucherDate} onChange={setVoucherDate} theme={theme} />
      <Field label="Amount *" value={amount} onChangeText={setAmount} theme={theme} keyboardType="decimal-pad" />
      <Field label="LR / Reference number (optional)" value={referenceNumber} onChangeText={setReferenceNumber} theme={theme} placeholder="e.g. LR-48213" />

      {status === 'UNPAID' && (
        !showPoPicker ? (
          <Pressable onPress={() => setShowPoPicker(true)} style={styles.helperText}>
            <ThemedText type="link">+ Optional: link to a purchase order</ThemedText>
          </Pressable>
        ) : (
          <View style={styles.fieldGroup}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Related purchase (optional)</ThemedText>
            <View style={styles.chipRow}>
              <Pressable onPress={() => setPurchaseOrderId('')} style={[styles.chip, { backgroundColor: purchaseOrderId === '' ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText type="small" style={purchaseOrderId === '' ? styles.chipLabelActive : undefined}>No purchase link</ThemedText>
              </Pressable>
              {poOptions.map((po) => (
                <Pressable key={po.id} onPress={() => setPurchaseOrderId(po.id)} style={[styles.chip, { backgroundColor: purchaseOrderId === po.id ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText type="small" style={purchaseOrderId === po.id ? styles.chipLabelActive : undefined}>
                    PO {po.id.slice(-6).toUpperCase()} — {po.supplier?.name ?? 'Unknown supplier'} ({fmt(po.totalAmount)})
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helperText}>
              Reference only — records which purchase this freight relates to. Does not change how this posts to the books.
            </ThemedText>
          </View>
        )
      )}

      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} theme={theme} multiline />
      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} style={[styles.actionButton, { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border }]}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable onPress={handleSubmit} disabled={saving} style={[styles.actionButton, { backgroundColor: theme.primary, opacity: saving ? 0.7 : 1 }]}>
          {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.white}>{status === 'PAID' ? 'Record Payment' : 'Record Payable'}</ThemedText>}
        </Pressable>
      </View>
    </ModalShell>
  );
}

export default function AccountingScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = ROLES.includes(user?.role ?? '');

  const [ledgers, setLedgers] = useState<AccountingLedger[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // List filters — parity with dashboard's search box, "Show inactive
  // only" checkbox (a FILTER, not an additive toggle) and party-type select.
  const [search, setSearch] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [partyTypeFilter, setPartyTypeFilter] = useState<'' | 'SUPPLIER' | 'TRANSPORTER'>('');
  const [exporting, setExporting] = useState(false);

  // Ledger detail
  const [detail, setDetail] = useState<LedgerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editingLedger, setEditingLedger] = useState<AccountingLedger | null>(null);
  const [statusModalLedger, setStatusModalLedger] = useState<AccountingLedger | null>(null);
  const [deleteModalLedger, setDeleteModalLedger] = useState<AccountingLedger | null>(null);

  // Voucher cancel — mandatory reason, shared modal across purchase/payment/debit note.
  const [cancelTarget, setCancelTarget] = useState<{ kind: 'purchase' | 'payment' | 'debitNote'; id: string; label: string } | null>(null);
  const [debitNoteTarget, setDebitNoteTarget] = useState<PurchaseVoucher | null>(null);

  // Allocation — spend a payment voucher's leftover `available` against a
  // purchase voucher's `outstanding`.
  const [allocatingPurchaseId, setAllocatingPurchaseId] = useState<string | null>(null);
  const [allocatePaymentId, setAllocatePaymentId] = useState<string | null>(null);
  const [allocateAmount, setAllocateAmount] = useState('');

  // New ledger form
  const [showNewLedger, setShowNewLedger] = useState(false);
  const [showTransporterModal, setShowTransporterModal] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setLedgers(await fetchLedgers(true));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load ledgers.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    if (detail) await openLedger(detail.ledger.id);
    setIsRefreshing(false);
  };

  const openLedger = async (id: string) => {
    setDetailError(null);
    setLoadingDetailId(id);
    try {
      setDetail(await fetchLedgerDetail(id));
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not load this ledger.'));
    } finally {
      setLoadingDetailId(null);
    }
  };

  const onConfirmCancelVoucher = async (reason: string) => {
    if (!cancelTarget || !detail) return;
    if (cancelTarget.kind === 'purchase') await cancelPurchaseVoucher(cancelTarget.id, reason);
    else if (cancelTarget.kind === 'payment') await cancelPaymentVoucher(cancelTarget.id, reason);
    else await cancelDebitNote(cancelTarget.id, reason);
    setCancelTarget(null);
    await openLedger(detail.ledger.id);
    await load();
  };

  const onConfirmAllocate = async () => {
    if (!detail || !allocatingPurchaseId || !allocatePaymentId) return;
    const amount = Number(allocateAmount);
    if (!amount || amount <= 0) {
      setDetailError('Enter a positive allocation amount.');
      return;
    }
    setIsSaving(true);
    setDetailError(null);
    try {
      await createAllocation({ paymentVoucherId: allocatePaymentId, purchaseVoucherId: allocatingPurchaseId, amount });
      setAllocatingPurchaseId(null);
      setAllocatePaymentId(null);
      setAllocateAmount('');
      await openLedger(detail.ledger.id);
      await load();
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not allocate this advance.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onExportLedgerCsv = async () => {
    if (!detail) return;
    setExporting(true);
    try {
      const balanceNum = Number(detail.balance);
      const balanceLabel = balanceNum > 0 ? `They owe us ${fmt(balanceNum)} (advance)` : balanceNum < 0 ? `We owe them ${fmt(Math.abs(balanceNum))}` : 'Settled — ₹0.00';
      const rows: (string | number)[][] = [
        ['Ledger', detail.ledger.name],
        ['Balance', balanceLabel],
        [],
        ['Type', 'Voucher #', 'Date', 'Amount', 'Outstanding / Unallocated', 'Status', 'Transporter'],
        ...detail.purchaseVouchers.map((pv) => [
          'PURCHASE', pv.voucherNumber, fmtDate(pv.voucherDate), Number(pv.totalAmount).toFixed(2),
          pv.status === 'ACTIVE' ? Number(pv.outstanding).toFixed(2) : '',
          pv.status,
          pv.transporterName || '',
        ]),
        ...detail.paymentVouchers.map((p) => [
          p.voucherType, p.voucherNumber, fmtDate(p.voucherDate), Number(p.totalAmount).toFixed(2),
          (p.voucherType === 'PAYMENT' && p.status === 'ACTIVE') ? Number(p.available).toFixed(2) : '',
          p.status,
          '',
        ]),
      ];
      const safeLedgerName = detail.ledger.name.replace(/[^a-z0-9]+/gi, '-');
      await shareCsv(`ledger-${safeLedgerName}-${todayISO()}.csv`, rows);
    } catch (err: any) {
      Alert.alert('Export failed', getErrorMessage(err, 'Could not export this ledger.'));
    } finally {
      setExporting(false);
    }
  };

  const onExportAll = async () => {
    if (!ledgers) return;
    setExporting(true);
    try {
      const rows: (string | number)[][] = [
        ['Name', 'Type', 'Party Type', 'GSTIN', 'Phone', 'Status', 'Balance'],
        ...ledgers.map((l) => [
          l.name, l.type, l.partyType ?? '', l.gstin ?? '', l.phone ?? '',
          l.isActive ? 'Active' : 'Inactive', l.balance ?? '',
        ]),
      ];
      await shareCsv(`ledgers-${todayISO()}.csv`, rows);
    } catch (err: any) {
      Alert.alert('Export failed', getErrorMessage(err, 'Could not export ledgers.'));
    } finally {
      setExporting(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Accounting is only available to Owner, Store Manager, Accounting, Cashier, or Inventory Manager accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (showNewLedger) {
    return (
      <>
        <Stack.Screen options={{ title: 'New Ledger' }} />
        <ThemedView style={styles.flex1}>
          <Pressable onPress={() => setShowNewLedger(false)} style={styles.backLink}><ThemedText type="small">← Cancel</ThemedText></Pressable>
        </ThemedView>
        <NewLedgerModal
          visible
          onClose={() => setShowNewLedger(false)}
          onCreated={() => { setShowNewLedger(false); load(); }}
          theme={theme}
        />
      </>
    );
  }

  if (detail) {
    const hasTransactions = detail.purchaseVouchers.length > 0 || detail.paymentVouchers.length > 0;
    const debitNoteRows = detail.purchaseVouchers.flatMap((pv) =>
      pv.debitNotesAsSource.map((dn) => ({ ...dn, sourceVoucherNumber: pv.voucherNumber })),
    );
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: detail.ledger.name }} />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <Pressable onPress={() => { setDetail(null); setDetailError(null); }}><ThemedText type="small">← Back to ledgers</ThemedText></Pressable>
          <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>{detail.ledger.name}</ThemedText>
          <View style={styles.badgeRow}>
            {detail.ledger.partyType === 'TRANSPORTER' && <View style={[styles.badge, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><ThemedText type="small">Transporter</ThemedText></View>}
            {detail.ledger.partyType === 'SUPPLIER' && <View style={[styles.badge, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><ThemedText type="small">Supplier</ThemedText></View>}
            {!detail.ledger.isActive && <View style={[styles.badge, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><ThemedText type="small" style={styles.error}>Inactive</ThemedText></View>}
          </View>
          <ThemedText type="smallBold" style={[styles.tabularNums, { color: Number(detail.balance) < 0 ? theme.danger : theme.text }]}>
            Balance: {fmt(detail.balance)} {Number(detail.balance) > 0 ? '(payable)' : Number(detail.balance) < 0 ? '(advance)' : ''}
          </ThemedText>

          <View style={styles.ledgerActionsRow}>
            <Pressable onPress={() => setEditingLedger(detail.ledger)}>
              <ThemedText type="link">Edit</ThemedText>
            </Pressable>
            <Pressable onPress={() => setStatusModalLedger(detail.ledger)}>
              <ThemedText type="link">{detail.ledger.isActive ? 'Deactivate' : 'Reactivate'}</ThemedText>
            </Pressable>
            <Pressable onPress={() => setDeleteModalLedger(detail.ledger)}>
              <ThemedText type="small" style={styles.error}>Delete ledger</ThemedText>
            </Pressable>
          </View>

          {detailError && <ThemedText style={styles.error}>{detailError}</ThemedText>}

          <View style={styles.actionTabs}>
            <Pressable onPress={() => setShowPaymentModal(true)} style={[styles.actionTab, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">+ Payment voucher</ThemedText>
            </Pressable>
            <Pressable onPress={() => setShowPurchaseModal(true)} style={[styles.actionTab, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">+ Purchase voucher</ThemedText>
            </Pressable>
          </View>

          <Pressable onPress={onExportLedgerCsv} disabled={exporting} style={[styles.secondaryButton, styles.fieldLabel, { borderColor: theme.border }]}>
            {exporting ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Download Ledger (CSV)</ThemedText>}
          </Pressable>

          <ThemedText type="smallBold" style={styles.fieldLabel}>Purchase vouchers</ThemedText>
          {detail.purchaseVouchers.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">None yet.</ThemedText>
          ) : (
            detail.purchaseVouchers.map((v) => {
              const creditedElsewhere = v.debitNotesAsSource.filter((dn) => dn.replacementPurchaseVoucherId);
              const creditedTotal = creditedElsewhere.reduce((s, dn) => s + Number(dn.totalAmount), 0);
              const isFullyReturned = creditedTotal >= Number(v.totalAmount) - 0.01;
              const outstandingNum = Number(v.outstanding);
              return (
                <View key={v.id} style={styles.voucherBlock}>
                  <View style={styles.voucherRow}>
                    <ThemedText type="small" style={styles.flex1} numberOfLines={1}>{v.voucherNumber}</ThemedText>
                    <ThemedText type="small" style={styles.tabularNums}>{fmt(v.totalAmount)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{v.status}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">{fmtDate(v.voucherDate)}</ThemedText>
                  {creditedElsewhere.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {isFullyReturned ? 'Fully returned' : 'Partially returned'} — credit applied to {creditedElsewhere.map((dn) => dn.replacementPurchaseVoucher?.voucherNumber).join(', ')}
                    </ThemedText>
                  )}
                  {detail.ledger.partyType !== 'TRANSPORTER' && v.transporterName && (
                    <ThemedText type="small" themeColor="textSecondary">Transporter: {v.transporterName}</ThemedText>
                  )}
                  {v.purchaseOrder && (
                    <ThemedText type="small" themeColor="textSecondary">Linked Purchase: PO {v.purchaseOrder.id.slice(-6).toUpperCase()}</ThemedText>
                  )}
                  {v.allocations.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">Settled Via: {v.allocations.map((a) => a.paymentVoucher.voucherNumber).join(', ')}</ThemedText>
                  )}
                  {v.status === 'ACTIVE' && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Outstanding: {outstandingNum < 0
                        ? <ThemedText type="small" style={{ color: theme.primary }}>Over-credited by {fmt(Math.abs(outstandingNum))}</ThemedText>
                        : fmt(outstandingNum)}
                    </ThemedText>
                  )}
                  {v.status === 'ACTIVE' && (
                    <View style={styles.voucherActionsRow}>
                      {outstandingNum > 0 && detail.paymentVouchers.some((p) => p.voucherType === 'PAYMENT' && p.status !== 'CANCELLED' && Number(p.available) > 0) && (
                        <Pressable onPress={() => { setAllocatingPurchaseId(v.id); setAllocatePaymentId(null); setAllocateAmount(''); }}>
                          <ThemedText type="link">Allocate advance</ThemedText>
                        </Pressable>
                      )}
                      <Pressable onPress={() => setDebitNoteTarget(v)}>
                        <ThemedText type="link">Debit Note</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => setCancelTarget({ kind: 'purchase', id: v.id, label: v.voucherNumber })}>
                        <ThemedText type="small" style={styles.error}>Cancel voucher</ThemedText>
                      </Pressable>
                    </View>
                  )}
                  {allocatingPurchaseId === v.id && (
                    <View style={styles.cancelBlock}>
                      <ThemedText type="small" themeColor="textSecondary">Pick an advance to allocate</ThemedText>
                      <View style={styles.chipRow}>
                        {detail.paymentVouchers.filter((p) => p.voucherType === 'PAYMENT' && p.status !== 'CANCELLED' && Number(p.available) > 0).map((p) => (
                          <Pressable key={p.id} onPress={() => setAllocatePaymentId(p.id)} style={[styles.chip, { backgroundColor: allocatePaymentId === p.id ? theme.primary : theme.backgroundElement, borderColor: theme.border }]}>
                            <ThemedText type="small" style={allocatePaymentId === p.id ? styles.chipLabelActive : undefined}>
                              {p.voucherNumber} ({fmt(p.available)} left)
                            </ThemedText>
                          </Pressable>
                        ))}
                      </View>
                      {allocatePaymentId && (
                        <>
                          <TextInput
                            value={allocateAmount}
                            onChangeText={setAllocateAmount}
                            placeholder="Amount to allocate *"
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="decimal-pad"
                            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                          />
                          <View style={styles.voucherActionsRow}>
                            <Pressable onPress={onConfirmAllocate} disabled={isSaving || !allocateAmount.trim()}>
                              {isSaving ? <ActivityIndicator size="small" /> : <ThemedText type="link">Confirm allocation</ThemedText>}
                            </Pressable>
                            <Pressable onPress={() => { setAllocatingPurchaseId(null); setAllocatePaymentId(null); }}><ThemedText type="small" themeColor="textSecondary">Back</ThemedText></Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}

          <ThemedText type="smallBold" style={styles.fieldLabel}>Debit notes</ThemedText>
          {debitNoteRows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No debit notes yet.</ThemedText>
          ) : (
            debitNoteRows.map((dn) => (
              <View key={dn.id} style={styles.voucherBlock}>
                <View style={styles.voucherRow}>
                  <ThemedText type="small" style={styles.flex1} numberOfLines={1}>{dn.voucherNumber}</ThemedText>
                  <ThemedText type="small" style={styles.tabularNums}>{fmt(dn.totalAmount)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{dn.status}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">{fmtDate(dn.voucherDate)} · Against {dn.sourceVoucherNumber}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Credit applied to: {dn.replacementPurchaseVoucher?.voucherNumber ?? '— (same bill)'}
                </ThemedText>
                {dn.status === 'ACTIVE' && (
                  <Pressable onPress={() => setCancelTarget({ kind: 'debitNote', id: dn.id, label: dn.voucherNumber })}>
                    <ThemedText type="small" style={styles.error}>Cancel debit note</ThemedText>
                  </Pressable>
                )}
              </View>
            ))
          )}

          <ThemedText type="smallBold" style={styles.fieldLabel}>Payment vouchers</ThemedText>
          {detail.paymentVouchers.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">None yet.</ThemedText>
          ) : (
            detail.paymentVouchers.map((v) => (
              <View key={v.id} style={styles.voucherBlock}>
                <View style={styles.voucherRow}>
                  <ThemedText type="small" style={styles.flex1} numberOfLines={1}>{v.voucherNumber} ({v.voucherType})</ThemedText>
                  <ThemedText type="small" style={styles.tabularNums}>{fmt(v.totalAmount)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{v.status}</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">{fmtDate(v.voucherDate)}</ThemedText>
                {v.status !== 'CANCELLED' && (
                  <Pressable onPress={() => setCancelTarget({ kind: 'payment', id: v.id, label: `${v.voucherNumber} (${v.voucherType})` })}>
                    <ThemedText type="small" style={styles.error}>Cancel voucher</ThemedText>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </ScrollView>

        {showPurchaseModal && (
          <PurchaseVoucherModal
            ledgerId={detail.ledger.id}
            onClose={() => setShowPurchaseModal(false)}
            onDone={async () => { setShowPurchaseModal(false); await openLedger(detail.ledger.id); await load(); }}
            theme={theme}
          />
        )}
        {showPaymentModal && (
          <PaymentVoucherModal
            ledgerId={detail.ledger.id}
            purchaseVouchers={detail.purchaseVouchers}
            onClose={() => setShowPaymentModal(false)}
            onDone={async () => { setShowPaymentModal(false); await openLedger(detail.ledger.id); await load(); }}
            theme={theme}
          />
        )}
        {cancelTarget && (
          <VoucherCancelModal
            label={cancelTarget.label}
            onClose={() => setCancelTarget(null)}
            onConfirm={onConfirmCancelVoucher}
            theme={theme}
          />
        )}
        {debitNoteTarget && (
          <DebitNoteModal
            sourceVoucher={debitNoteTarget}
            replacementOptions={detail.purchaseVouchers.filter((pv) => pv.status === 'ACTIVE' && pv.id !== debitNoteTarget.id)}
            onClose={() => setDebitNoteTarget(null)}
            onDone={async () => { setDebitNoteTarget(null); await openLedger(detail.ledger.id); await load(); }}
            theme={theme}
          />
        )}
        {editingLedger && (
          <EditLedgerModal
            ledger={editingLedger}
            onClose={() => setEditingLedger(null)}
            onSaved={async () => { setEditingLedger(null); await openLedger(detail.ledger.id); await load(); }}
            theme={theme}
          />
        )}
        {statusModalLedger && (
          <DeactivateReactivateModal
            ledger={statusModalLedger}
            onClose={() => setStatusModalLedger(null)}
            onDone={async () => { setStatusModalLedger(null); await openLedger(detail.ledger.id); await load(); }}
            theme={theme}
          />
        )}
        {deleteModalLedger && (
          <DeleteLedgerModal
            ledger={deleteModalLedger}
            hasTransactions={hasTransactions}
            onClose={() => setDeleteModalLedger(null)}
            onDeleted={() => { setDeleteModalLedger(null); setDetail(null); load(); }}
            onDeactivateInstead={() => { setDeleteModalLedger(null); setStatusModalLedger(deleteModalLedger); }}
            theme={theme}
          />
        )}
      </KeyboardAvoidingView>
    );
  }

  const filteredLedgers = (ledgers ?? []).filter((l) => {
    if (showInactiveOnly && l.isActive) return false;
    if (partyTypeFilter && l.partyType !== partyTypeFilter) return false;
    if (search.trim() && !l.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <Stack.Screen options={{ title: 'Purchase — Ledgers' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {ledgers === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search ledgers"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border, borderWidth: 1 }]}
          />
          <View style={styles.filterRow}>
            <ChipRow
              options={[{ key: '', label: 'All' }, { key: 'SUPPLIER', label: 'Supplier' }, { key: 'TRANSPORTER', label: 'Transporter' }]}
              value={partyTypeFilter}
              onChange={setPartyTypeFilter}
              theme={theme}
            />
          </View>
          <Pressable onPress={() => setShowInactiveOnly((v) => !v)} style={styles.checkboxRow}>
            <View style={[styles.checkbox, { borderColor: theme.border, backgroundColor: showInactiveOnly ? theme.primary : 'transparent' }]}>
              {showInactiveOnly && <ThemedText style={styles.checkboxTick}>✓</ThemedText>}
            </View>
            <ThemedText type="small">Show inactive only</ThemedText>
          </Pressable>

          <View style={styles.topButtonsRow}>
            <Pressable onPress={onExportAll} disabled={exporting} style={[styles.secondaryButton, { borderColor: theme.border }]}>
              {exporting ? <ActivityIndicator size="small" /> : <ThemedText type="smallBold">Download All (CSV)</ThemedText>}
            </Pressable>
            <Pressable onPress={() => setShowTransporterModal(true)} style={[styles.secondaryButton, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">+ Transporter Payment</ThemedText>
            </Pressable>
          </View>
          <Pressable onPress={() => setShowNewLedger(true)} style={styles.newButton}>
            <ThemedText style={styles.buttonLabel}>+ New Ledger</ThemedText>
          </Pressable>
          {showTransporterModal && (
            <TransporterVoucherModal
              onClose={() => setShowTransporterModal(false)}
              onDone={() => { setShowTransporterModal(false); load(); }}
              theme={theme}
            />
          )}

          {filteredLedgers.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No ledgers match.</ThemedText>
          ) : (
            filteredLedgers.map((ledger) => (
              <Pressable key={ledger.id} onPress={() => openLedger(ledger.id)} disabled={loadingDetailId === ledger.id}>
                <ThemedView type="backgroundElement" style={styles.row}>
                  <View style={styles.flex1}>
                    <ThemedText type="smallBold">{ledger.name}</ThemedText>
                    <View style={styles.badgeRow}>
                      {ledger.partyType === 'TRANSPORTER' && <View style={[styles.badgeSmall, { borderColor: theme.border }]}><ThemedText type="small">Transporter</ThemedText></View>}
                      {ledger.partyType === 'SUPPLIER' && <View style={[styles.badgeSmall, { borderColor: theme.border }]}><ThemedText type="small">Supplier</ThemedText></View>}
                      {!ledger.isActive && <View style={[styles.badgeSmall, { borderColor: theme.border }]}><ThemedText type="small" style={styles.error}>Inactive</ThemedText></View>}
                    </View>
                  </View>
                  {loadingDetailId === ledger.id ? (
                    <ActivityIndicator />
                  ) : (
                    ledger.balance != null && (
                      <ThemedText type="small" style={[styles.tabularNums, { color: Number(ledger.balance) < 0 ? theme.danger : theme.text }]}>
                        {fmt(ledger.balance)}
                      </ThemedText>
                    )
                  )}
                </ThemedView>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: 0, marginTop: 0 },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  multiline: { height: 80, textAlignVertical: 'top', paddingTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.three },
  fieldGroup: { marginTop: Spacing.two },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  button: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  white: { color: '#ffffff' },
  actionTabs: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.three },
  actionTab: { flex: 1, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  actionTabLabelActive: { color: '#ffffff', fontWeight: '600' },
  actionCard: { marginTop: Spacing.three, gap: Spacing.two },
  chipRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999, borderWidth: 1 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  lineItemCard: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one },
  lineItemRow: { flexDirection: 'row', gap: Spacing.one, alignItems: 'center' },
  qtyInput: { width: 70 },
  removeButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(184,48,48,0.15)' },
  removeButtonLabel: { color: '#B83030', fontWeight: '700' },
  addLineButton: { alignSelf: 'flex-start' },
  voucherRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.half },
  voucherBlock: { gap: Spacing.half, paddingVertical: Spacing.half, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
  voucherActionsRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  cancelBlock: { gap: Spacing.one, marginTop: Spacing.half },
  ledgerActionsRow: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.one },
  badgeRow: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.half, flexWrap: 'wrap' },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  badgeSmall: { paddingHorizontal: Spacing.one, paddingVertical: 1, borderRadius: 999, borderWidth: 1 },
  filterRow: { marginTop: Spacing.two },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two, minHeight: Layout.minTouchTarget },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkboxTick: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  topButtonsRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two, marginBottom: Spacing.two },
  secondaryButton: { flex: 1, height: 44, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  backLink: { padding: Spacing.three },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetScroll: { padding: Spacing.three, gap: Spacing.one },
  modalBody: { lineHeight: 20 },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  helperText: { marginTop: Spacing.half },
  dateInput: { justifyContent: 'center' },
  actionButton: { flex: 1, height: 46, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
});
