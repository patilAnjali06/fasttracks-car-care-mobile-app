import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createInvoice, fetchInvoice, fetchInvoices, generateInvoiceWaybill, getErrorMessage, markInvoicePaid,
  recordInvoicePayment, sendInvoiceEmail, sendInvoiceWhatsapp,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import type { InvoiceDetail, InvoiceLineItemInput, InvoiceListItem, InvoiceStatus } from '@/types/api';

// GET /invoices — gated by getInvoiceMode (backend/src/routes/
// invoiceRoutes.ts), NOT a static role list: ADMIN_ROLES=[OWNER,
// STORE_MANAGER,ACCOUNTING] always get 'full_access' (see every invoice);
// any other role can ALSO see it if an admin has granted the dynamic
// 'invoices' tab permission (getTabAccess), in which case they see only
// their own created invoices. Same pattern as CRM's customers_jobs
// permission (verified 2026-09-19). Because access isn't predictable from
// role alone, this screen is NOT hidden by visibleToRoles in the registry —
// like the existing customers/tasks entries, it's left visible and the
// screen itself handles a 403 via getErrorMessage.
//
// Create/mark-paid/send-whatsapp added 2026-09-23 (scope update: full
// dashboard parity, not read-only). Create sends raw line items only —
// backend computes GST/totals server-side via calculateAmounts() when
// manualAmounts is omitted (verified by reading invoiceRoutes.ts POST /),
// so mobile never replicates that calc. customerEmail/Address/GSTIN and
// vehicle brand/model/year/colour added 2026-09-24 (plain text fields,
// straightforward). Still deliberately out of scope: job-card linking
// (needs a job picker UI — the mobile job-card list isn't tied to a
// customer-search flow from this screen yet) and the line-item-less
// ADVANCE invoice type, same call already made for quotations' create form.
// Mark-paid/send-whatsapp gated the same way invoice_actions_route.ts
// gates them: ADMIN_ROLES=[OWNER,STORE_MANAGER] OR an explicit 'invoices'
// permission override, AND mode !== 'view_only' for the write actions
// specifically (view_only can read but not act) — mirrored client-side via
// usePermissions().tabMode('invoices'), the same resolved value the
// backend's own getTabAccess produces, not a re-implemented role list.
// Send-to-customer is opt-in only (a checkbox the caller must tick before
// the button becomes active) — matches the dashboard's own 2026-09-22 fix
// (fix/invoice-send-checkbox-gating) for the exact same action having
// fired unconditionally before.
// CORRECTED 2026-09-28 (re-verification sweep): waybill and email were
// previously lumped in with "PDF/print, out of scope" — wrong, neither
// involves a PDF. Waybill (POST /:id/generate-waybill) just returns/persists
// a waybill number string (Shiprocket attempt, placeholder fallback); Email
// (POST /:id/send-email) sends the existing invoice HTML via SMTP. Both
// added below. Print itself (window.open on a dashboard-only /print page,
// no equivalent screen on mobile) and the full line-item edit wizard remain
// genuinely out of scope — same call already made for quotations' wizard.
const PAGE_SIZE = 20;

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function statusColor(status: InvoiceStatus) {
  if (status === 'PAID') return '#167A48';
  if (status === 'CANCELLED') return '#8A8A8E';
  if (status === 'OVERDUE') return '#B83030';
  return '#A86018';
}

// Verbatim from the dashboard's STATUS_META (frontend/src/app/(dashboard)/
// dashboard/invoices/page.tsx), field-level parity pass 2026-09-25.
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ISSUED: 'Issued',
  PAID: 'Paid',
  PARTIAL: 'Partially Paid',
  CANCELLED: 'Cancelled',
  OVERDUE: 'Overdue',
};

// The dashboard's Collect Payment panel (InvoiceViewModal) offers exactly
// these three — Cash/UPI/Card, Title Case, no "Online" option there.
const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
];

function emptyLineItem(): InvoiceLineItemInput {
  return { description: '', quantity: 1, unitPrice: 0 };
}

export default function InvoicesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  useAuth();
  const { tabMode } = usePermissions();
  const invoicesMode = tabMode('invoices');
  const canWrite = invoicesMode !== null && invoicesMode !== 'view_only';

  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Mark-paid
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  // Record a partial/custom-amount payment — distinct from mark-paid
  // (which always pays the full balance). Dashboard's own list page uses
  // this same POST /payments/record for exactly this.
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  // Send-to-customer
  const [confirmSend, setConfirmSend] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingWaybill, setIsGeneratingWaybill] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerGSTIN, setCustomerGSTIN] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleColour, setVehicleColour] = useState('');
  const [lineItems, setLineItems] = useState<InvoiceLineItemInput[]>([emptyLineItem()]);
  const [notes, setNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setListError(null);
    try {
      setInvoices(await fetchInvoices(s || undefined));
    } catch (err: any) {
      // Money screen: a failed fetch must never leave the list looking
      // like "no invoices" — keep whatever was last shown and show a
      // persistent, retryable error instead of a fabricated empty array.
      setListError(getErrorMessage(err, 'Could not load invoices.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load(search);
  }, [load, search]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load(search);
    setIsRefreshing(false);
  };

  const openDetail = async (id: string) => {
    setDetailError(null);
    setSendNotice(null);
    setConfirmSend(false);
    setLoadingDetailId(id);
    try {
      setDetail(await fetchInvoice(id));
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not load invoice detail.'));
    } finally {
      setLoadingDetailId(null);
    }
  };

  const onMarkPaid = () => {
    if (!detail) return;
    Alert.alert('Mark as paid', `Mark ${detail.invoiceNumber} (${formatCurrency(detail.balanceDue)} due) as fully paid?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark paid',
        onPress: async () => {
          setIsMarkingPaid(true);
          setDetailError(null);
          try {
            await markInvoicePaid(detail.id, paymentMethod);
            // Re-fetch so the detail view always has the same shape as
            // GET /invoices/:id — same as the dashboard does after actions.
            setDetail(await fetchInvoice(detail.id));
            await load(search);
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not mark this invoice as paid.'));
          } finally {
            setIsMarkingPaid(false);
          }
        },
      },
    ]);
  };

  const onRecordPayment = async () => {
    if (!detail) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setDetailError('Enter a valid payment amount.');
      return;
    }
    if (amount > detail.balanceDue) {
      setDetailError(`Amount can't exceed the balance due (${formatCurrency(detail.balanceDue)}).`);
      return;
    }
    setIsRecordingPayment(true);
    setDetailError(null);
    try {
      await recordInvoicePayment(detail.id, amount, paymentMethod);
      // POST /payments/record returns only { status, paidAmount, balanceDue,
      // isFullyPaid } — not the invoice — so re-fetch the full detail.
      setDetail(await fetchInvoice(detail.id));
      setPaymentAmount('');
      await load(search);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not record this payment.'));
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const onSendWhatsapp = async () => {
    if (!detail || !confirmSend) return;
    setIsSending(true);
    setDetailError(null);
    setSendNotice(null);
    try {
      await sendInvoiceWhatsapp(detail.id);
      setSendNotice('Sent to the customer on WhatsApp.');
      setConfirmSend(false);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not send this invoice.'));
    } finally {
      setIsSending(false);
    }
  };

  const onGenerateWaybill = async () => {
    if (!detail) return;
    setIsGeneratingWaybill(true);
    setDetailError(null);
    setSendNotice(null);
    try {
      const result = await generateInvoiceWaybill(detail.id);
      setDetail((prev) => (prev ? { ...prev, waybillNo: result.waybillNo } : prev));
      setSendNotice(`Waybill: ${result.waybillNo}`);
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not generate a waybill.'));
    } finally {
      setIsGeneratingWaybill(false);
    }
  };

  const onSendEmail = async () => {
    if (!detail) return;
    setIsSendingEmail(true);
    setDetailError(null);
    setSendNotice(null);
    try {
      await sendInvoiceEmail(detail.id);
      setDetail((prev) => (prev ? { ...prev, emailSent: true } : prev));
      setSendNotice('Invoice emailed to customer.');
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not send this invoice by email.'));
    } finally {
      setIsSendingEmail(false);
    }
  };

  const updateLineItem = (index: number, patch: Partial<InvoiceLineItemInput>) => {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  };

  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()]);
  const removeLineItem = (index: number) => setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const resetCreateForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerAddress('');
    setCustomerGSTIN('');
    setVehicleNumber('');
    setVehicleBrand('');
    setVehicleModel('');
    setVehicleYear('');
    setVehicleColour('');
    setLineItems([emptyLineItem()]);
    setNotes('');
    setCreateError(null);
  };

  const onCreate = async () => {
    if (!customerName.trim()) {
      setCreateError('Customer name is required.');
      return;
    }
    const validLines = lineItems.filter((li) => li.description.trim() && li.unitPrice > 0);
    if (validLines.length === 0) {
      setCreateError(lineItems.every((li) => !li.description.trim()) ? 'Add at least one line item.' : 'At least one line item needs a description.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      await createInvoice({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        customerGSTIN: customerGSTIN.trim() || undefined,
        vehicleNumber: vehicleNumber.trim() || undefined,
        vehicleBrand: vehicleBrand.trim() || undefined,
        vehicleModel: vehicleModel.trim() || undefined,
        vehicleYear: vehicleYear.trim() || undefined,
        vehicleColour: vehicleColour.trim() || undefined,
        lineItems: validLines,
        notes: notes.trim() || undefined,
      });
      resetCreateForm();
      setShowCreate(false);
      await load(search);
    } catch (err: any) {
      setCreateError(getErrorMessage(err, 'Could not create the invoice.'));
    } finally {
      setIsCreating(false);
    }
  };

  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);

  if (showCreate) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'New Invoice' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowCreate(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>

          <TextInput
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Customer name *"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={customerPhone}
            onChangeText={setCustomerPhone}
            placeholder="Customer phone"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={customerEmail}
            onChangeText={setCustomerEmail}
            placeholder="Customer email (optional)"
            placeholderTextColor={theme.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={customerAddress}
            onChangeText={setCustomerAddress}
            placeholder="Customer address (optional)"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={customerGSTIN}
            onChangeText={setCustomerGSTIN}
            placeholder="Customer GSTIN (optional)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholder="Vehicle number"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <View style={styles.lineItemRow}>
            <TextInput
              value={vehicleBrand}
              onChangeText={setVehicleBrand}
              placeholder="Brand"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TextInput
              value={vehicleModel}
              onChangeText={setVehicleModel}
              placeholder="Model"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
          </View>
          <View style={styles.lineItemRow}>
            <TextInput
              value={vehicleYear}
              onChangeText={setVehicleYear}
              placeholder="Year"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TextInput
              value={vehicleColour}
              onChangeText={setVehicleColour}
              placeholder="Colour"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
          </View>

          <ThemedText type="smallBold" style={styles.fieldLabel}>Line items</ThemedText>
          {lineItems.map((li, i) => (
            <ThemedView key={i} type="backgroundElement" style={styles.lineItemCard}>
              <TextInput
                value={li.description}
                onChangeText={(t) => updateLineItem(i, { description: t })}
                placeholder="Description"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <View style={styles.lineItemRow}>
                <TextInput
                  value={li.quantity ? String(li.quantity) : ''}
                  onChangeText={(t) => updateLineItem(i, { quantity: Number(t) || 0 })}
                  placeholder="Qty"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.qtyInput, { color: theme.text, backgroundColor: theme.background }]}
                />
                <TextInput
                  value={li.unitPrice ? String(li.unitPrice) : ''}
                  onChangeText={(t) => updateLineItem(i, { unitPrice: Number(t) || 0 })}
                  placeholder="Unit price"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                />
                {lineItems.length > 1 && (
                  <Pressable onPress={() => removeLineItem(i)} accessibilityLabel="Remove this line item" style={styles.removeButton}>
                    <ThemedText style={styles.removeButtonLabel}>✕</ThemedText>
                  </Pressable>
                )}
              </View>
            </ThemedView>
          ))}
          <Pressable onPress={addLineItem} style={styles.addLineButton}>
            <ThemedText type="small">+ Add line item</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
            Lines total (before GST): {formatCurrency(lineItemsTotal)}
          </ThemedText>

          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, styles.fieldLabel, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            GST (18%) and grand total are calculated by the server on save.
          </ThemedText>

          {createError && <ThemedText style={styles.error}>{createError}</ThemedText>}

          <Pressable onPress={onCreate} disabled={isCreating} style={styles.button}>
            {isCreating ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Create Invoice</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Sales Invoices' }} />
      {!detail && (
        <ThemedView style={styles.searchWrap}>
          <TextInput
            value={search}
            onChangeText={(t) => { setSearch(t); setVisibleCount(PAGE_SIZE); }}
            placeholder="Search invoice #, customer, vehicle"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          {canWrite && (
            <Pressable onPress={() => setShowCreate(true)} style={styles.newButton}>
              <ThemedText style={styles.buttonLabel}>+ New Invoice</ThemedText>
            </Pressable>
          )}
        </ThemedView>
      )}

      {detail ? (
        <ScrollView contentContainerStyle={[styles.detailWrap, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => { setDetail(null); setDetailError(null); }}><ThemedText type="small">← Back to list</ThemedText></Pressable>
          <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>{detail.invoiceNumber}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{detail.customerName} · {detail.customerPhone ?? '—'}</ThemedText>
          {detail.vehicleNumber && <ThemedText type="small" themeColor="textSecondary">Vehicle: {detail.vehicleNumber}</ThemedText>}
          <View style={styles.divider} />
          <ThemedText type="small" style={styles.tabularNums}>Subtotal: {formatCurrency(detail.subtotal)}</ThemedText>
          <ThemedText type="small" style={styles.tabularNums}>CGST: {formatCurrency(detail.cgst)} · SGST: {formatCurrency(detail.sgst)}</ThemedText>
          <ThemedText type="smallBold" style={styles.tabularNums}>Grand Total: {formatCurrency(detail.grandTotal)}</ThemedText>
          <ThemedText type="small" style={styles.tabularNums}>Total Paid: {formatCurrency(detail.paidAmount)} · Balance Due: {formatCurrency(detail.balanceDue)}</ThemedText>
          <ThemedText type="small" style={{ color: statusColor(detail.status) }}>{STATUS_LABEL[detail.status] ?? detail.status}</ThemedText>
          {detail.paymentMode && <ThemedText type="small" themeColor="textSecondary">Payment: {detail.paymentMode} {detail.paymentRef ? `(${detail.paymentRef})` : ''}</ThemedText>}
          {detail.notes && <ThemedText type="small" themeColor="textSecondary">{detail.notes}</ThemedText>}
          {detailError && <ThemedText style={styles.error}>{detailError}</ThemedText>}
          {sendNotice && <ThemedText style={styles.notice}>{sendNotice}</ThemedText>}

          {canWrite && detail.status !== 'PAID' && detail.status !== 'CANCELLED' && detail.balanceDue > 0 && (
            <View style={styles.actionBlock}>
              <ThemedText type="smallBold">Collect Payment</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Outstanding: {formatCurrency(detail.balanceDue)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Payment Method</ThemedText>
              <View style={styles.chipRow}>
                {PAYMENT_METHODS.map((m) => (
                  <Pressable
                    key={m.value}
                    onPress={() => setPaymentMethod(m.value)}
                    style={[styles.chip, { backgroundColor: paymentMethod === m.value ? theme.primary : theme.backgroundElement }]}>
                    <ThemedText type="small" style={paymentMethod === m.value ? styles.chipLabelActive : undefined}>{m.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Amount (₹)</ThemedText>
              <TextInput
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                placeholder="Enter amount"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onRecordPayment} disabled={isRecordingPayment} style={styles.button}>
                {isRecordingPayment ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Record Partial Payment</ThemedText>}
              </Pressable>
              <Pressable onPress={onMarkPaid} disabled={isMarkingPaid} style={[styles.button, styles.buttonSecondary]}>
                {isMarkingPaid ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>✓ Collect Payment</ThemedText>}
              </Pressable>
            </View>
          )}

          {canWrite && detail.customerPhone && (
            <View style={styles.actionBlock}>
              <View style={styles.checkboxRow}>
                <Switch value={confirmSend} onValueChange={setConfirmSend} accessibilityLabel="Confirm sending this invoice to the customer on WhatsApp" />
                <ThemedText type="small" style={styles.flex1}>Send this invoice to the customer on WhatsApp</ThemedText>
              </View>
              <Pressable
                onPress={onSendWhatsapp}
                disabled={!confirmSend || isSending}
                style={[styles.button, { opacity: confirmSend ? 1 : 0.5 }]}
              >
                {isSending ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>WhatsApp</ThemedText>}
              </Pressable>
            </View>
          )}

          {canWrite && (
            <View style={styles.actionBlock}>
              {detail.waybillNo && <ThemedText type="small" themeColor="textSecondary">Waybill: {detail.waybillNo}</ThemedText>}
              <Pressable onPress={onGenerateWaybill} disabled={isGeneratingWaybill} style={[styles.button, styles.buttonSecondary]}>
                {isGeneratingWaybill ? <ActivityIndicator /> : <ThemedText style={styles.buttonLabel}>{detail.waybillNo ? 'Regenerate Waybill' : 'Generate Waybill'}</ThemedText>}
              </Pressable>
            </View>
          )}

          {canWrite && detail.customerEmail && (
            <View style={styles.actionBlock}>
              <Pressable onPress={onSendEmail} disabled={isSendingEmail} style={[styles.button, styles.buttonSecondary]}>
                {isSendingEmail ? <ActivityIndicator /> : <ThemedText style={styles.buttonLabel}>{detail.emailSent ? 'Re-send Email' : 'Send Email'}</ThemedText>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      ) : invoices === null ? (
        listError ? (
          <View style={styles.errorBlock}>
            <ThemedText style={styles.error}>{listError}</ThemedText>
            <Pressable onPress={() => load(search)} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator style={styles.spinner} />
        )
      ) : listError ? (
        <View style={styles.errorBlock}>
          <ThemedText style={styles.error}>{listError}</ThemedText>
          <Pressable onPress={() => load(search)} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={invoices.slice(0, visibleCount)}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, invoices.length))}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No invoices.</ThemedText>}
          renderItem={({ item }) => (
            <Pressable onPress={() => openDetail(item.id)} disabled={loadingDetailId === item.id}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{item.invoiceNumber} · {item.customerName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{formatCurrency(item.grandTotal)} · Balance {formatCurrency(item.balanceDue)}</ThemedText>
                </View>
                {loadingDetailId === item.id ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedText type="small" style={{ color: statusColor(item.status) }}>{STATUS_LABEL[item.status] ?? item.status}</ThemedText>
                )}
              </ThemedView>
            </Pressable>
          )}
          ListFooterComponent={visibleCount < invoices.length ? <ActivityIndicator style={styles.spinner} /> : null}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  searchWrap: { padding: Spacing.three, paddingBottom: 0, gap: Spacing.two },
  detailWrap: { padding: Spacing.three, gap: Spacing.one, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  fieldLabel: { marginTop: Spacing.two },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  notice: { color: '#167A48' },
  errorBlock: { marginTop: Spacing.three, gap: Spacing.two, alignItems: 'flex-start', paddingHorizontal: Spacing.three },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(120,120,140,0.3)', marginVertical: Spacing.two },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  button: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: 'rgba(127,127,127,0.35)' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  lineItemCard: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one, marginTop: Spacing.one },
  lineItemRow: { flexDirection: 'row', gap: Spacing.one, alignItems: 'center' },
  qtyInput: { width: 70 },
  removeButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(184,48,48,0.15)' },
  removeButtonLabel: { color: '#B83030', fontWeight: '700' },
  addLineButton: { marginTop: Spacing.one, alignSelf: 'flex-start' },
  actionBlock: { marginTop: Spacing.four, gap: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(120,120,140,0.3)', paddingTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
