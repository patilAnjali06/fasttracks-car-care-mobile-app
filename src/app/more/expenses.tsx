import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addExpenseAttachment,
  approveExpense,
  bulkCreateExpenses,
  deleteExpenseAttachment,
  extractReceiptFields,
  extractStatementTransactions,
  fetchExpenseAttachmentDataUri,
  fetchExpensesAdmin,
  fetchExpensesForReview,
  fetchExpenseSummary,
  fetchMyExpenses,
  getErrorMessage,
  rejectExpense,
  replyToExpense,
  submitExpense,
} from '@/lib/api';
import { usePermissions } from '@/lib/permissions-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import {
  EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseAttachment,
  type ExpenseCategory,
  type ExpenseListResponse,
  type ExpenseStatus,
  type ExpenseSummary,
  type ExtractedStatementTransaction,
} from '@/types/api';

const BILL_REQUIRED_ABOVE = 200;
const ADMIN_PAGE_SIZE = 20;

const ATTACHMENT_UPLOAD_RULES = { allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'], maxSizeBytes: 15 * 1024 * 1024 };

const STATUS_COLOR: Record<ExpenseStatus, string> = {
  PENDING: '#A86018',
  APPROVED: '#167A48',
  REJECTED: '#B83030',
};

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { status: permStatus, hasTab, tabMode, refresh: refreshPermissions } = usePermissions();
  const expensesMode = tabMode('expenses');
  const canVerify = permStatus === 'ready' && hasTab('expenses') && (expensesMode === 'verify' || expensesMode === 'both');
  const canAdd = permStatus === 'ready' && hasTab('expenses') && (expensesMode === 'add' || expensesMode === 'both');

  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('MISC');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single-entry bill + OCR extract
  const billUpload = useFileUpload(ATTACHMENT_UPLOAD_RULES);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);

  // Bulk statement import
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const statementUpload = useFileUpload(ATTACHMENT_UPLOAD_RULES);
  const [isExtractingStatement, setIsExtractingStatement] = useState(false);
  const [bulkRows, setBulkRows] = useState<ExtractedStatementTransaction[] | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [isSavingBulk, setIsSavingBulk] = useState(false);

  const [pending, setPending] = useState<Expense[] | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  // Admin tabs — Pending / All / Trends, matching the dashboard's
  // AdminExpensesView. "All" and "Trends" are lazy-loaded only when opened.
  const [adminTab, setAdminTab] = useState<'pending' | 'all' | 'trends'>('pending');
  const [allExpenses, setAllExpenses] = useState<Expense[] | null>(null);
  const [allTotal, setAllTotal] = useState(0);
  const [allPage, setAllPage] = useState(1);
  const [allLoadingMore, setAllLoadingMore] = useState(false);
  const [allCategoryFilter, setAllCategoryFilter] = useState<ExpenseCategory | null>(null);
  const [allStatusFilter, setAllStatusFilter] = useState<ExpenseStatus | null>(null);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Expandable attachments/reply panel — shared across both lists, keyed by expense id
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const attachUpload = useFileUpload<ExpenseAttachment>(ATTACHMENT_UPLOAD_RULES);

  const load = useCallback(async () => {
    setError(null);
    try {
      setExpenses(await fetchMyExpenses());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to load your expenses.'));
    }
  }, []);

  const loadPending = useCallback(async () => {
    if (!canVerify) return;
    setReviewError(null);
    try {
      setPending(await fetchExpensesForReview('PENDING'));
    } catch (err: any) {
      setReviewError(getErrorMessage(err, 'Could not load expenses awaiting review.'));
    }
  }, [canVerify]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    load();
    loadPending();
  }, [load, loadPending]);

  const loadAll = useCallback(async () => {
    if (!canVerify) return;
    setReviewError(null);
    try {
      const resp: ExpenseListResponse = await fetchExpensesAdmin({
        status: allStatusFilter ?? undefined,
        category: allCategoryFilter ?? undefined,
        page: 1,
        limit: ADMIN_PAGE_SIZE,
      });
      setAllExpenses(resp.expenses);
      setAllTotal(resp.total);
      setAllPage(1);
    } catch (err: any) {
      setReviewError(getErrorMessage(err, 'Could not load expenses.'));
    }
  }, [canVerify, allStatusFilter, allCategoryFilter]);

  const loadMoreAll = async () => {
    if (allLoadingMore || !allExpenses || allExpenses.length >= allTotal) return;
    setAllLoadingMore(true);
    try {
      const nextPage = allPage + 1;
      const resp = await fetchExpensesAdmin({
        status: allStatusFilter ?? undefined,
        category: allCategoryFilter ?? undefined,
        page: nextPage,
        limit: ADMIN_PAGE_SIZE,
      });
      setAllExpenses((prev) => [...(prev ?? []), ...resp.expenses]);
      setAllPage(nextPage);
    } catch (err: any) {
      setReviewError(getErrorMessage(err, 'Could not load more expenses.'));
    } finally {
      setAllLoadingMore(false);
    }
  };

  const loadSummary = useCallback(async () => {
    if (!canVerify) return;
    setSummaryLoading(true);
    setReviewError(null);
    try {
      setSummary(await fetchExpenseSummary({}));
    } catch (err: any) {
      setReviewError(getErrorMessage(err, 'Could not load expense trends.'));
    } finally {
      setSummaryLoading(false);
    }
  }, [canVerify]);

  useEffect(() => {
    if (adminTab === 'all') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on tab-open / filter change
      loadAll();
    } else if (adminTab === 'trends') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on tab-open
      loadSummary();
    }
  }, [adminTab, loadAll, loadSummary]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    const tasks = [load(), loadPending()];
    if (adminTab === 'all') tasks.push(loadAll());
    if (adminTab === 'trends') tasks.push(loadSummary());
    await Promise.all(tasks);
    setIsRefreshing(false);
  };

  const decide = (id: string, action: 'approve' | 'reject') => {
    const note = noteById[id]?.trim() || undefined;
    Alert.alert(
      action === 'approve' ? 'Approve expense?' : 'Reject expense?',
      action === 'approve'
        ? 'This will mark the expense as approved.'
        : 'This will mark the expense as rejected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'approve' ? 'Approve' : 'Reject',
          style: action === 'reject' ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(id);
            setReviewError(null);
            setReviewNotice(null);
            try {
              if (action === 'approve') await approveExpense(id, note);
              else await rejectExpense(id, note);
              setReviewNotice(action === 'approve' ? 'Expense approved.' : 'Expense rejected.');
              setNoteById((prev) => { const next = { ...prev }; delete next[id]; return next; });
              await Promise.all([loadPending(), load(), adminTab === 'all' ? loadAll() : Promise.resolve()]);
            } catch (err: any) {
              setReviewError(getErrorMessage(err, 'Could not update this expense.'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const onPickBillCamera = async () => {
    const file = await pickFromCamera();
    if (file) { billUpload.pick(file); runExtract(file); }
  };
  const onPickBillGallery = async () => {
    const file = await pickFromGallery();
    if (file) { billUpload.pick(file); runExtract(file); }
  };

  const runExtract = async (file: { uri: string; name: string; mimeType: string }) => {
    setIsExtracting(true);
    setExtractNotice(null);
    try {
      const result = await extractReceiptFields(file);
      if (result.amount != null) setAmount(String(result.amount));
      if (result.amount != null || result.date != null) setExtractNotice('✨ Auto-filled from document — please verify before submitting');
    } catch {
      // extraction is best-effort; the form still works with manual entry
    } finally {
      setIsExtracting(false);
    }
  };

  const onSubmit = async () => {
    const value = Number(amount);
    if (!value || !description.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const created = await submitExpense({ amount: value, category, description: description.trim() }, billUpload.file ?? undefined);
      setExpenses((prev) => (prev ? [created, ...prev] : [created]));
      setAmount('');
      setDescription('');
      billUpload.reset();
      setExtractNotice(null);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to submit expense.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = Number(amount) > 0 && description.trim();

  // ── Bulk statement import ──────────────────────────────────────────────
  const onPickStatementCamera = async () => {
    const file = await pickFromCamera();
    if (file) { statementUpload.pick(file); runExtractStatement(file); }
  };
  const onPickStatementGallery = async () => {
    const file = await pickFromGallery();
    if (file) { statementUpload.pick(file); runExtractStatement(file); }
  };

  const runExtractStatement = async (file: { uri: string; name: string; mimeType: string }) => {
    setIsExtractingStatement(true);
    setError(null);
    setBulkRows(null);
    try {
      const result = await extractStatementTransactions(file);
      setBulkRows(result.transactions.map((t) => ({ ...t, category: EXPENSE_CATEGORIES.includes(t.category as ExpenseCategory) ? t.category : 'MISC' })));
      setBulkNote(result.unparsedNote);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not read that statement.'));
    } finally {
      setIsExtractingStatement(false);
    }
  };

  const updateBulkRow = (index: number, patch: Partial<ExtractedStatementTransaction>) => {
    setBulkRows((prev) => prev?.map((r, i) => (i === index ? { ...r, ...patch } : r)) ?? prev);
  };
  const removeBulkRow = (index: number) => {
    setBulkRows((prev) => prev?.filter((_, i) => i !== index) ?? prev);
  };

  const onSaveBulk = async () => {
    if (!statementUpload.file || !bulkRows || bulkRows.length === 0) return;
    setIsSavingBulk(true);
    setError(null);
    try {
      const file = statementUpload.file;
      const result = await bulkCreateExpenses(
        file,
        bulkRows.map((r) => ({ date: r.date, amount: Number(r.amount), category: r.category as ExpenseCategory, description: r.description })),
        { onProgress: () => {}, signal: new AbortController().signal },
      );
      setExpenses((prev) => (prev ? [...result.expenses, ...prev] : result.expenses));
      setBulkRows(null);
      setBulkNote(null);
      statementUpload.reset();
      setMode('single');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save these expenses.'));
    } finally {
      setIsSavingBulk(false);
    }
  };

  const bulkTotal = (bulkRows ?? []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const renderDetailToggle = (e: Expense) => (
    <Pressable onPress={() => toggleExpanded(e.id)}>
      <ThemedText type="small" themeColor="textSecondary">
        {expandedId === e.id ? 'Hide' : `Bills (${e.attachments?.length ?? 0}) & replies (${e.replies?.length ?? 0})`}
      </ThemedText>
    </Pressable>
  );

  const renderDetailPanel = (e: Expense) => (
    <View style={styles.detailPanel}>
      {(e.attachments ?? []).map((att) => (
        <View key={att.id} style={styles.attachRow}>
          <Pressable onPress={() => onOpenAttachment(att)} disabled={openingAttachmentId === att.id} style={styles.flex1}>
            {openingAttachmentId === att.id ? <ActivityIndicator size="small" /> : <ThemedText type="link" numberOfLines={1}>{att.filename}</ThemedText>}
          </Pressable>
          <Pressable onPress={() => onDeleteAttachment(e.id, att)} disabled={deletingAttachmentId === att.id}>
            {deletingAttachmentId === att.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.error}>✕</ThemedText>}
          </Pressable>
        </View>
      ))}
      {attachUpload.file ? (
        <View style={styles.attachRow}>
          <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{attachUpload.file.name}</ThemedText>
          {attachUpload.status === 'uploading' ? <ActivityIndicator size="small" /> : attachUpload.status === 'error' ? (
            <Pressable onPress={attachUpload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
          ) : (
            <Pressable onPress={() => doUploadAttachment(e.id)}><ThemedText type="link">Upload</ThemedText></Pressable>
          )}
        </View>
      ) : (
        <View style={styles.attachRow}>
          <Pressable onPress={() => onPickAttachCamera(e.id)}><ThemedText type="link">+ Camera</ThemedText></Pressable>
          <Pressable onPress={() => onPickAttachGallery(e.id)}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
        </View>
      )}

      {(e.replies ?? []).map((r) => (
        <ThemedText key={r.id} type="small" themeColor="textSecondary">
          <ThemedText type="smallBold">{r.author.name}</ThemedText>: {r.message}
        </ThemedText>
      ))}
      <View style={styles.attachRow}>
        <TextInput
          value={replyText}
          onChangeText={setReplyText}
          placeholder="Reply…"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]}
        />
        <Pressable onPress={() => onSendReply(e.id)} disabled={isSendingReply || !replyText.trim()}>
          {isSendingReply ? <ActivityIndicator size="small" /> : <ThemedText type="link">Send</ThemedText>}
        </Pressable>
      </View>
    </View>
  );

  // ── Attachments + replies (shared for both "yours" and "review" cards) ──
  const toggleExpanded = (id: string) => {
    setExpandedId((cur) => (cur === id ? null : id));
    setReplyText('');
    attachUpload.reset();
  };

  const patchExpenseEverywhere = (id: string, patch: (e: Expense) => Expense) => {
    setExpenses((prev) => prev?.map((e) => (e.id === id ? patch(e) : e)) ?? prev);
    setPending((prev) => prev?.map((e) => (e.id === id ? patch(e) : e)) ?? prev);
  };

  const onSendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setIsSendingReply(true);
    setError(null);
    try {
      const reply = await replyToExpense(id, replyText.trim());
      patchExpenseEverywhere(id, (e) => ({ ...e, replies: [...(e.replies ?? []), reply] }));
      setReplyText('');
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not send that reply.'));
    } finally {
      setIsSendingReply(false);
    }
  };

  const onPickAttachCamera = async (id: string) => {
    const file = await pickFromCamera();
    if (file) attachUpload.pick(file);
  };
  const onPickAttachGallery = async (id: string) => {
    const file = await pickFromGallery();
    if (file) attachUpload.pick(file);
  };
  const doUploadAttachment = (id: string) => {
    return attachUpload.upload((file, ctrl) => addExpenseAttachment(id, file, ctrl)).then((result) => {
      if (result) {
        patchExpenseEverywhere(id, (e) => ({ ...e, attachments: [...(e.attachments ?? []), result] }));
        attachUpload.reset();
      }
    });
  };

  const onOpenAttachment = async (att: ExpenseAttachment) => {
    setOpeningAttachmentId(att.id);
    setError(null);
    try {
      const dataUri = await fetchExpenseAttachmentDataUri(att.id, att.mimeType);
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not open this attachment.'));
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  const onDeleteAttachment = (expenseId: string, att: ExpenseAttachment) => {
    Alert.alert('Delete this attachment?', att.filename, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingAttachmentId(att.id);
          setError(null);
          try {
            await deleteExpenseAttachment(att.id);
            patchExpenseEverywhere(expenseId, (e) => ({ ...e, attachments: (e.attachments ?? []).filter((a) => a.id !== att.id) }));
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete this attachment.'));
          } finally {
            setDeletingAttachmentId(null);
          }
        },
      },
    ]);
  };

  const renderAdminCard = (e: Expense, showActions: boolean) => {
    const noBillAttached = e.amount > BILL_REQUIRED_ABOVE && (e.attachments?.length ?? 0) === 0;
    return (
      <ThemedView key={e.id} type="backgroundElement" style={styles.card}>
        <View style={styles.cardTop}>
          <ThemedText type="smallBold" style={styles.tabularNums}>
            {e.user?.name ?? 'Unknown'} · ₹{e.amount.toLocaleString('en-IN')} · {e.category}
          </ThemedText>
          {!showActions && (
            <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[e.status] }]}>
              <ThemedText type="small" style={styles.statusText}>{STATUS_LABEL[e.status]}</ThemedText>
            </View>
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {e.description} · {formatDate(e.date ?? e.createdAt)}
        </ThemedText>
        {noBillAttached && (
          <ThemedText type="small" style={styles.notice}>No bill attached — this predates the ₹{BILL_REQUIRED_ABOVE} rule.</ThemedText>
        )}
        {e.reviewNote != null && e.reviewNote !== '' && (
          <ThemedText type="small" themeColor="textSecondary">
            <ThemedText type="smallBold">{e.reviewedBy?.name ?? 'Reviewer'}</ThemedText>: {e.reviewNote}
          </ThemedText>
        )}
        {renderDetailToggle(e)}
        {expandedId === e.id && renderDetailPanel(e)}
        {showActions && (
          <>
            <TextInput
              value={noteById[e.id] ?? ''}
              onChangeText={(v) => setNoteById((prev) => ({ ...prev, [e.id]: v }))}
              placeholder="Note (optional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
            />
            <View style={styles.reviewActions}>
              <Pressable
                onPress={() => decide(e.id, 'approve')}
                disabled={busyId === e.id}
                style={[styles.reviewButton, styles.approveButton]}
              >
                <ThemedText style={styles.buttonLabel}>Approve</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => decide(e.id, 'reject')}
                disabled={busyId === e.id}
                style={[styles.reviewButton, styles.rejectButton]}
              >
                <ThemedText style={styles.buttonLabel}>Reject</ThemedText>
              </Pressable>
              {busyId === e.id && <ActivityIndicator size="small" />}
            </View>
          </>
        )}
      </ThemedView>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <Stack.Screen options={{ title: 'Expenses' }} />
      <ScrollView
        onScroll={({ nativeEvent }) => {
          if (adminTab !== 'all') return;
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) loadMoreAll();
        }}
        scrollEventThrottle={200}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {canAdd && (
        <View style={styles.chipRow}>
          <Pressable onPress={() => setMode('single')} style={[styles.modeChip, mode === 'single' && styles.chipActive]}>
            <ThemedText type="small" style={mode === 'single' ? styles.chipTextActive : undefined}>Single entry</ThemedText>
          </Pressable>
          <Pressable onPress={() => setMode('bulk')} style={[styles.modeChip, mode === 'bulk' && styles.chipActive]}>
            <ThemedText type="small" style={mode === 'bulk' ? styles.chipTextActive : undefined}>📄 Bulk statement</ThemedText>
          </Pressable>
        </View>
        )}

        {canAdd && (mode === 'single' ? (
          <View style={styles.form}>
            <ThemedText type="smallBold">Expenses</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Log what you spent. Bills are required over ₹200.</ThemedText>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Amount (₹)</ThemedText>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Category</ThemedText>
            <View style={styles.chipRow}>
              {EXPENSE_CATEGORIES.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, category === c && styles.chipActive]}>
                  <ThemedText type="small" style={category === c ? styles.chipTextActive : undefined}>
                    {c}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>What was it for</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Rapido to the parts shop"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />

            {billUpload.file ? (
              <View style={styles.attachRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{billUpload.file.name}</ThemedText>
                {isExtracting && <ActivityIndicator size="small" />}
                <Pressable onPress={() => { billUpload.reset(); setExtractNotice(null); }}><ThemedText type="small" themeColor="textSecondary">Remove</ThemedText></Pressable>
              </View>
            ) : (
              <View style={styles.attachRow}>
                <Pressable onPress={onPickBillCamera}><ThemedText type="link">+ Camera</ThemedText></Pressable>
                <Pressable onPress={onPickBillGallery}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
              </View>
            )}
            {extractNotice && <ThemedText type="small" style={styles.notice}>{extractNotice}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">
              A bill is required for expenses over ₹200.
            </ThemedText>

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            <Pressable onPress={onSubmit} disabled={!canSubmit || isSubmitting} style={[styles.button, { opacity: !canSubmit || isSubmitting ? 0.5 : 1 }]}>
              {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Submit expense</ThemedText>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <ThemedText type="smallBold">Bulk import from a statement photo</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Only a photo of a statement works here — spreadsheet upload needs a file picker not available in this
              app; use the dashboard for .xlsx/.csv files.
            </ThemedText>
            {statementUpload.file ? (
              <View style={styles.attachRow}>
                <ThemedText type="small" numberOfLines={1} style={styles.flex1}>{statementUpload.file.name}</ThemedText>
                {isExtractingStatement && <ActivityIndicator size="small" />}
                <Pressable onPress={() => { statementUpload.reset(); setBulkRows(null); setBulkNote(null); }}><ThemedText type="small" themeColor="textSecondary">Remove</ThemedText></Pressable>
              </View>
            ) : (
              <View style={styles.attachRow}>
                <Pressable onPress={onPickStatementCamera}><ThemedText type="link">+ Camera</ThemedText></Pressable>
                <Pressable onPress={onPickStatementGallery}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
              </View>
            )}
            {bulkNote && <ThemedText type="small" themeColor="textSecondary">{bulkNote}</ThemedText>}
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            {bulkRows && bulkRows.length > 0 && (
              <View style={styles.section}>
                {bulkRows.map((row, i) => (
                  <ThemedView key={i} type="backgroundElement" style={styles.card}>
                    {row.duplicateWarning && <ThemedText type="small" style={styles.error}>⚠ Possible duplicate</ThemedText>}
                    <View style={styles.attachRow}>
                      <TextInput value={row.date ?? ''} onChangeText={(v) => updateBulkRow(i, { date: v })} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary} style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]} />
                      <TextInput value={String(row.amount)} onChangeText={(v) => updateBulkRow(i, { amount: Number(v) || 0 })} placeholder="Amount" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]} />
                    </View>
                    <TextInput value={row.description} onChangeText={(v) => updateBulkRow(i, { description: v })} placeholder="Description" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} />
                    <View style={styles.chipRow}>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <Pressable key={c} onPress={() => updateBulkRow(i, { category: c })} style={[styles.chip, row.category === c && styles.chipActive]}>
                          <ThemedText type="small" style={row.category === c ? styles.chipTextActive : undefined}>{c}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable onPress={() => removeBulkRow(i)}><ThemedText type="small" style={styles.error}>Remove row</ThemedText></Pressable>
                  </ThemedView>
                ))}
                <ThemedText type="smallBold">Total: ₹{bulkTotal.toLocaleString('en-IN')} ({bulkRows.length} rows)</ThemedText>
                <Pressable onPress={onSaveBulk} disabled={isSavingBulk} style={styles.button}>
                  {isSavingBulk ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save all {bulkRows.length} expense(s)</ThemedText>}
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {(permStatus === 'idle' || permStatus === 'loading') && (
          <View style={styles.section}>
            <ActivityIndicator />
          </View>
        )}

        {permStatus === 'error' && (
          <View style={styles.section}>
            <ThemedText style={styles.error}>Couldn&apos;t load your permissions.</ThemedText>
            <Pressable onPress={() => refreshPermissions()} style={[styles.reviewButton, styles.approveButton]}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </View>
        )}

        {canVerify && (
          <View style={styles.section}>
            <View style={styles.chipRow}>
              <Pressable onPress={() => setAdminTab('pending')} style={[styles.modeChip, adminTab === 'pending' && styles.chipActive]}>
                <ThemedText type="small" style={adminTab === 'pending' ? styles.chipTextActive : undefined}>Pending</ThemedText>
              </Pressable>
              <Pressable onPress={() => setAdminTab('all')} style={[styles.modeChip, adminTab === 'all' && styles.chipActive]}>
                <ThemedText type="small" style={adminTab === 'all' ? styles.chipTextActive : undefined}>All</ThemedText>
              </Pressable>
              <Pressable onPress={() => setAdminTab('trends')} style={[styles.modeChip, adminTab === 'trends' && styles.chipActive]}>
                <ThemedText type="small" style={adminTab === 'trends' ? styles.chipTextActive : undefined}>Trends</ThemedText>
              </Pressable>
            </View>
            {reviewError && <ThemedText style={styles.error}>{reviewError}</ThemedText>}
            {reviewNotice && <ThemedText style={styles.notice}>{reviewNotice}</ThemedText>}

            {adminTab === 'pending' && (
              pending === null ? (
                <ActivityIndicator />
              ) : pending.length === 0 ? (
                <ThemedText themeColor="textSecondary">Nothing waiting for review.</ThemedText>
              ) : (
                pending.map((e) => renderAdminCard(e, true))
              )
            )}

            {adminTab === 'all' && (
              <>
                <View style={styles.chipRow}>
                  {(['PENDING', 'APPROVED', 'REJECTED'] as ExpenseStatus[]).map((s) => (
                    <Pressable key={s} onPress={() => setAllStatusFilter((cur) => (cur === s ? null : s))} style={[styles.chip, allStatusFilter === s && styles.chipActive]}>
                      <ThemedText type="small" style={allStatusFilter === s ? styles.chipTextActive : undefined}>{STATUS_LABEL[s]}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.chipRow}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <Pressable key={c} onPress={() => setAllCategoryFilter((cur) => (cur === c ? null : c))} style={[styles.chip, allCategoryFilter === c && styles.chipActive]}>
                      <ThemedText type="small" style={allCategoryFilter === c ? styles.chipTextActive : undefined}>{c}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <ThemedText type="small" themeColor="textSecondary">{allTotal} expense(s)</ThemedText>
                {allExpenses === null ? (
                  <ActivityIndicator />
                ) : allExpenses.length === 0 ? (
                  <ThemedText themeColor="textSecondary">No expenses match these filters.</ThemedText>
                ) : (
                  allExpenses.map((e) => renderAdminCard(e, e.status === 'PENDING'))
                )}
                {allLoadingMore && <ActivityIndicator style={styles.spinner} />}
              </>
            )}

            {adminTab === 'trends' && (
              summaryLoading ? (
                <ActivityIndicator />
              ) : summary === null ? (
                <ThemedText themeColor="textSecondary">No trends data.</ThemedText>
              ) : (
                <>
                  <View style={styles.kpiRow}>
                    <ThemedView type="backgroundElement" style={styles.kpiCard}>
                      <ThemedText type="small" themeColor="textSecondary">Total spend</ThemedText>
                      <ThemedText type="smallBold">₹{summary.total.toLocaleString('en-IN')}</ThemedText>
                    </ThemedView>
                    <ThemedView type="backgroundElement" style={styles.kpiCard}>
                      <ThemedText type="small" themeColor="textSecondary">Claims</ThemedText>
                      <ThemedText type="smallBold">{summary.count}</ThemedText>
                    </ThemedView>
                    <ThemedView type="backgroundElement" style={styles.kpiCard}>
                      <ThemedText type="small" themeColor="textSecondary">Average</ThemedText>
                      <ThemedText type="smallBold">₹{summary.count > 0 ? Math.round(summary.total / summary.count).toLocaleString('en-IN') : 0}</ThemedText>
                    </ThemedView>
                  </View>

                  <ThemedText type="smallBold" style={styles.fieldLabel}>By category</ThemedText>
                  {summary.byCategory.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">No data</ThemedText>
                  ) : (
                    summary.byCategory.map((c) => (
                      <View key={c.category} style={styles.tableRow}>
                        <ThemedText type="small" style={styles.flex1}>{c.category}</ThemedText>
                        <ThemedText type="small" style={styles.tabularNums}>₹{c.amount.toLocaleString('en-IN')}</ThemedText>
                      </View>
                    ))
                  )}

                  <ThemedText type="smallBold" style={styles.fieldLabel}>By person</ThemedText>
                  {summary.byPerson.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">No data</ThemedText>
                  ) : (
                    summary.byPerson.map((p) => (
                      <View key={p.id} style={styles.tableRow}>
                        <ThemedText type="small" style={styles.flex1}>{p.name}</ThemedText>
                        <ThemedText type="small" style={styles.tabularNums}>₹{p.total.toLocaleString('en-IN')}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>{p.count}</ThemedText>
                      </View>
                    ))
                  )}
                </>
              )
            )}
          </View>
        )}

        <View style={styles.section}>
          <ThemedText type="smallBold">Your expenses</ThemedText>
          {expenses === null && <ActivityIndicator />}
          {expenses?.length === 0 && <ThemedText themeColor="textSecondary">Nothing logged yet.</ThemedText>}
          {expenses?.map((e) => (
            <ThemedView key={e.id} type="backgroundElement" style={styles.card}>
              <View style={styles.cardTop}>
                <ThemedText type="smallBold" style={styles.tabularNums}>
                  ₹{e.amount.toLocaleString('en-IN')} · {e.category}
                </ThemedText>
                <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[e.status] }]}>
                  <ThemedText type="small" style={styles.statusText}>
                    {STATUS_LABEL[e.status]}
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {e.description} · {formatDate(e.date ?? e.createdAt)}
              </ThemedText>
              {e.reviewNote != null && e.reviewNote !== '' && (
                <ThemedText type="small" themeColor="textSecondary">
                  <ThemedText type="smallBold">{e.reviewedBy?.name ?? 'Reviewer'}</ThemedText>: {e.reviewNote}
                </ThemedText>
              )}
              {renderDetailToggle(e)}
              {expandedId === e.id && renderDetailPanel(e)}
            </ThemedView>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  form: { gap: Spacing.two },
  fieldLabel: { marginTop: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.15)' },
  chipActive: { backgroundColor: '#7A1C2E' },
  chipTextActive: { color: '#ffffff' },
  input: { height: 48, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  button: { height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  section: { gap: Spacing.two },
  reviewActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one, alignItems: 'center' },
  reviewButton: { height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  approveButton: { backgroundColor: '#167A48' },
  rejectButton: { backgroundColor: '#B83030' },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  statusText: { color: '#ffffff' },
  tabularNums: { fontVariant: ['tabular-nums'] },
  modeChip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.15)' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  detailPanel: { gap: Spacing.one, marginTop: Spacing.one, paddingTop: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)' },
  spinner: { marginTop: Spacing.two },
  kpiRow: { flexDirection: 'row', gap: Spacing.two },
  kpiCard: { flex: 1, borderRadius: Spacing.three, padding: Spacing.two, gap: 2 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,0.2)' },
});
