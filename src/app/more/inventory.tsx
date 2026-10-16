import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
  addInventoryReceipt,
  confirmReceiptArrival,
  createInventoryItem,
  deleteDraftReceipt,
  deleteInventoryImage,
  deleteInventoryItem,
  fetchIncomingReceipts,
  fetchInventoryItemDetail,
  fetchInventoryItems,
  fetchItemsOut,
  fetchNextBarcode,
  fetchReconciliationHistory,
  getErrorMessage,
  logItemOut,
  reconcileInventoryItem,
  reconcileStockReceipt,
  updateInventoryItem,
  updateInventoryReceipt,
  uploadInventoryBill,
  uploadInventoryImages,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type { DraftReceipt, InventoryItemRow, ItemOutLog, ReconcileReason, ReconciliationRecord, StockReceipt } from '@/types/api';

const RECONCILE_REASONS: { value: ReconcileReason; label: string }[] = [
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'THEFT_LOSS', label: 'Theft / Loss' },
  { value: 'COUNTING_ERROR', label: 'Counting Error' },
  { value: 'FOUND_EXTRA', label: 'Found Extra Stock' },
  { value: 'OTHER', label: 'Other' },
];

const IMAGE_UPLOAD_RULES = { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'], maxSizeBytes: 15 * 1024 * 1024 };
const BILL_UPLOAD_RULES = { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxSizeBytes: 20 * 1024 * 1024 };

// GET /inventory-items (backend/src/routes/inventory_items_route.ts) only
// requires router.use(verifyToken) — ANY authenticated role can read it;
// write ops are gated by INVENTORY_WRITE_ROLES=[OWNER,STORE_MANAGER,
// INVENTORY_MANAGER] or the dynamic per-user 'inventory' tab permission mode
// (getInventoryAccess), the same permission-mode system already enforced for
// Inventory in the Configure picker (verified 2026-09-19). This is a
// DIFFERENT, newer resource than backend/src/routes/inventory.ts (the older
// `Inventory` model, statically gated to [OWNER,STORE_MANAGER,
// INVENTORY_MANAGER] for both read and write) — the two are not the same
// data. This screen deliberately targets /inventory-items since it's the one
// the dashboard's live permission-mode system actually governs. Read is
// technically open to every role server-side, but the mobile menu entry is
// still hidden from non-manager roles as a product decision (stock counts
// and cost prices aren't something every role should see on their phone) —
// this is a client-side product choice, not a security boundary; do not
// treat visibleToRoles here as the actual access gate.
//
// Barcode SCANNING is OUT OF SCOPE: no camera/barcode-scanner package is
// installed (checked package.json — only expo-image-picker exists), and
// adding one would need a native rebuild. Barcode GENERATION doesn't need
// a scanner though — FT###### codes are server-generated sequential text
// (GET next-barcode), displayed/entered as a plain string, not rendered as
// a scannable graphic (dashboard uses JsBarcode client-side; not ported).
//
// Write actions added 2026-09-23 (add/edit/batch/log-out) and extended
// 2026-09-24 (full-parity pass) with delete, per-item photos (POST/DELETE
// /:id/images), reconcile (POST /:id/reconcile, item-level count-based —
// not the dashboard's richer per-receipt reason-enum ReconcileModal), a
// barcode field + "Generate" button on the batch form, and a bill-photo
// upload on the batch form (POST /inventory/upload-bill on the LEGACY
// /inventory router — a plain file-store utility, no real OCR despite the
// "Bill OCR" name in the parity plan — its returned URL becomes billUrl on
// the batch). Bulk XLSX import is NOT built: the dashboard parses .xlsx/
// .xls client-side via the `xlsx` npm package before ever calling the
// server, and this app has no document-picker installed to select a
// spreadsheet file in the first place — flagged per the hard-stop rule.
// Write gates use the same static INVENTORY_WRITE_ROLES the backend uses,
// not re-derived.
const VIEW_ROLES = ['OWNER', 'STORE_MANAGER', 'INVENTORY_MANAGER'];
const WRITE_ROLES = ['OWNER', 'STORE_MANAGER', 'INVENTORY_MANAGER'];
const PAGE_SIZE = 30;

function formatCurrency(n: number | null) {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

function emptyItemForm() {
  return { product: '', category: '', unit: 'pcs', sellingPrice: '', incentiveValue: '', compatibility: '', warranty: '', notes: '' };
}

// Verbatim from the dashboard's WARRANTY_OPTIONS/UNIT_OPTIONS
// (frontend/src/app/(dashboard)/dashboard/inventory/page.tsx lines 28-29).
// CORRECTED 2026-09-28 (re-verification sweep) — a prior comment on this
// screen claimed these lists "weren't recoverable from the audit"; they
// were just never re-checked directly against the dashboard source.
const WARRANTY_OPTIONS = ['No Warranty', 'Self Warranty', '1 Month', '3 Months', '6 Months', '1 Year', '2 Years', 'Lifelong'];
const UNIT_OPTIONS = ['pcs', 'set', 'litre', 'kg', 'g', 'ml', 'roll', 'pair', 'box', 'self'];

// Verbatim from the dashboard's STATUS_CFG (frontend/src/app/(dashboard)/
// dashboard/inventory/page.tsx), field-level parity pass 2026-09-25.
// Dashboard's STATUS_CFG also has "Expired", but this app's ItemStatus
// type (matching this specific /inventory-items resource, not the older
// legacy Inventory model — see the file-level comment above) only has
// three values; not a mismatch to fix, the resources genuinely differ.
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  OUT_OF_STOCK: 'Out of Stock',
  DISCONTINUED: 'Discontinued',
};

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = VIEW_ROLES.includes(user?.role ?? '');
  const canWrite = WRITE_ROLES.includes(user?.role ?? '');

  const [items, setItems] = useState<InventoryItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Detail / actions
  const [selected, setSelected] = useState<InventoryItemRow | null>(null);
  const [activeAction, setActiveAction] = useState<'edit' | 'batch' | 'out' | 'images' | 'reconcile' | 'batches' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Receipts (batches) list — fetched via GET /inventory-items/:id on open,
  // since the list endpoint doesn't include them. Batch edit + inline
  // store-location edit both act on a specific receipt from this list.
  const [receipts, setReceipts] = useState<StockReceipt[] | null>(null);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [receiptForm, setReceiptForm] = useState({
    sellerName: '', sellerContact: '', sellerCity: '', orderPlacedTo: '', quantityReceived: '',
    dealerPrice: '', logisticsPartner: '', logisticsCharge: '', logisticsPartner2: '', logisticsCharge2: '',
    gstPercent: '', paymentTerms: '', orderDate: '', eta: '', storeLocation: '', notes: '',
  });
  const [isSavingReceipt, setIsSavingReceipt] = useState(false);
  const [locationEditId, setLocationEditId] = useState<string | null>(null);
  const [locationInput, setLocationInput] = useState('');
  const [itemLocationEditing, setItemLocationEditing] = useState(false);
  const [itemLocationInput, setItemLocationInput] = useState('');
  const [isSavingLocation, setIsSavingLocation] = useState(false);

  // Receipt-level reconcile-with-reason + history (a different, richer flow
  // than the plain item-level reconcileInventoryItem below).
  const [reconcilingReceiptId, setReconcilingReceiptId] = useState<string | null>(null);
  const [receiptReconcileCount, setReceiptReconcileCount] = useState('');
  const [receiptReconcileReason, setReceiptReconcileReason] = useState<ReconcileReason>('COUNTING_ERROR');
  const [receiptReconcileNotes, setReceiptReconcileNotes] = useState('');
  const [isSavingReceiptReconcile, setIsSavingReceiptReconcile] = useState(false);
  const [historyReceiptId, setHistoryReceiptId] = useState<string | null>(null);
  const [reconcileHistory, setReconcileHistory] = useState<ReconciliationRecord[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Items-Out log — a top-level view (dashboard's own "items-out" tab),
  // not nested under a specific item's detail screen. The item-detail
  // "Log Out" form above still exists for logging a new deduction from
  // that item's own screen; this is the separate filtered read log.
  const [showItemsOutLog, setShowItemsOutLog] = useState(false);
  const [itemsOutLog, setItemsOutLog] = useState<ItemOutLog[] | null>(null);
  const [itemsOutError, setItemsOutError] = useState<string | null>(null);
  const [ioFilterDate, setIoFilterDate] = useState('');
  const [ioFilterItem, setIoFilterItem] = useState('');
  const [ioFilterReason, setIoFilterReason] = useState<string | null>(null);
  const [ioFilterStatus, setIoFilterStatus] = useState<string | null>(null);

  // Drafts — incoming/unconfirmed stock receipts. 100% new (see
  // fetchIncomingReceipts comment). A separate top-level view, same as
  // Items Out Log above.
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<DraftReceipt[] | null>(null);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [confirmingDraftId, setConfirmingDraftId] = useState<string | null>(null);
  const [arrivalQty, setArrivalQty] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalNotes, setArrivalNotes] = useState('');
  const [isConfirmingArrival, setIsConfirmingArrival] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // New item / edit form (shared shape)
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyItemForm());

  // Add batch form
  const [batchQty, setBatchQty] = useState('');
  const [batchCost, setBatchCost] = useState('');
  const [batchSeller, setBatchSeller] = useState('');
  const [batchNotes, setBatchNotes] = useState('');

  // Log out form
  const [outQty, setOutQty] = useState('');
  const [outReason, setOutReason] = useState('');

  // Barcode + bill for the batch form
  const [batchBarcode, setBatchBarcode] = useState('');
  const [isGeneratingBarcode, setIsGeneratingBarcode] = useState(false);
  const billUpload = useFileUpload<{ billUrl: string }>(BILL_UPLOAD_RULES);
  const [batchBillUrl, setBatchBillUrl] = useState<string | null>(null);

  // Images
  const imageUpload = useFileUpload<InventoryItemRow>(IMAGE_UPLOAD_RULES);
  const [deletingImageUrl, setDeletingImageUrl] = useState<string | null>(null);

  // Reconcile
  const [reconcileCount, setReconcileCount] = useState('');

  // Delete
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      setItems(await fetchInventoryItems());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load inventory.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const loadItemsOut = useCallback(async () => {
    setItemsOutError(null);
    try {
      setItemsOutLog(await fetchItemsOut({
        date: ioFilterDate.trim() || undefined,
        item: ioFilterItem.trim() || undefined,
        reason: ioFilterReason ?? undefined,
        status: ioFilterStatus ?? undefined,
      }));
    } catch (err: any) {
      setItemsOutError(getErrorMessage(err, 'Could not load the items-out log.'));
    }
  }, [ioFilterDate, ioFilterItem, ioFilterReason, ioFilterStatus]);

  useEffect(() => {
    if (showItemsOutLog) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open / filter change
      loadItemsOut();
    }
  }, [showItemsOutLog, loadItemsOut]);

  const loadDrafts = useCallback(async () => {
    setDraftsError(null);
    try {
      setDrafts(await fetchIncomingReceipts());
    } catch (err: any) {
      setDraftsError(getErrorMessage(err, 'Could not load draft orders.'));
    }
  }, []);

  useEffect(() => {
    if (showDrafts) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on open
      loadDrafts();
    }
  }, [showDrafts, loadDrafts]);

  const openConfirmArrival = (d: DraftReceipt) => {
    setConfirmingDraftId(d.id);
    setArrivalQty(String(d.quantityReceived ?? ''));
    setArrivalDate(new Date().toISOString().slice(0, 10));
    setArrivalNotes('');
  };

  const onConfirmArrival = async () => {
    if (!confirmingDraftId || arrivalQty.trim() === '' || !arrivalDate.trim()) return;
    setIsConfirmingArrival(true);
    setDraftsError(null);
    try {
      await confirmReceiptArrival(confirmingDraftId, {
        quantityReceived: Number(arrivalQty),
        receiptDate: arrivalDate.trim(),
        notes: arrivalNotes.trim() || undefined,
      });
      setConfirmingDraftId(null);
      await loadDrafts();
      await load();
    } catch (err: any) {
      setDraftsError(getErrorMessage(err, 'Could not confirm arrival.'));
    } finally {
      setIsConfirmingArrival(false);
    }
  };

  const onDeleteDraft = (d: DraftReceipt) => {
    Alert.alert('Delete draft order?', `Delete this incoming order for "${d.item?.product ?? 'this item'}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingDraftId(d.id);
          setDraftsError(null);
          try {
            await deleteDraftReceipt(d.id);
            await loadDrafts();
          } catch (err: any) {
            setDraftsError(getErrorMessage(err, 'Could not delete this draft.'));
          } finally {
            setDeletingDraftId(null);
          }
        },
      },
    ]);
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.product.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }, [items, search]);

  const windowed = filtered.slice(0, visibleCount);

  const openCreate = () => {
    setForm(emptyItemForm());
    setActionError(null);
    setShowCreate(true);
  };

  const onCreateItem = async () => {
    if (!form.product.trim() || !form.category.trim()) {
      const missing = [!form.product.trim() && 'Product', !form.category.trim() && 'Category'].filter(Boolean).join(', ');
      setActionError(`Required fields missing: ${missing}`);
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await createInventoryItem({
        product: form.product.trim(),
        category: form.category.trim(),
        sellingPrice: form.sellingPrice ? Number(form.sellingPrice) : undefined,
        incentiveValue: form.incentiveValue ? Number(form.incentiveValue) : undefined,
        unit: form.unit.trim() || 'pcs',
        compatibility: form.compatibility.trim() || undefined,
        warranty: form.warranty.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not create this item.'));
    } finally {
      setIsSaving(false);
    }
  };

  const openItem = (item: InventoryItemRow) => {
    setSelected(item);
    setActiveAction(null);
    setActionError(null);
    setForm({
      product: item.product,
      category: item.category,
      unit: item.unit,
      sellingPrice: item.sellingPrice != null ? String(item.sellingPrice) : '',
      incentiveValue: '',
      compatibility: '',
      warranty: '',
      notes: '',
    });
    setBatchQty('');
    setBatchCost('');
    setBatchSeller('');
    setBatchNotes('');
    setOutQty('');
    setOutReason('');
    setBatchBarcode('');
    setBatchBillUrl(null);
    billUpload.reset();
    imageUpload.reset();
    setReconcileCount('');
    setReceipts(null);
    setReceiptsError(null);
    setEditingReceiptId(null);
    setItemLocationEditing(false);
    setItemLocationInput(item.storeLocation ?? '');
    loadReceipts(item.id);
  };

  const loadReceipts = async (itemId: string) => {
    setReceiptsError(null);
    try {
      const detail = await fetchInventoryItemDetail(itemId);
      setReceipts(detail.receipts);
    } catch (err: any) {
      setReceiptsError(getErrorMessage(err, 'Could not load batches.'));
    }
  };

  const openReceiptEdit = (r: StockReceipt) => {
    setEditingReceiptId(r.id);
    setReceiptForm({
      sellerName: r.sellerName ?? '',
      sellerContact: r.sellerContact ?? '',
      sellerCity: r.sellerCity ?? '',
      orderPlacedTo: r.orderPlacedTo ?? '',
      quantityReceived: String(r.quantityReceived ?? ''),
      dealerPrice: r.dealerPrice != null ? String(r.dealerPrice) : '',
      logisticsPartner: r.logisticsPartner ?? '',
      logisticsCharge: r.logisticsCharge != null ? String(r.logisticsCharge) : '',
      logisticsPartner2: r.logisticsPartner2 ?? '',
      logisticsCharge2: r.logisticsCharge2 != null ? String(r.logisticsCharge2) : '',
      gstPercent: r.gstPercent != null ? String(r.gstPercent) : '',
      paymentTerms: r.paymentTerms ?? '',
      orderDate: r.orderDate ? r.orderDate.slice(0, 10) : '',
      eta: '',
      storeLocation: r.storeLocation ?? '',
      notes: r.notes ?? '',
    });
  };

  const onSaveReceipt = async () => {
    if (!editingReceiptId || !selected) return;
    const { sellerName, sellerContact, quantityReceived, logisticsPartner, orderDate, storeLocation, gstPercent } = receiptForm;
    if (!sellerName.trim() || !sellerContact.trim() || !quantityReceived.trim() || !logisticsPartner.trim() || !orderDate.trim() || !storeLocation.trim() || !gstPercent.trim()) {
      setActionError('Seller name, seller contact, quantity, logistics partner, order date, store location, and GST % are required.');
      return;
    }
    setIsSavingReceipt(true);
    setActionError(null);
    try {
      const dealerPrice = Number(receiptForm.dealerPrice) || 0;
      const logisticsCharge = Number(receiptForm.logisticsCharge) || 0;
      const logisticsCharge2 = Number(receiptForm.logisticsCharge2) || 0;
      const qty = Number(quantityReceived);
      const gst = Number(gstPercent);
      const costPerUnit = qty > 0
        ? parseFloat((dealerPrice + (logisticsCharge + logisticsCharge2) / qty + (dealerPrice * gst) / 100).toFixed(2))
        : undefined;
      await updateInventoryReceipt(editingReceiptId, {
        sellerName: sellerName.trim(),
        sellerContact: sellerContact.trim(),
        sellerCity: receiptForm.sellerCity.trim() || undefined,
        orderPlacedTo: receiptForm.orderPlacedTo.trim() || undefined,
        quantityReceived: qty,
        dealerPrice,
        logisticsPartner: logisticsPartner.trim(),
        logisticsCharge,
        logisticsPartner2: receiptForm.logisticsPartner2.trim() || undefined,
        logisticsCharge2,
        gstPercent: gst,
        paymentTerms: receiptForm.paymentTerms.trim() || undefined,
        orderDate: orderDate.trim(),
        storeLocation: storeLocation.trim(),
        notes: receiptForm.notes.trim() || undefined,
        costPerUnit,
      });
      setEditingReceiptId(null);
      await loadReceipts(selected.id);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not save this batch.'));
    } finally {
      setIsSavingReceipt(false);
    }
  };

  const onSaveReceiptLocation = async (receiptId: string) => {
    setIsSavingLocation(true);
    setActionError(null);
    try {
      await updateInventoryReceipt(receiptId, { storeLocation: locationInput.trim() || null });
      setLocationEditId(null);
      if (selected) await loadReceipts(selected.id);
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not save this location.'));
    } finally {
      setIsSavingLocation(false);
    }
  };

  const onSaveReceiptReconcile = async (receiptId: string) => {
    if (receiptReconcileCount.trim() === '') return;
    setIsSavingReceiptReconcile(true);
    setActionError(null);
    try {
      await reconcileStockReceipt(receiptId, Number(receiptReconcileCount), receiptReconcileReason, receiptReconcileNotes.trim() || undefined);
      setReconcilingReceiptId(null);
      setReceiptReconcileCount('');
      setReceiptReconcileNotes('');
      if (selected) await loadReceipts(selected.id);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not reconcile this batch.'));
    } finally {
      setIsSavingReceiptReconcile(false);
    }
  };

  const toggleReconcileHistory = async (receiptId: string) => {
    if (historyReceiptId === receiptId) { setHistoryReceiptId(null); return; }
    setHistoryReceiptId(receiptId);
    setReconcileHistory(null);
    setHistoryError(null);
    try {
      setReconcileHistory(await fetchReconciliationHistory(receiptId));
    } catch (err: any) {
      setHistoryError(getErrorMessage(err, 'Could not load reconciliation history.'));
    }
  };

  const onSaveItemLocation = async () => {
    if (!selected) return;
    setIsSavingLocation(true);
    setActionError(null);
    try {
      const updated = await updateInventoryItem(selected.id, { storeLocation: itemLocationInput.trim() || null });
      setSelected(updated);
      setItemLocationEditing(false);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not save this location.'));
    } finally {
      setIsSavingLocation(false);
    }
  };

  const onGenerateBarcode = async () => {
    setIsGeneratingBarcode(true);
    setActionError(null);
    try {
      const res = await fetchNextBarcode();
      setBatchBarcode(res.barcode);
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not generate a barcode.'));
    } finally {
      setIsGeneratingBarcode(false);
    }
  };

  const onPickBillCamera = async () => {
    const file = await pickFromCamera();
    if (file) billUpload.pick(file);
  };
  const onPickBillGallery = async () => {
    const file = await pickFromGallery();
    if (file) billUpload.pick(file);
  };
  const doUploadBill = () => {
    return billUpload.upload((file, ctrl) => uploadInventoryBill(file, ctrl)).then((result) => {
      if (result) setBatchBillUrl(result.billUrl);
    });
  };

  const onPickImageCamera = async () => {
    if (!selected) return;
    const file = await pickFromCamera();
    if (file) imageUpload.pick(file);
  };
  const onPickImageGallery = async () => {
    if (!selected) return;
    const file = await pickFromGallery();
    if (file) imageUpload.pick(file);
  };
  const doUploadImage = () => {
    if (!selected) return;
    return imageUpload.upload((file, ctrl) => uploadInventoryImages(selected.id, file, ctrl)).then((updated) => {
      if (updated) {
        setSelected(updated);
        imageUpload.reset();
        load();
      }
    });
  };

  const onDeleteImage = (url: string) => {
    if (!selected) return;
    Alert.alert('Delete this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingImageUrl(url);
          setActionError(null);
          try {
            const updated = await deleteInventoryImage(selected.id, url);
            setSelected(updated);
            await load();
          } catch (err: any) {
            setActionError(getErrorMessage(err, 'Could not delete this photo.'));
          } finally {
            setDeletingImageUrl(null);
          }
        },
      },
    ]);
  };

  const onReconcile = async () => {
    if (!selected || reconcileCount.trim() === '') return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await reconcileInventoryItem(selected.id, Number(reconcileCount));
      setSelected(updated);
      setActiveAction(null);
      setReconcileCount('');
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not reconcile this item.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onDeleteItem = () => {
    if (!selected) return;
    Alert.alert('Delete this item?', `Delete "${selected.product}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setIsDeleting(true);
          setActionError(null);
          try {
            await deleteInventoryItem(selected.id);
            setSelected(null);
            await load();
          } catch (err: any) {
            setActionError(getErrorMessage(err, 'Could not delete this item.'));
          } finally {
            setIsDeleting(false);
          }
        },
      },
    ]);
  };

  const onSaveEdit = async () => {
    if (!selected) return;
    if (!form.product.trim() || !form.category.trim()) {
      const missing = [!form.product.trim() && 'Product', !form.category.trim() && 'Category'].filter(Boolean).join(', ');
      setActionError(`Required fields missing: ${missing}`);
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await updateInventoryItem(selected.id, {
        product: form.product.trim(),
        category: form.category.trim(),
        sellingPrice: form.sellingPrice ? Number(form.sellingPrice) : undefined,
        incentiveValue: form.incentiveValue ? Number(form.incentiveValue) : undefined,
        unit: form.unit.trim() || 'pcs',
        compatibility: form.compatibility.trim() || undefined,
        warranty: form.warranty.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setSelected(updated);
      setActiveAction(null);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not save changes.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onAddBatch = async () => {
    if (!selected) return;
    const qty = Number(batchQty);
    if (!qty || qty <= 0) {
      setActionError('Quantity received must be a positive number.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await addInventoryReceipt(selected.id, {
        quantityReceived: qty,
        costPerUnit: batchCost ? Number(batchCost) : undefined,
        sellerName: batchSeller.trim() || undefined,
        notes: batchNotes.trim() || undefined,
        barcode: batchBarcode.trim() || undefined,
        billUrl: batchBillUrl ?? undefined,
      });
      setActiveAction(null);
      setBatchQty('');
      setBatchCost('');
      setBatchSeller('');
      setBatchNotes('');
      setBatchBarcode('');
      setBatchBillUrl(null);
      billUpload.reset();
      await load();
      setSelected((prev) => (prev ? { ...prev, totalStock: prev.totalStock + qty, status: 'ACTIVE' } : prev));
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not add this batch.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onLogOut = async () => {
    if (!selected) return;
    const qty = Number(outQty);
    if (!qty || qty <= 0) {
      setActionError('Quantity must be a positive number.');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await logItemOut({ itemName: selected.product, quantity: qty, reason: outReason.trim() || undefined });
      setActiveAction(null);
      setOutQty('');
      setOutReason('');
      await load();
      setSelected((prev) => (prev ? { ...prev, totalStock: Math.max(0, prev.totalStock - qty) } : prev));
    } catch (err: any) {
      setActionError(getErrorMessage(err, 'Could not log this item out.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Inventory is only available to Owner, Store Manager, or Inventory Manager accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (showCreate) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'New Item' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowCreate(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          <ItemFields form={form} setForm={setForm} theme={theme} />
          {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
          <Pressable onPress={onCreateItem} disabled={isSaving} style={styles.button}>
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>✓ Add Product</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showDrafts) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'Draft Orders' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowDrafts(false)}><ThemedText type="small">← Back to products</ThemedText></Pressable>
          {draftsError && <ThemedText style={styles.error}>{draftsError}</ThemedText>}
          {drafts === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : drafts.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No draft orders — everything incoming has arrived.</ThemedText>
          ) : (
            drafts.map((d) => {
              const isOverdue = d.estimatedArrivalDate ? new Date(d.estimatedArrivalDate) < new Date() : false;
              const estCost = d.costPerUnit != null ? d.costPerUnit * d.quantityReceived : null;
              return (
                <ThemedView key={d.id} type="backgroundElement" style={styles.receiptRow}>
                  <ThemedText type="smallBold">{d.item?.product ?? 'Unknown item'}</ThemedText>
                  <ThemedText type="small" style={{ color: isOverdue ? '#B83030' : '#A86018' }}>
                    {isOverdue ? 'OVERDUE' : 'DRAFT'}{d.estimatedArrivalDate ? ` · Est. arrival ${new Date(d.estimatedArrivalDate).toLocaleDateString('en-IN')}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                    Qty {d.quantityReceived} {d.item?.unit ?? ''} · Seller: {d.sellerName ?? '—'}
                  </ThemedText>
                  {d.orderDate && <ThemedText type="small" themeColor="textSecondary">Ordered {new Date(d.orderDate).toLocaleDateString('en-IN')}</ThemedText>}
                  {estCost != null && <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>Est. cost {formatCurrency(estCost)}</ThemedText>}
                  {d.item?.category && <ThemedText type="small" themeColor="textSecondary">{d.item.category}</ThemedText>}

                  {canWrite && (
                    confirmingDraftId === d.id ? (
                      <View style={styles.reconcileBlock}>
                        <ThemedText type="small" themeColor="textSecondary">Actual Quantity Received *</ThemedText>
                        {Number(arrivalQty) !== d.quantityReceived && arrivalQty.trim() !== '' && (
                          <ThemedText type="small" style={{ color: '#A86018' }}>Ordered {d.quantityReceived}, receiving {arrivalQty} — a discrepancy note will be added.</ThemedText>
                        )}
                        <TextInput
                          value={arrivalQty}
                          onChangeText={setArrivalQty}
                          placeholderTextColor={theme.textSecondary}
                          keyboardType="decimal-pad"
                          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Receipt Date *</ThemedText>
                        <TextInput
                          value={arrivalDate}
                          onChangeText={setArrivalDate}
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes (optional)</ThemedText>
                        <TextInput
                          value={arrivalNotes}
                          onChangeText={setArrivalNotes}
                          placeholderTextColor={theme.textSecondary}
                          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                        />
                        <View style={styles.inlineRow}>
                          <Pressable onPress={onConfirmArrival} disabled={isConfirmingArrival} style={[styles.button, styles.flex1]}>
                            {isConfirmingArrival ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Confirm Arrival</ThemedText>}
                          </Pressable>
                          <Pressable onPress={() => setConfirmingDraftId(null)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.inlineRow}>
                        <Pressable onPress={() => openConfirmArrival(d)}><ThemedText type="link">Confirm Arrival</ThemedText></Pressable>
                        <Pressable onPress={() => onDeleteDraft(d)} disabled={deletingDraftId === d.id}>
                          {deletingDraftId === d.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.error}>Delete</ThemedText>}
                        </Pressable>
                      </View>
                    )
                  )}
                </ThemedView>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showItemsOutLog) {
    const IO_REASONS = ['Sale', 'Service Use', 'Self Use', 'Damaged', 'Lost', 'Other'];
    const IO_STATUSES = [
      { value: 'DEDUCTED', label: 'Deducted' },
      { value: 'OUT_OF_STOCK_AT_TIME', label: 'Out of stock' },
      { value: 'ITEM_NOT_IN_INVENTORY', label: 'Not in inventory' },
    ];
    return (
      <>
        <Stack.Screen options={{ title: 'Items Out Log' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowItemsOutLog(false)}><ThemedText type="small">← Back to products</ThemedText></Pressable>
          <TextInput
            value={ioFilterItem}
            onChangeText={setIoFilterItem}
            placeholder="Filter by item name"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <TextInput
            value={ioFilterDate}
            onChangeText={setIoFilterDate}
            placeholder="Filter by date (YYYY-MM-DD)"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setIoFilterReason(null)} style={[styles.chip, { backgroundColor: ioFilterReason === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={ioFilterReason === null ? styles.chipLabelActive : undefined}>All reasons</ThemedText>
            </Pressable>
            {IO_REASONS.map((r) => (
              <Pressable key={r} onPress={() => setIoFilterReason(r)} style={[styles.chip, { backgroundColor: ioFilterReason === r ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={ioFilterReason === r ? styles.chipLabelActive : undefined}>{r}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setIoFilterStatus(null)} style={[styles.chip, { backgroundColor: ioFilterStatus === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={ioFilterStatus === null ? styles.chipLabelActive : undefined}>All statuses</ThemedText>
            </Pressable>
            {IO_STATUSES.map((s) => (
              <Pressable key={s.value} onPress={() => setIoFilterStatus(s.value)} style={[styles.chip, { backgroundColor: ioFilterStatus === s.value ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={ioFilterStatus === s.value ? styles.chipLabelActive : undefined}>{s.label}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
          {itemsOutError && <ThemedText style={styles.error}>{itemsOutError}</ThemedText>}
          {itemsOutLog === null ? (
            <ActivityIndicator style={styles.spinner} />
          ) : itemsOutLog.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No items-out entries match these filters.</ThemedText>
          ) : (
            itemsOutLog.map((log) => (
              <ThemedView key={log.id} type="backgroundElement" style={styles.row}>
                <ThemedText type="smallBold">{log.itemName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                  Qty {log.quantity} {log.unit ?? ''} · {new Date(log.date).toLocaleDateString('en-IN')}
                </ThemedText>
                {log.barcode && <ThemedText type="small" themeColor="textSecondary">Barcode: {log.barcode}</ThemedText>}
                {log.reason && <ThemedText type="small" themeColor="textSecondary">Reason: {log.reason}</ThemedText>}
                {log.notes && <ThemedText type="small" themeColor="textSecondary">{log.notes}</ThemedText>}
                <ThemedText type="small" style={{ color: log.status === 'DEDUCTED' ? '#167A48' : '#B83030' }}>
                  {IO_STATUSES.find((s) => s.value === log.status)?.label ?? log.status}
                </ThemedText>
              </ThemedView>
            ))
          )}
        </ScrollView>
      </>
    );
  }

  if (selected) {
    return (
      <>
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: selected.product }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setSelected(null)}><ThemedText type="small">← Back to list</ThemedText></Pressable>
          <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>{selected.product}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{selected.category} · {selected.unit}</ThemedText>
          <ThemedText type="small" style={styles.tabularNums}>Stock: {selected.totalStock} · {formatCurrency(selected.sellingPrice)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{STATUS_LABEL[selected.status] ?? selected.status}</ThemedText>

          {itemLocationEditing ? (
            <View style={styles.inlineRow}>
              <TextInput
                value={itemLocationInput}
                onChangeText={setItemLocationInput}
                placeholder="Store location"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onSaveItemLocation} disabled={isSavingLocation}>
                {isSavingLocation ? <ActivityIndicator size="small" /> : <ThemedText type="link">Save</ThemedText>}
              </Pressable>
              <Pressable onPress={() => setItemLocationEditing(false)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
            </View>
          ) : (
            canWrite && (
              <Pressable onPress={() => setItemLocationEditing(true)}>
                <ThemedText type="small" themeColor="textSecondary">
                  Location: {selected.storeLocation ?? '—'} · <ThemedText type="link">Edit</ThemedText>
                </ThemedText>
              </Pressable>
            )
          )}

          {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}

          {canWrite && (
            <View style={styles.actionTabs}>
              {(['edit', 'batch', 'out', 'images', 'reconcile', 'batches'] as const).map((a) => (
                <Pressable
                  key={a}
                  onPress={() => { setActiveAction(activeAction === a ? null : a); setActionError(null); }}
                  style={[styles.actionTab, { backgroundColor: activeAction === a ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={activeAction === a ? styles.actionTabLabelActive : undefined}>
                    {a === 'edit' ? 'Edit' : a === 'batch' ? '+ Stock' : a === 'out' ? 'Log Out' : a === 'images' ? 'Photos' : a === 'reconcile' ? 'Reconcile' : 'Batches'}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          {activeAction === 'batches' && (
            <View style={styles.actionCard}>
              {receiptsError && <ThemedText style={styles.error}>{receiptsError}</ThemedText>}
              {receipts === null ? (
                <ActivityIndicator />
              ) : receipts.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No batches on record.</ThemedText>
              ) : (
                receipts.map((r) => (
                  <ThemedView key={r.id} type="backgroundElement" style={styles.receiptRow}>
                    {editingReceiptId === r.id ? (
                      <>
                        <TextInput value={receiptForm.sellerName} onChangeText={(t) => setReceiptForm({ ...receiptForm, sellerName: t })} placeholder="Seller name *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.sellerContact} onChangeText={(t) => setReceiptForm({ ...receiptForm, sellerContact: t })} placeholder="Seller contact *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.sellerCity} onChangeText={(t) => setReceiptForm({ ...receiptForm, sellerCity: t })} placeholder="Seller city" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.orderPlacedTo} onChangeText={(t) => setReceiptForm({ ...receiptForm, orderPlacedTo: t })} placeholder="Order placed to" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.quantityReceived} onChangeText={(t) => setReceiptForm({ ...receiptForm, quantityReceived: t })} placeholder="Quantity received *" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.dealerPrice} onChangeText={(t) => setReceiptForm({ ...receiptForm, dealerPrice: t })} placeholder="Dealer price" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.logisticsPartner} onChangeText={(t) => setReceiptForm({ ...receiptForm, logisticsPartner: t })} placeholder="Logistics partner 1 *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.logisticsCharge} onChangeText={(t) => setReceiptForm({ ...receiptForm, logisticsCharge: t })} placeholder="Logistics charge 1" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.logisticsPartner2} onChangeText={(t) => setReceiptForm({ ...receiptForm, logisticsPartner2: t })} placeholder="Logistics partner 2" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.logisticsCharge2} onChangeText={(t) => setReceiptForm({ ...receiptForm, logisticsCharge2: t })} placeholder="Logistics charge 2" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.gstPercent} onChangeText={(t) => setReceiptForm({ ...receiptForm, gstPercent: t })} placeholder="GST % *" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.paymentTerms} onChangeText={(t) => setReceiptForm({ ...receiptForm, paymentTerms: t })} placeholder="Payment terms" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.orderDate} onChangeText={(t) => setReceiptForm({ ...receiptForm, orderDate: t })} placeholder="Order date (YYYY-MM-DD) *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.storeLocation} onChangeText={(t) => setReceiptForm({ ...receiptForm, storeLocation: t })} placeholder="Store location *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <TextInput value={receiptForm.notes} onChangeText={(t) => setReceiptForm({ ...receiptForm, notes: t })} placeholder="Notes" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                        <View style={styles.inlineRow}>
                          <Pressable onPress={onSaveReceipt} disabled={isSavingReceipt} style={[styles.button, styles.flex1]}>
                            {isSavingReceipt ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
                          </Pressable>
                          <Pressable onPress={() => setEditingReceiptId(null)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                        </View>
                      </>
                    ) : (
                      <>
                        <ThemedText type="smallBold">{r.sellerName ?? 'Unknown seller'}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                          Qty {r.quantityReceived} · Remaining {r.remainingQty ?? r.quantityReceived} · {formatCurrency(r.costPerUnit ?? null)}/unit
                        </ThemedText>
                        {r.barcode && <ThemedText type="small" themeColor="textSecondary">Barcode: {r.barcode}</ThemedText>}
                        {locationEditId === r.id ? (
                          <View style={styles.inlineRow}>
                            <TextInput
                              value={locationInput}
                              onChangeText={setLocationInput}
                              placeholder="Store location"
                              placeholderTextColor={theme.textSecondary}
                              style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
                            />
                            <Pressable onPress={() => onSaveReceiptLocation(r.id)} disabled={isSavingLocation}>
                              {isSavingLocation ? <ActivityIndicator size="small" /> : <ThemedText type="link">Save</ThemedText>}
                            </Pressable>
                            <Pressable onPress={() => setLocationEditId(null)}><ThemedText type="small" themeColor="textSecondary">Cancel</ThemedText></Pressable>
                          </View>
                        ) : (
                          <Pressable onPress={() => { setLocationEditId(r.id); setLocationInput(r.storeLocation ?? ''); }}>
                            <ThemedText type="small" themeColor="textSecondary">
                              Location: {r.storeLocation ?? '—'} · <ThemedText type="link">Edit</ThemedText>
                            </ThemedText>
                          </Pressable>
                        )}
                        <View style={styles.inlineRow}>
                          <Pressable onPress={() => openReceiptEdit(r)}><ThemedText type="link">Edit batch</ThemedText></Pressable>
                          <Pressable onPress={() => { setReconcilingReceiptId(reconcilingReceiptId === r.id ? null : r.id); setReceiptReconcileCount(String(r.remainingQty ?? r.quantityReceived)); }}>
                            <ThemedText type="link">Reconcile</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => toggleReconcileHistory(r.id)}>
                            <ThemedText type="link">{historyReceiptId === r.id ? 'Hide history' : 'History'}</ThemedText>
                          </Pressable>
                        </View>
                        {reconcilingReceiptId === r.id && (
                          <View style={styles.reconcileBlock}>
                            <ThemedText type="small" themeColor="textSecondary">Actual Physical Count *</ThemedText>
                            <TextInput
                              value={receiptReconcileCount}
                              onChangeText={setReceiptReconcileCount}
                              placeholderTextColor={theme.textSecondary}
                              keyboardType="decimal-pad"
                              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                            />
                            <View style={styles.chipRow}>
                              {RECONCILE_REASONS.map((rr) => (
                                <Pressable key={rr.value} onPress={() => setReceiptReconcileReason(rr.value)} style={[styles.chip, { backgroundColor: receiptReconcileReason === rr.value ? theme.primary : theme.background }]}>
                                  <ThemedText type="small" style={receiptReconcileReason === rr.value ? styles.chipLabelActive : undefined}>{rr.label}</ThemedText>
                                </Pressable>
                              ))}
                            </View>
                            <TextInput
                              value={receiptReconcileNotes}
                              onChangeText={setReceiptReconcileNotes}
                              placeholder="Notes (optional)"
                              placeholderTextColor={theme.textSecondary}
                              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                            />
                            {receiptReconcileCount.trim() !== '' && (
                              (() => {
                                const prev = r.remainingQty ?? r.quantityReceived;
                                const diff = Number(receiptReconcileCount) - prev;
                                return (
                                  <ThemedText type="small" themeColor="textSecondary">
                                    {diff === 0 ? '0 (no change)' : diff > 0 ? `+${diff} (stock addition)` : `${diff} (loss)`}
                                  </ThemedText>
                                );
                              })()
                            )}
                            <Pressable onPress={() => onSaveReceiptReconcile(r.id)} disabled={isSavingReceiptReconcile} style={styles.button}>
                              {isSavingReceiptReconcile ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save Reconciliation</ThemedText>}
                            </Pressable>
                          </View>
                        )}
                        {historyReceiptId === r.id && (
                          <View style={styles.reconcileBlock}>
                            {historyError && <ThemedText style={styles.error}>{historyError}</ThemedText>}
                            {reconcileHistory === null ? (
                              <ActivityIndicator size="small" />
                            ) : reconcileHistory.length === 0 ? (
                              <ThemedText type="small" themeColor="textSecondary">No reconciliations on record.</ThemedText>
                            ) : (
                              reconcileHistory.map((h) => (
                                <ThemedText key={h.id} type="small" themeColor="textSecondary">
                                  {h.previousQty} → {h.newQty} ({h.difference > 0 ? '+' : ''}{h.difference}) · {RECONCILE_REASONS.find((rr) => rr.value === h.reason)?.label ?? h.reason} · {h.user?.name ?? 'Unknown'} · {new Date(h.reconciledAt).toLocaleDateString('en-IN')}
                                </ThemedText>
                              ))
                            )}
                          </View>
                        )}
                      </>
                    )}
                  </ThemedView>
                ))
              )}
            </View>
          )}

          {activeAction === 'edit' && (
            <View style={styles.actionCard}>
              <ItemFields form={form} setForm={setForm} theme={theme} />
              <Pressable onPress={onSaveEdit} disabled={isSaving} style={styles.button}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save Changes</ThemedText>}
              </Pressable>
            </View>
          )}

          {activeAction === 'batch' && (
            <View style={styles.actionCard}>
              <ThemedText type="small" themeColor="textSecondary">
                Adds a new stock batch — increases available stock for this item.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Qty Received *</ThemedText>
              <TextInput
                value={batchQty}
                onChangeText={setBatchQty}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Dealer Price (₹ / unit)</ThemedText>
              <TextInput
                value={batchCost}
                onChangeText={setBatchCost}
                placeholder="0.00"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Seller Name</ThemedText>
              <TextInput
                value={batchSeller}
                onChangeText={setBatchSeller}
                placeholder="e.g. ABC Distributors"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes</ThemedText>
              <TextInput
                value={batchNotes}
                onChangeText={setBatchNotes}
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Batch Barcode</ThemedText>
              <View style={styles.inlineRow}>
                <TextInput
                  value={batchBarcode}
                  onChangeText={setBatchBarcode}
                  placeholder="FT000001"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <Pressable onPress={onGenerateBarcode} disabled={isGeneratingBarcode}>
                  {isGeneratingBarcode ? <ActivityIndicator size="small" /> : <ThemedText type="link">↻</ThemedText>}
                </Pressable>
              </View>
              {batchBillUrl ? (
                <ThemedText type="small" themeColor="textSecondary">Bill attached ✓</ThemedText>
              ) : billUpload.file ? (
                <View style={styles.inlineRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{billUpload.file.name}</ThemedText>
                  {billUpload.status === 'uploading' ? <ActivityIndicator size="small" /> : billUpload.status === 'error' ? (
                    <Pressable onPress={billUpload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
                  ) : (
                    <Pressable onPress={doUploadBill}><ThemedText type="link">Upload</ThemedText></Pressable>
                  )}
                </View>
              ) : (
                <View style={styles.inlineRow}>
                  <Pressable onPress={onPickBillCamera}><ThemedText type="link">+ Bill photo (camera)</ThemedText></Pressable>
                  <Pressable onPress={onPickBillGallery}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
                </View>
              )}
              <Pressable onPress={onAddBatch} disabled={isSaving} style={styles.button}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Add Stock</ThemedText>}
              </Pressable>
            </View>
          )}

          {activeAction === 'images' && (
            <View style={styles.actionCard}>
              <View style={styles.imageGrid}>
                {(selected.imageUrls ?? []).map((url, idx) => (
                  <View key={url} style={styles.imageItem}>
                    <Pressable onPress={() => setLightboxIndex(idx)}>
                      <Image source={{ uri: url }} style={styles.imageThumb} />
                    </Pressable>
                    <Pressable onPress={() => onDeleteImage(url)} disabled={deletingImageUrl === url} style={styles.imageDelete}>
                      {deletingImageUrl === url ? <ActivityIndicator size="small" /> : <ThemedText style={{ color: '#ffffff' }}>✕</ThemedText>}
                    </Pressable>
                  </View>
                ))}
              </View>
              {imageUpload.file ? (
                <View style={styles.inlineRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{imageUpload.file.name}</ThemedText>
                  {imageUpload.status === 'uploading' ? <ActivityIndicator size="small" /> : imageUpload.status === 'error' ? (
                    <Pressable onPress={imageUpload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
                  ) : (
                    <Pressable onPress={doUploadImage}><ThemedText type="link">Upload</ThemedText></Pressable>
                  )}
                </View>
              ) : (
                <View style={styles.inlineRow}>
                  <Pressable onPress={onPickImageCamera}><ThemedText type="link">+ Camera</ThemedText></Pressable>
                  <Pressable onPress={onPickImageGallery}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
                </View>
              )}
            </View>
          )}

          {activeAction === 'reconcile' && (
            <View style={styles.actionCard}>
              <ThemedText type="small" themeColor="textSecondary">
                Enter the physically-counted stock. The system adjusts the most recent batches to match.
              </ThemedText>
              {selected.lastVerifiedAt && (
                <ThemedText type="small" themeColor="textSecondary">
                  Last verified {new Date(selected.lastVerifiedAt).toLocaleDateString('en-IN')} · counted {selected.lastVerifiedCount}
                </ThemedText>
              )}
              <ThemedText type="small" themeColor="textSecondary">Actual Physical Count *</ThemedText>
              <TextInput
                value={reconcileCount}
                onChangeText={setReconcileCount}
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onReconcile} disabled={isSaving} style={styles.button}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save Reconciliation</ThemedText>}
              </Pressable>
            </View>
          )}

          {canWrite && (
            <Pressable onPress={onDeleteItem} disabled={isDeleting} style={styles.deleteButton}>
              {isDeleting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Delete</ThemedText>}
            </Pressable>
          )}

          {activeAction === 'out' && (
            <View style={styles.actionCard}>
              <ThemedText type="small" themeColor="textSecondary">
                Deducts from stock, oldest batch first.
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Quantity *</ThemedText>
              <TextInput
                value={outQty}
                onChangeText={setOutQty}
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes (optional)</ThemedText>
              <TextInput
                value={outReason}
                onChangeText={setOutReason}
                placeholder="e.g. Used in job #1234, damaged on delivery…"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable onPress={onLogOut} disabled={isSaving} style={styles.button}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Log Out</ThemedText>}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={selected.imageUrls ?? []}
          index={lightboxIndex}
          name={selected.product}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Inventory' }} />
      <ThemedView style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={(t) => { setSearch(t); setVisibleCount(PAGE_SIZE); }}
          placeholder="Search by name…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        {canWrite && (
          <Pressable onPress={openCreate} style={styles.newButton}>
            <ThemedText style={styles.buttonLabel}>+ Add Product</ThemedText>
          </Pressable>
        )}
        <View style={styles.inlineRow}>
          <Pressable onPress={() => setShowDrafts(true)}>
            <ThemedText type="link">Drafts →</ThemedText>
          </Pressable>
          <Pressable onPress={() => setShowItemsOutLog(true)}>
            <ThemedText type="link">Items Out Log →</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {items === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <FlatList
          data={windowed}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          onEndReached={() => setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length))}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No products yet</ThemedText>}
          renderItem={({ item }) => (
            <Pressable onPress={() => openItem(item)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{item.product}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                    {item.category} · {item.unit} · Stock {item.totalStock}
                  </ThemedText>
                </View>
                <View style={styles.rightCol}>
                  <ThemedText type="small" style={styles.tabularNums}>{formatCurrency(item.sellingPrice)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{STATUS_LABEL[item.status] ?? item.status}</ThemedText>
                </View>
              </ThemedView>
            </Pressable>
          )}
          ListFooterComponent={
            filtered.length > windowed.length ? <ActivityIndicator style={styles.spinner} /> : null
          }
        />
      )}
    </>
  );
}

// Full-screen image viewer with prev/next + a thumbnail strip, matching
// the dashboard's ImageLightbox. Added 2026-09-28 (re-verification sweep) —
// was previously just Linking.openURL to the raw image URL, no in-app
// navigation between an item's multiple photos.
function ImageLightbox({ images, index, name, onClose, onNavigate }: {
  images: string[]; index: number; name: string; onClose: () => void; onNavigate: (i: number) => void;
}) {
  if (images.length === 0) return null;
  const goPrev = () => onNavigate((index - 1 + images.length) % images.length);
  const goNext = () => onNavigate((index + 1) % images.length);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.lightboxBackdrop} onPress={onClose}>
        <Pressable onPress={() => {}} style={styles.lightboxContent}>
          <View style={styles.lightboxHeader}>
            <ThemedText style={styles.lightboxTitle} numberOfLines={1}>
              {name}{images.length > 1 ? `  —  ${index + 1} / ${images.length}` : ''}
            </ThemedText>
            <Pressable onPress={onClose}><ThemedText style={styles.lightboxClose}>✕</ThemedText></Pressable>
          </View>
          <View style={styles.lightboxImageRow}>
            {images.length > 1 && (
              <Pressable onPress={goPrev} style={styles.lightboxNavButton}><ThemedText style={styles.lightboxNavLabel}>‹</ThemedText></Pressable>
            )}
            <Image source={{ uri: images[index] }} style={styles.lightboxImage} resizeMode="contain" />
            {images.length > 1 && (
              <Pressable onPress={goNext} style={styles.lightboxNavButton}><ThemedText style={styles.lightboxNavLabel}>›</ThemedText></Pressable>
            )}
          </View>
          {images.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.lightboxThumbRow}>
              {images.map((url, i) => (
                <Pressable key={url} onPress={() => onNavigate(i)}>
                  <Image source={{ uri: url }} style={[styles.lightboxThumb, i === index && styles.lightboxThumbActive]} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ItemForm = ReturnType<typeof emptyItemForm>;

// Field labels/order copied verbatim from the dashboard's Add/Edit Product
// forms (AddProductWizard step 1 / EditProductModal). Warranty and Unit are
// chip pickers bound to WARRANTY_OPTIONS/UNIT_OPTIONS, matching the
// dashboard's <select> dropdowns exactly (corrected 2026-09-28 — see the
// comment on those two arrays above).
function ItemFields({ form, setForm, theme }: { form: ItemForm; setForm: (f: ItemForm) => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">Product Name *</ThemedText>
      <TextInput
        value={form.product}
        onChangeText={(t) => setForm({ ...form, product: t })}
        placeholder="e.g. 3M Sun Film Dark"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Category *</ThemedText>
      <TextInput
        value={form.category}
        onChangeText={(t) => setForm({ ...form, category: t })}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Selling Price (₹)</ThemedText>
      <TextInput
        value={form.sellingPrice}
        onChangeText={(t) => setForm({ ...form, sellingPrice: t })}
        placeholder="0.00"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Incentive Value (₹)</ThemedText>
      <TextInput
        value={form.incentiveValue}
        onChangeText={(t) => setForm({ ...form, incentiveValue: t })}
        placeholder="0.00"
        placeholderTextColor={theme.textSecondary}
        keyboardType="decimal-pad"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Unit</ThemedText>
      <View style={styles.chipRow}>
        {UNIT_OPTIONS.map((u) => (
          <Pressable key={u} onPress={() => setForm({ ...form, unit: u })} style={[styles.chip, { backgroundColor: form.unit === u ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={form.unit === u ? styles.chipLabelActive : undefined}>{u}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Compatibility</ThemedText>
      <TextInput
        value={form.compatibility}
        onChangeText={(t) => setForm({ ...form, compatibility: t })}
        placeholder="e.g. Universal / Maruti Swift 2023-24"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Warranty</ThemedText>
      <View style={styles.chipRow}>
        {WARRANTY_OPTIONS.map((w) => (
          <Pressable key={w} onPress={() => setForm({ ...form, warranty: w })} style={[styles.chip, { backgroundColor: form.warranty === w ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={form.warranty === w ? styles.chipLabelActive : undefined}>{w}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes (optional)</ThemedText>
      <TextInput
        value={form.notes}
        onChangeText={(t) => setForm({ ...form, notes: t })}
        placeholder="Any additional product notes"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  searchWrap: { padding: Spacing.three, paddingBottom: 0, gap: Spacing.two },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  rightCol: { alignItems: 'flex-end' },
  tabularNums: { fontVariant: ['tabular-nums'] },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  button: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  actionTabs: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.three },
  actionTab: { flex: 1, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  actionTabLabelActive: { color: '#ffffff', fontWeight: '600' },
  actionCard: { marginTop: Spacing.three, gap: Spacing.two },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  imageItem: { position: 'relative' },
  imageThumb: { width: 90, height: 90, borderRadius: Spacing.two },
  imageDelete: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  deleteButton: { marginTop: Spacing.three, height: 46, borderRadius: Spacing.two, backgroundColor: '#B83030', alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { marginTop: Spacing.two },
  receiptRow: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, marginBottom: Spacing.two },
  reconcileBlock: { gap: Spacing.one, marginTop: Spacing.one, paddingTop: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chipScroller: { flexDirection: 'row', marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  lightboxBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  lightboxContent: { width: '100%', alignItems: 'center' },
  lightboxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: Spacing.two },
  lightboxTitle: { color: '#ffffff', fontWeight: '600', flex: 1 },
  lightboxClose: { color: '#ffffff', fontSize: 24, paddingHorizontal: Spacing.two },
  lightboxImageRow: { flexDirection: 'row', alignItems: 'center', width: '100%', marginTop: Spacing.two },
  lightboxImage: { flex: 1, height: 360 },
  lightboxNavButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  lightboxNavLabel: { color: '#ffffff', fontSize: 24 },
  lightboxThumbRow: { flexDirection: 'row', marginTop: Spacing.three },
  lightboxThumb: { width: 48, height: 48, borderRadius: Spacing.one, marginRight: Spacing.one, opacity: 0.5 },
  lightboxThumbActive: { opacity: 1, borderWidth: 2, borderColor: '#ffffff' },
});
