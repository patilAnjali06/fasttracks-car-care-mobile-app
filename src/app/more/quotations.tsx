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
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cancelQuotation, createQuotation, deleteQuotation, fetchQuotation, fetchQuotations, getErrorMessage, updateQuotation } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { QuotationDetail, QuotationLineItemInput, QuotationListItem, QuotationStatus } from '@/types/api';

// GET/GET :id — access via canAccessQuotations (backend/src/routes/
// quotationRoutes.ts): ADMIN_ROLES=[OWNER,STORE_MANAGER,ACCOUNTING] always
// see everything; any other role needs an explicit per-employee
// 'quotations' permission override (getTabAccess, same mechanism as every
// other dynamically-granted tab), in which case they see only their own
// created quotations. Not predictable from role alone — same reasoning as
// invoices.tsx, so this screen is left visible in the registry (no
// visibleToRoles) and a denied fetch surfaces as a normal error via
// getErrorMessage rather than being hidden client-side.
//
// Create/edit added 2026-09-23 (scope update: full dashboard parity).
// Client sends raw line items only — backend computes GST/totals via
// calculateAmounts() server-side (verified by reading quotationRoutes.ts
// POST/PUT), mirroring invoices.tsx's create form exactly. Job-card/CRM
// linking and per-line inventory GST rates (the manualAmounts wizard path)
// are out of scope, same cut already made for invoices. PUT /:id is
// ADMIN_ROLES OR the quotation's own creator (verified by reading the
// route) — mirrored client-side below via detail.createdBy.id === user.id.
// Cancel (PATCH /:id/cancel → REJECTED) stays ADMIN_ROLES-only, unchanged
// from the read-only pass.
//
// Delete (DELETE /:id, ADMIN_ROLES-only, hard delete) and Print/Share added
// 2026-09-24 (full-parity pass). "Print" has no PDF-generation backend at
// all — the dashboard's print view is pure client-side HTML + window.
// print() — so this shares a formatted text summary via React Native's
// built-in Share sheet instead (the OS's own print/save-as-PDF from
// there), not a fabricated document. Vehicle/GST phone-lookup autofill
// (also named in the parity plan) does NOT exist on the dashboard for
// quotations either — confirmed by reading quotations/new/page.tsx, which
// only has GST-number verification, unrelated to phone-based autofill — so
// it's not a mobile gap and wasn't built.
const ADMIN_ROLES = ['OWNER', 'STORE_MANAGER', 'ACCOUNTING'];
const PAGE_SIZE = 20;

function formatCurrency(n: number) {
  return `₹${n.toLocaleString('en-IN')}`;
}

function statusColor(status: QuotationStatus) {
  if (status === 'ACCEPTED') return '#167A48';
  if (status === 'REJECTED' || status === 'EXPIRED') return '#8A8A8E';
  if (status === 'SENT') return '#A86018';
  return '#5A6B8C';
}

// Verbatim from the dashboard's STATUS_META (frontend/src/app/(dashboard)/
// dashboard/quotations/page.tsx), field-level parity pass 2026-09-25.
const STATUS_LABEL: Record<QuotationStatus, string> = {
  DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired',
};
const STATUS_OPTIONS: QuotationStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

function emptyLineItem(): QuotationLineItemInput {
  return { description: '', quantity: 1, unitPrice: 0 };
}

export default function QuotationsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(user?.role ?? '');

  const [quotations, setQuotations] = useState<QuotationListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Create/edit form (shared — editingId null means "creating new")
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
  const [lineItems, setLineItems] = useState<QuotationLineItemInput[]>([emptyLineItem()]);
  const [status, setStatus] = useState<QuotationStatus>('DRAFT');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setListError(null);
    try {
      setQuotations(await fetchQuotations(s || undefined));
    } catch (err: any) {
      // Money screen: a failed fetch must never leave the list looking like
      // "no quotations" — keep whatever was last shown (or null) and show a
      // persistent, retryable error instead of a fabricated empty array.
      setListError(getErrorMessage(err, 'Could not load quotations.'));
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
    setLoadingDetailId(id);
    try {
      setDetail(await fetchQuotation(id));
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not load quotation detail.'));
    } finally {
      setLoadingDetailId(null);
    }
  };

  const onCancel = () => {
    if (!detail) return;
    Alert.alert('Cancel quotation', `Cancel ${detail.quotationNumber}? This cannot be undone.`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel it',
        style: 'destructive',
        onPress: async () => {
          setIsCancelling(true);
          setDetailError(null);
          try {
            const updated = await cancelQuotation(detail.id);
            setDetail(updated);
            await load(search);
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not cancel the quotation.'));
          } finally {
            setIsCancelling(false);
          }
        },
      },
    ]);
  };

  const onDelete = () => {
    if (!detail) return;
    Alert.alert('Delete quotation', `Delete ${detail.quotationNumber}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          setDetailError(null);
          try {
            await deleteQuotation(detail.id);
            setDetail(null);
            await load(search);
          } catch (err: any) {
            setDetailError(getErrorMessage(err, 'Could not delete the quotation.'));
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  };

  // No PDF-generation endpoint exists — the dashboard's "print" is pure
  // client-side HTML + window.print(), so this shares a formatted text
  // version via the OS share sheet (print/save-as-PDF/etc. from there)
  // rather than a fabricated document.
  const onPrint = async () => {
    if (!detail) return;
    const lines = detail.lineItems
      .map((li) => `${li.description}${li.quantity !== 1 ? ` x${li.quantity}` : ''} — ${formatCurrency(li.amount)}`)
      .join('\n');
    const message = [
      detail.quotationNumber,
      detail.customerName + (detail.customerPhone ? ` · ${detail.customerPhone}` : ''),
      detail.vehicleNumber ? `Vehicle: ${detail.vehicleNumber}` : null,
      '',
      lines,
      '',
      `Subtotal: ${formatCurrency(detail.subtotal)}`,
      `CGST: ${formatCurrency(detail.cgst)} · SGST: ${formatCurrency(detail.sgst)}`,
      `Grand Total: ${formatCurrency(detail.grandTotal)}`,
      detail.notes ? `\n${detail.notes}` : null,
    ].filter(Boolean).join('\n');
    try {
      await Share.share({ message, title: detail.quotationNumber });
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not share this quotation.'));
    }
  };

  const resetForm = () => {
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
    setStatus('DRAFT');
    setValidUntil('');
    setNotes('');
    setTermsConditions('');
    setFormError(null);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = () => {
    if (!detail) return;
    setCustomerName(detail.customerName);
    setCustomerPhone(detail.customerPhone ?? '');
    setCustomerEmail(detail.customerEmail ?? '');
    setCustomerAddress(detail.customerAddress ?? '');
    setCustomerGSTIN(detail.customerGSTIN ?? '');
    setVehicleNumber(detail.vehicleNumber ?? '');
    setVehicleBrand(detail.vehicleBrand ?? '');
    setVehicleModel(detail.vehicleModel ?? '');
    setVehicleYear(detail.vehicleYear ?? '');
    setVehicleColour(detail.vehicleColour ?? '');
    setLineItems(
      detail.lineItems.length > 0
        ? detail.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            discountAmount: li.discountAmount,
            discountMode: li.discountMode === 'FIXED' ? 'FIXED' : 'PERCENT',
          }))
        : [emptyLineItem()]
    );
    setStatus(detail.status);
    setValidUntil(detail.validUntil ? detail.validUntil.slice(0, 10) : '');
    setNotes(detail.notes ?? '');
    setTermsConditions(detail.termsConditions ?? '');
    setFormError(null);
    setEditingId(detail.id);
    setShowForm(true);
  };

  const updateLineItem = (index: number, patch: Partial<QuotationLineItemInput>) => {
    setLineItems((prev) => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  };
  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()]);
  const removeLineItem = (index: number) => setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const onSave = async () => {
    if (!customerName.trim()) {
      setFormError('Customer name is required.');
      return;
    }
    const validLines = lineItems.filter((li) => li.description.trim() && li.unitPrice > 0);
    if (validLines.length === 0) {
      setFormError(lineItems.every((li) => !li.description.trim()) ? 'Add at least one line item.' : 'At least one line item needs a description.');
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const payload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        customerGSTIN: customerGSTIN.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        vehicleNumber: vehicleNumber.trim() || undefined,
        vehicleBrand: vehicleBrand.trim() || undefined,
        vehicleModel: vehicleModel.trim() || undefined,
        vehicleColour: vehicleColour.trim() || undefined,
        vehicleYear: vehicleYear.trim() || undefined,
        lineItems: validLines,
        validUntil: validUntil.trim() || undefined,
        notes: notes.trim() || undefined,
        termsConditions: termsConditions.trim() || undefined,
      };
      if (editingId) {
        const updated = await updateQuotation(editingId, { ...payload, status });
        setDetail(updated);
      } else {
        await createQuotation(payload);
      }
      setShowForm(false);
      resetForm();
      await load(search);
    } catch (err: any) {
      setFormError(getErrorMessage(err, 'Failed to save quotation.'));
    } finally {
      setIsSaving(false);
    }
  };

  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const canEditThis = !!detail && (isAdmin || detail.createdBy.id === user?.id);

  if (showForm) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: editingId ? `Edit Quotation ${detail?.quotationNumber ?? ''}` : 'New Quotation' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => { setShowForm(false); resetForm(); }}><ThemedText type="small">← Cancel</ThemedText></Pressable>

          <ThemedText type="small" themeColor="textSecondary">Customer Name *</ThemedText>
          <TextInput
            value={customerName}
            onChangeText={setCustomerName}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">Phone</ThemedText>
          <TextInput
            value={customerPhone}
            onChangeText={setCustomerPhone}
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">Email</ThemedText>
          <TextInput
            value={customerEmail}
            onChangeText={setCustomerEmail}
            placeholderTextColor={theme.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">GSTIN</ThemedText>
          <TextInput
            value={customerGSTIN}
            onChangeText={setCustomerGSTIN}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">Address</ThemedText>
          <TextInput
            value={customerAddress}
            onChangeText={setCustomerAddress}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Vehicle No.</ThemedText>
          <TextInput
            value={vehicleNumber}
            onChangeText={setVehicleNumber}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <View style={styles.lineItemRow}>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary">Brand</ThemedText>
              <TextInput
                value={vehicleBrand}
                onChangeText={setVehicleBrand}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary">Model</ThemedText>
              <TextInput
                value={vehicleModel}
                onChangeText={setVehicleModel}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>
          </View>
          <View style={styles.lineItemRow}>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary">Colour</ThemedText>
              <TextInput
                value={vehicleColour}
                onChangeText={setVehicleColour}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>
            <View style={styles.flex1}>
              <ThemedText type="small" themeColor="textSecondary">Year</ThemedText>
              <TextInput
                value={vehicleYear}
                onChangeText={setVehicleYear}
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>
          </View>

          <ThemedText type="smallBold" style={styles.fieldLabel}>Line Items</ThemedText>
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

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Valid Until</ThemedText>
          <TextInput
            value={validUntil}
            onChangeText={setValidUntil}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          {editingId && (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Status</ThemedText>
              <View style={styles.chipRow}>
                {STATUS_OPTIONS.map((s) => (
                  <Pressable key={s} onPress={() => setStatus(s)} style={[styles.chip, { backgroundColor: status === s ? theme.primary : theme.backgroundElement }]}>
                    <ThemedText type="small" style={status === s ? styles.chipLabelActive : undefined}>{STATUS_LABEL[s]}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes</ThemedText>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Terms &amp; Conditions</ThemedText>
          <TextInput
            value={termsConditions}
            onChangeText={setTermsConditions}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            GST (18%) and grand total are calculated by the server on save.
          </ThemedText>

          {formError && <ThemedText style={styles.error}>{formError}</ThemedText>}

          <Pressable onPress={onSave} disabled={isSaving} style={styles.saveButton}>
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.cancelButtonLabel}>{isSaving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Quotation'}</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Quotations' }} />
      {!detail && (
        <ThemedView style={styles.searchWrap}>
          <TextInput
            value={search}
            onChangeText={(t) => { setSearch(t); setVisibleCount(PAGE_SIZE); }}
            placeholder="Search by number, customer, phone, vehicle…"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            returnKeyType="search"
          />
          <Pressable onPress={openCreate} style={styles.newButton}>
            <ThemedText style={styles.cancelButtonLabel}>+ New Quotation</ThemedText>
          </Pressable>
        </ThemedView>
      )}

      {detail ? (
        <View style={[styles.detailWrap, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => { setDetail(null); setDetailError(null); }}>
            <ThemedText type="small">← Back to list</ThemedText>
          </Pressable>
          <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>{detail.quotationNumber}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Customer: {detail.customerName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Phone: {detail.customerPhone ?? '—'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Vehicle: {[detail.vehicleBrand, detail.vehicleModel].filter(Boolean).join(' ') || '—'}{detail.vehicleNumber ? ` (${detail.vehicleNumber})` : ''}
          </ThemedText>
          <View style={styles.divider} />
          {detail.lineItems.map((li) => (
            <View key={li.id} style={styles.lineItemRow}>
              <ThemedText type="small" style={styles.flex1} numberOfLines={2} ellipsizeMode="tail">
                {li.description} {li.quantity !== 1 ? `× ${li.quantity}` : ''}
              </ThemedText>
              <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(li.amount)}</ThemedText>
            </View>
          ))}
          <View style={styles.divider} />
          <ThemedText type="small" style={styles.tabularNums}>Subtotal: {formatCurrency(detail.subtotal)}</ThemedText>
          <ThemedText type="small" style={styles.tabularNums}>CGST: {formatCurrency(detail.cgst)} · SGST: {formatCurrency(detail.sgst)}</ThemedText>
          <ThemedText type="smallBold" style={styles.tabularNums}>Grand Total: {formatCurrency(detail.grandTotal)}</ThemedText>
          <ThemedText type="small" style={{ color: statusColor(detail.status) }}>{STATUS_LABEL[detail.status]}</ThemedText>
          {detail.validUntil && (
            <ThemedText type="small" themeColor="textSecondary">
              Valid Until: {new Date(detail.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </ThemedText>
          )}
          {detail.notes && <ThemedText type="small" themeColor="textSecondary">{detail.notes}</ThemedText>}
          {detailError && <ThemedText style={styles.error}>{detailError}</ThemedText>}

          <View style={styles.actionRow}>
            {canEditThis && detail.status !== 'REJECTED' && detail.status !== 'EXPIRED' && (
              <Pressable onPress={openEdit} style={[styles.saveButton, styles.flex1]}>
                <ThemedText style={styles.cancelButtonLabel}>Edit</ThemedText>
              </Pressable>
            )}
            <Pressable onPress={onPrint} style={[styles.saveButton, styles.flex1, styles.printButton]} accessibilityLabel="Print or share this quotation">
              <ThemedText style={styles.cancelButtonLabel}>Print / Share</ThemedText>
            </Pressable>
            {isAdmin && detail.status !== 'REJECTED' && detail.status !== 'EXPIRED' && (
              <Pressable
                onPress={onCancel}
                disabled={isCancelling}
                style={[styles.cancelButton, styles.flex1]}
                accessibilityLabel="Cancel this quotation">
                {isCancelling ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.cancelButtonLabel}>Cancel</ThemedText>}
              </Pressable>
            )}
          </View>
          {isAdmin && (
            <Pressable onPress={onDelete} disabled={isDeleting} style={styles.deleteButton} accessibilityLabel="Delete this quotation">
              {isDeleting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.cancelButtonLabel}>Delete</ThemedText>}
            </Pressable>
          )}
        </View>
      ) : quotations === null ? (
        // Distinguish "still loading" from "fetch failed" — never an
        // indefinite spinner and never a fallback empty list on a money screen.
        listError ? (
          <View style={styles.errorBlock}>
            <ThemedText style={styles.error}>{listError}</ThemedText>
            <Pressable onPress={() => load(search)} style={styles.retryButton}>
              <ThemedText style={styles.cancelButtonLabel}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator style={styles.spinner} />
        )
      ) : listError ? (
        <View style={styles.errorBlock}>
          <ThemedText style={styles.error}>{listError}</ThemedText>
          <Pressable onPress={() => load(search)} style={styles.retryButton}>
            <ThemedText style={styles.cancelButtonLabel}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={quotations.slice(0, visibleCount)}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, quotations.length))}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No quotations yet.</ThemedText>}
          renderItem={({ item }) => (
            <Pressable onPress={() => openDetail(item.id)} disabled={loadingDetailId === item.id}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{item.quotationNumber} · {item.customerName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{formatCurrency(item.grandTotal)}</ThemedText>
                </View>
                {loadingDetailId === item.id ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedText type="small" style={{ color: statusColor(item.status) }}>{STATUS_LABEL[item.status]}</ThemedText>
                )}
              </ThemedView>
            </Pressable>
          )}
          ListFooterComponent={visibleCount < quotations.length ? <ActivityIndicator style={styles.spinner} /> : null}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  searchWrap: { padding: Spacing.three, paddingBottom: 0, gap: Spacing.two },
  detailWrap: { padding: Spacing.three, gap: Spacing.one },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  fieldLabel: { marginTop: Spacing.two },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  errorBlock: { marginTop: Spacing.three, gap: Spacing.two, alignItems: 'flex-start', paddingHorizontal: Spacing.three },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(120,120,140,0.3)', marginVertical: Spacing.two },
  lineItemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, marginBottom: Spacing.half },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  retryButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  saveButton: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  cancelButton: { marginTop: Spacing.three, height: 46, borderRadius: Spacing.two, backgroundColor: '#B83030', alignItems: 'center', justifyContent: 'center' },
  cancelButtonLabel: { color: '#ffffff', fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  lineItemCard: { borderRadius: Spacing.two, padding: Spacing.two, gap: Spacing.one, marginTop: Spacing.one },
  qtyInput: { width: 70 },
  removeButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(184,48,48,0.15)' },
  removeButtonLabel: { color: '#B83030', fontWeight: '700' },
  addLineButton: { marginTop: Spacing.one, alignSelf: 'flex-start' },
  printButton: { backgroundColor: '#3278B0' },
  deleteButton: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#B83030', alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
});
