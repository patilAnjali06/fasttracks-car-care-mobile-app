import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
  createBankAccount,
  createEMI,
  createPaymentReminder,
  deactivateBankAccount,
  deleteBankAccountDocument,
  deleteEMI,
  deleteEmiDocument,
  deletePaymentReminder,
  fetchBankAccountDocumentDataUri,
  fetchBankAccountDocuments,
  fetchBankAccountReveals,
  fetchBankAccounts,
  fetchBankBalanceHistory,
  fetchEmailCheckStatus,
  fetchEmiDocumentDataUri,
  fetchEmiDocuments,
  fetchEmis,
  fetchPaymentReminders,
  getErrorMessage,
  logEmailCheck,
  markEMIPaid,
  markPaymentReminderPaid,
  revealBankAccountNumber,
  updateBankAccount,
  updateBankAccountBalance,
  updateEMI,
  uploadBankAccountDocument,
  uploadEmiDocument,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { pickFromCamera, pickFromGallery, useFileUpload } from '@/lib/upload';
import type {
  AccountDocument, BankAccount, BankAccountRevealLog, BankAccountType, BankBalanceHistoryEntry,
  CreateBankAccountInput, CreateEMIInput, CreatePaymentReminderInput, EMI, EmailCheckState,
  PaymentReminder, PaymentReminderCategory, PaymentRecurrence,
} from '@/types/api';

const DOC_UPLOAD_RULES = {
  allowedMimeTypes: [
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  maxSizeBytes: 15 * 1024 * 1024,
};

// canAccess=requireRoles(OWNER,ACCOUNTING) (backend/src/routes/
// accounts_route.ts) — same static gate for every read AND write route in
// this file, no narrower write-only gate. Email Check (GET/POST /accounts/
// email-check) shares the same gate; GET /email-check/all is OWNER-only and
// unused here (that's a separate all-staff audit view this screen doesn't
// need — each user only ever sees their own log via the plain GET).
//
// CORRECTED 2026-09-28 (re-verification sweep): reveal-log/balance-history
// views and EMI edit were previously framed as deferred scope cuts — added
// here. Reveal itself is server-logged every time (BankAccountReveal row:
// who + when), same audited pattern the dashboard uses — not a client-side
// bypass of the masking.
const ROLES = ['OWNER', 'ACCOUNTING'];
const ACCOUNT_TYPES: BankAccountType[] = ['SAVINGS', 'CURRENT', 'OD'];
const REMINDER_CATEGORIES: PaymentReminderCategory[] = [
  'ELECTRICITY', 'RENT', 'INTERNET', 'INSURANCE', 'LICENSE', 'SUBSCRIPTION', 'VENDOR_DUE', 'TAX', 'SALARY', 'OTHER',
];
const RECURRENCES: PaymentRecurrence[] = ['ONE_OFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL'];

function formatCurrency(n: number | null) {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

type Tab = 'bank' | 'emi' | 'reminders' | 'email';

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<Tab>('bank');
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [emis, setEmis] = useState<EMI[] | null>(null);
  const [reminders, setReminders] = useState<PaymentReminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Forms
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [bankForm, setBankForm] = useState({ nickname: '', bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '', branch: '', accountType: 'SAVINGS' as BankAccountType });
  const [revealedNumbers, setRevealedNumbers] = useState<Record<string, string>>({});
  const [balanceEditId, setBalanceEditId] = useState<string | null>(null);
  const [balanceInput, setBalanceInput] = useState('');

  const [showEmiForm, setShowEmiForm] = useState(false);
  const [editingEmiId, setEditingEmiId] = useState<string | null>(null);
  const [emiForm, setEmiForm] = useState({ lenderName: '', loanPurpose: '', emiAmount: '', debitDay: '', totalTenure: '', remainingBalance: '' });

  // Reveal-log / balance-history — expandable per bank account.
  const [historyPanelKey, setHistoryPanelKey] = useState<string | null>(null);
  const [revealLog, setRevealLog] = useState<BankAccountRevealLog[] | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BankBalanceHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Email Check — daily-check calendar/streak tracker, own tab.
  const [emailCheck, setEmailCheck] = useState<EmailCheckState | null>(null);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderForm, setReminderForm] = useState({ payeeName: '', category: 'OTHER' as PaymentReminderCategory, amount: '', dueDate: '', recurrence: 'ONE_OFF' as PaymentRecurrence });

  // Documents — shared panel for bank accounts and EMIs, keyed by "kind:id".
  const [docsPanelKey, setDocsPanelKey] = useState<string | null>(null);
  const [docsPanelKind, setDocsPanelKind] = useState<'bank' | 'emi' | null>(null);
  const [docsPanelId, setDocsPanelId] = useState<string | null>(null);
  const [docs, setDocs] = useState<AccountDocument[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState('');
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const docUpload = useFileUpload(DOC_UPLOAD_RULES);

  const loadDocs = async (kind: 'bank' | 'emi', id: string) => {
    setDocsError(null);
    try {
      setDocs(kind === 'bank' ? await fetchBankAccountDocuments(id) : await fetchEmiDocuments(id));
    } catch (err: any) {
      setDocsError(getErrorMessage(err, 'Could not load documents.'));
    }
  };

  const toggleDocsPanel = (kind: 'bank' | 'emi', id: string) => {
    const key = `${kind}:${id}`;
    if (docsPanelKey === key) {
      setDocsPanelKey(null);
      setDocsPanelKind(null);
      setDocsPanelId(null);
      setDocs(null);
      docUpload.reset();
      return;
    }
    setDocsPanelKey(key);
    setDocsPanelKind(kind);
    setDocsPanelId(id);
    setDocLabel('');
    setDocs(null);
    docUpload.reset();
    loadDocs(kind, id);
  };

  const onPickDocCamera = async () => {
    const file = await pickFromCamera();
    if (file) docUpload.pick(file);
  };
  const onPickDocGallery = async () => {
    const file = await pickFromGallery();
    if (file) docUpload.pick(file);
  };

  const doUploadDoc = () => {
    if (!docsPanelKind || !docsPanelId) return;
    if (docsPanelKind === 'emi' && !docLabel.trim()) {
      setDocsError('A document label is required for EMI documents.');
      return;
    }
    const kind = docsPanelKind, id = docsPanelId;
    return docUpload
      .upload((file, ctrl) => (kind === 'bank' ? uploadBankAccountDocument(id, file, docLabel.trim() || undefined, ctrl) : uploadEmiDocument(id, file, docLabel.trim(), ctrl)))
      .then((result) => {
        if (result) {
          docUpload.reset();
          setDocLabel('');
          loadDocs(kind, id);
        }
      });
  };

  const onOpenDoc = async (doc: AccountDocument) => {
    if (!docsPanelKind) return;
    setOpeningDocId(doc.id);
    setDocsError(null);
    try {
      const dataUri = docsPanelKind === 'bank'
        ? await fetchBankAccountDocumentDataUri(doc.id, doc.mimeType)
        : await fetchEmiDocumentDataUri(doc.id, doc.mimeType);
      await Linking.openURL(dataUri);
    } catch (err: any) {
      setDocsError(getErrorMessage(err, 'Could not open this document.'));
    } finally {
      setOpeningDocId(null);
    }
  };

  const onDeleteDoc = (doc: AccountDocument) => {
    if (!docsPanelKind || !docsPanelId) return;
    const kind = docsPanelKind, id = docsPanelId;
    Alert.alert('Delete document', `Delete "${doc.filename}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeletingDocId(doc.id);
          setDocsError(null);
          try {
            await (kind === 'bank' ? deleteBankAccountDocument(doc.id) : deleteEmiDocument(doc.id));
            await loadDocs(kind, id);
          } catch (err: any) {
            setDocsError(getErrorMessage(err, 'Could not delete this document.'));
          } finally {
            setDeletingDocId(null);
          }
        },
      },
    ]);
  };

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [a, e, r] = await Promise.all([fetchBankAccounts(), fetchEmis(), fetchPaymentReminders()]);
      setAccounts(a);
      setEmis(e);
      setReminders(r);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load accounts data.'));
    }
  }, [isAuthorized]);

  const loadEmailCheck = useCallback(async () => {
    setError(null);
    try {
      setEmailCheck(await fetchEmailCheckStatus());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load email check status.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'email') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on tab-open
      loadEmailCheck();
    }
  }, [tab, loadEmailCheck]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    if (tab === 'email') await loadEmailCheck();
    else await load();
    setIsRefreshing(false);
  };

  const onLogEmailCheck = async () => {
    setIsCheckingEmail(true);
    setError(null);
    try {
      await logEmailCheck();
      await loadEmailCheck();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not log this check.'));
    } finally {
      setIsCheckingEmail(false);
    }
  };

  // ── Bank accounts ─────────────────────────────────────────────────────────
  const resetBankForm = () => setBankForm({ nickname: '', bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '', branch: '', accountType: 'SAVINGS' });

  const openBankCreate = () => { resetBankForm(); setEditingAccount(null); setShowBankForm(true); };
  const openBankEdit = (acc: BankAccount) => {
    setBankForm({ nickname: acc.nickname, bankName: acc.bankName, accountHolderName: acc.accountHolderName, accountNumber: acc.accountNumber, ifscCode: acc.ifscCode, branch: acc.branch, accountType: acc.accountType as BankAccountType });
    setEditingAccount(acc);
    setShowBankForm(true);
  };

  const onSaveBank = async () => {
    const { nickname, bankName, accountHolderName, accountNumber, ifscCode, branch, accountType } = bankForm;
    if (!nickname.trim() || !bankName.trim() || !accountHolderName.trim() || !accountNumber.trim() || !ifscCode.trim() || !branch.trim()) {
      setError('All fields are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const input: CreateBankAccountInput = { nickname: nickname.trim(), bankName: bankName.trim(), accountHolderName: accountHolderName.trim(), accountNumber: accountNumber.trim(), ifscCode: ifscCode.trim(), branch: branch.trim(), accountType };
      if (editingAccount) await updateBankAccount(editingAccount.id, input);
      else await createBankAccount(input);
      setShowBankForm(false);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save this bank account.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onDeactivateBank = (acc: BankAccount) => {
    Alert.alert('Deactivate account', `Deactivate ${acc.nickname}? It stays on record but is marked inactive.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: async () => {
        try { await deactivateBankAccount(acc.id); await load(); } catch (err: any) { setError(getErrorMessage(err, 'Could not deactivate this account.')); }
      } },
    ]);
  };

  const onReveal = async (acc: BankAccount) => {
    try {
      const res = await revealBankAccountNumber(acc.id);
      setRevealedNumbers((prev) => ({ ...prev, [acc.id]: res.accountNumber }));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not reveal this account number.'));
    }
  };

  const toggleHistoryPanel = async (acc: BankAccount) => {
    if (historyPanelKey === acc.id) {
      setHistoryPanelKey(null);
      setRevealLog(null);
      setBalanceHistory(null);
      return;
    }
    setHistoryPanelKey(acc.id);
    setRevealLog(null);
    setBalanceHistory(null);
    setHistoryError(null);
    try {
      const [reveals, balances] = await Promise.all([fetchBankAccountReveals(acc.id), fetchBankBalanceHistory(acc.id)]);
      setRevealLog(reveals);
      setBalanceHistory(balances);
    } catch (err: any) {
      setHistoryError(getErrorMessage(err, 'Could not load history.'));
    }
  };

  const onSaveBalance = async (acc: BankAccount) => {
    const balance = Number(balanceInput);
    if (Number.isNaN(balance)) { setError('Enter a valid balance.'); return; }
    setIsSaving(true);
    setError(null);
    try {
      await updateBankAccountBalance(acc.id, balance);
      setBalanceEditId(null);
      setBalanceInput('');
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update the balance.'));
    } finally {
      setIsSaving(false);
    }
  };

  // ── EMIs ──────────────────────────────────────────────────────────────────
  const resetEmiForm = () => {
    setEditingEmiId(null);
    setEmiForm({ lenderName: '', loanPurpose: '', emiAmount: '', debitDay: '', totalTenure: '', remainingBalance: '' });
  };

  const openEmiEdit = (emi: EMI) => {
    setEditingEmiId(emi.id);
    setEmiForm({
      lenderName: emi.lenderName, loanPurpose: emi.loanPurpose, emiAmount: String(emi.emiAmount),
      debitDay: String(emi.debitDay), totalTenure: String(emi.totalTenure), remainingBalance: String(emi.remainingBalance),
    });
    setShowEmiForm(true);
  };

  const onSaveEmi = async () => {
    const { lenderName, loanPurpose, emiAmount, debitDay, totalTenure, remainingBalance } = emiForm;
    const amt = Number(emiAmount), day = Number(debitDay), tenure = Number(totalTenure), remaining = Number(remainingBalance);
    if (!lenderName.trim() || !loanPurpose.trim() || !amt || !day || !tenure || Number.isNaN(remaining)) {
      setError('Lender, purpose, EMI amount, debit day, tenure, and remaining balance are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const input: CreateEMIInput = { lenderName: lenderName.trim(), loanPurpose: loanPurpose.trim(), emiAmount: amt, debitDay: day, totalTenure: tenure, remainingBalance: remaining };
      if (editingEmiId) await updateEMI(editingEmiId, input);
      else await createEMI(input);
      resetEmiForm();
      setShowEmiForm(false);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, editingEmiId ? 'Could not save this EMI.' : 'Could not create this EMI.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onMarkEmiPaid = (emi: EMI) => {
    Alert.alert('Mark this month paid', `Record this month's ${formatCurrency(emi.emiAmount)} EMI payment for ${emi.lenderName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark paid', onPress: async () => {
        try { await markEMIPaid(emi.id); await load(); } catch (err: any) { setError(getErrorMessage(err, 'Could not mark this EMI paid.')); }
      } },
    ]);
  };

  const onDeleteEmi = (emi: EMI) => {
    Alert.alert('Delete EMI', `Delete ${emi.lenderName}'s EMI record? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteEMI(emi.id); await load(); } catch (err: any) { setError(getErrorMessage(err, 'Could not delete this EMI.')); }
      } },
    ]);
  };

  // ── Reminders ─────────────────────────────────────────────────────────────
  const onCreateReminder = async () => {
    const { payeeName, category, amount, dueDate, recurrence } = reminderForm;
    if (!payeeName.trim() || !dueDate.trim()) {
      setError('Payee name and due date (YYYY-MM-DD) are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const input: CreatePaymentReminderInput = { payeeName: payeeName.trim(), category, dueDate: dueDate.trim(), recurrence, amount: amount ? Number(amount) : undefined };
      await createPaymentReminder(input);
      setReminderForm({ payeeName: '', category: 'OTHER', amount: '', dueDate: '', recurrence: 'ONE_OFF' });
      setShowReminderForm(false);
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not create this reminder.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onMarkReminderPaid = (r: PaymentReminder) => {
    Alert.alert('Mark as paid', `Mark ${r.payeeName} as paid? ${r.recurrence !== 'ONE_OFF' ? 'This will roll the due date forward for the next cycle.' : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark paid', onPress: async () => {
        try { await markPaymentReminderPaid(r.id); await load(); } catch (err: any) { setError(getErrorMessage(err, 'Could not mark this reminder paid.')); }
      } },
    ]);
  };

  const onDeleteReminder = (r: PaymentReminder) => {
    Alert.alert('Delete reminder', `Delete the reminder for ${r.payeeName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deletePaymentReminder(r.id); await load(); } catch (err: any) { setError(getErrorMessage(err, 'Could not delete this reminder.')); }
      } },
    ]);
  };

  const renderDocsPanel = () => (
    <View style={styles.docsPanel}>
      {docsError && <ThemedText style={styles.error}>{docsError}</ThemedText>}
      {docs === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : docs.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No documents yet.</ThemedText>
      ) : (
        docs.map((doc) => (
          <View key={doc.id} style={styles.docRow}>
            <Pressable onPress={() => onOpenDoc(doc)} disabled={openingDocId === doc.id} style={styles.flex1}>
              {openingDocId === doc.id ? <ActivityIndicator size="small" /> : (
                <ThemedText type="link" numberOfLines={1} ellipsizeMode="tail">
                  {doc.label ? `${doc.label} — ` : ''}{doc.filename}
                </ThemedText>
              )}
            </Pressable>
            <Pressable onPress={() => onDeleteDoc(doc)} disabled={deletingDocId === doc.id}>
              {deletingDocId === doc.id ? <ActivityIndicator size="small" /> : <ThemedText style={{ color: '#B83030' }}>✕</ThemedText>}
            </Pressable>
          </View>
        ))
      )}

      <TextInput
        value={docLabel}
        onChangeText={setDocLabel}
        placeholder={docsPanelKind === 'emi' ? 'Document label (required)' : 'Document label (optional)'}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.background, marginTop: Spacing.two }]}
      />

      {docUpload.file ? (
        <View style={styles.inlineRow}>
          <ThemedText type="small" numberOfLines={1} ellipsizeMode="tail" style={styles.flex1}>{docUpload.file.name}</ThemedText>
          {docUpload.status === 'uploading' ? (
            <View style={styles.inlineRow}>
              <ThemedText type="small" themeColor="textSecondary">{docUpload.progress != null ? `${docUpload.progress}%` : 'Uploading…'}</ThemedText>
              <Pressable onPress={docUpload.cancel}><ThemedText type="link">Cancel</ThemedText></Pressable>
            </View>
          ) : docUpload.status === 'error' ? (
            <Pressable onPress={docUpload.retry}><ThemedText type="link">Retry</ThemedText></Pressable>
          ) : (
            <Pressable onPress={doUploadDoc} style={styles.smallButton}><ThemedText style={styles.buttonLabel}>Upload</ThemedText></Pressable>
          )}
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Pressable onPress={onPickDocCamera}><ThemedText type="link">+ Camera</ThemedText></Pressable>
          <Pressable onPress={onPickDocGallery}><ThemedText type="link">+ Gallery</ThemedText></Pressable>
        </View>
      )}
      {docUpload.error && <ThemedText style={styles.error}>{docUpload.error}</ThemedText>}
    </View>
  );

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">Accounts is only available to Owner or Accounting accounts.</ThemedText>
      </ThemedView>
    );
  }

  if (showBankForm) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: editingAccount ? 'Edit Account' : 'New Bank Account' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowBankForm(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          {(['nickname', 'bankName', 'accountHolderName', 'accountNumber', 'ifscCode', 'branch'] as const).map((field) => (
            <TextInput
              key={field}
              value={bankForm[field]}
              onChangeText={(t) => setBankForm({ ...bankForm, [field]: t })}
              placeholder={{ nickname: 'Nickname *', bankName: 'Bank name *', accountHolderName: 'Account holder name *', accountNumber: 'Account number *', ifscCode: 'IFSC code *', branch: 'Branch *' }[field]}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize={field === 'ifscCode' ? 'characters' : 'words'}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
          ))}
          <View style={styles.chipRow}>
            {ACCOUNT_TYPES.map((t) => (
              <Pressable key={t} onPress={() => setBankForm({ ...bankForm, accountType: t })} style={[styles.chip, { backgroundColor: bankForm.accountType === t ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={bankForm.accountType === t ? styles.chipLabelActive : undefined}>{t}</ThemedText>
              </Pressable>
            ))}
          </View>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <Pressable onPress={onSaveBank} disabled={isSaving} style={styles.button}>
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>{editingAccount ? 'Save changes' : 'Add account'}</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showEmiForm) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: editingEmiId ? 'Edit EMI' : 'New EMI' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => { setShowEmiForm(false); resetEmiForm(); }}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          <TextInput value={emiForm.lenderName} onChangeText={(t) => setEmiForm({ ...emiForm, lenderName: t })} placeholder="Lender name *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={emiForm.loanPurpose} onChangeText={(t) => setEmiForm({ ...emiForm, loanPurpose: t })} placeholder="Loan purpose *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={emiForm.emiAmount} onChangeText={(t) => setEmiForm({ ...emiForm, emiAmount: t })} placeholder="EMI amount per month *" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={emiForm.debitDay} onChangeText={(t) => setEmiForm({ ...emiForm, debitDay: t })} placeholder="Debit day of month (1-31) *" placeholderTextColor={theme.textSecondary} keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={emiForm.totalTenure} onChangeText={(t) => setEmiForm({ ...emiForm, totalTenure: t })} placeholder="Total tenure (months) *" placeholderTextColor={theme.textSecondary} keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={emiForm.remainingBalance} onChangeText={(t) => setEmiForm({ ...emiForm, remainingBalance: t })} placeholder="Remaining balance *" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <Pressable onPress={onSaveEmi} disabled={isSaving} style={styles.button}>
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>{editingEmiId ? 'Save changes' : 'Add EMI'}</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (showReminderForm) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'New Reminder' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setShowReminderForm(false)}><ThemedText type="small">← Cancel</ThemedText></Pressable>
          <TextInput value={reminderForm.payeeName} onChangeText={(t) => setReminderForm({ ...reminderForm, payeeName: t })} placeholder="Payee name *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Category</ThemedText>
          <View style={styles.chipRow}>
            {REMINDER_CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setReminderForm({ ...reminderForm, category: c })} style={[styles.chip, { backgroundColor: reminderForm.category === c ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={reminderForm.category === c ? styles.chipLabelActive : undefined}>{c}</ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput value={reminderForm.amount} onChangeText={(t) => setReminderForm({ ...reminderForm, amount: t })} placeholder="Amount (optional)" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <TextInput value={reminderForm.dueDate} onChangeText={(t) => setReminderForm({ ...reminderForm, dueDate: t })} placeholder="Due date (YYYY-MM-DD) *" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Recurrence</ThemedText>
          <View style={styles.chipRow}>
            {RECURRENCES.map((r) => (
              <Pressable key={r} onPress={() => setReminderForm({ ...reminderForm, recurrence: r })} style={[styles.chip, { backgroundColor: reminderForm.recurrence === r ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={reminderForm.recurrence === r ? styles.chipLabelActive : undefined}>{r}</ThemedText>
              </Pressable>
            ))}
          </View>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <Pressable onPress={onCreateReminder} disabled={isSaving} style={styles.button}>
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Add reminder</ThemedText>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Accounts' }} />
      <View style={styles.tabRow}>
        {(['bank', 'emi', 'reminders', 'email'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabButton, { backgroundColor: tab === t ? theme.primary : theme.backgroundElement }]}>
            <ThemedText type="small" style={tab === t ? styles.chipLabelActive : undefined}>{t === 'bank' ? 'Bank' : t === 'emi' ? 'EMIs' : t === 'reminders' ? 'Reminders' : 'Email Check'}</ThemedText>
          </Pressable>
        ))}
      </View>
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {accounts === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {tab === 'bank' && (
            <>
              <Pressable onPress={openBankCreate} style={styles.newButton}><ThemedText style={styles.buttonLabel}>+ New Bank Account</ThemedText></Pressable>
              {accounts.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No bank accounts on file.</ThemedText>
              ) : (
                accounts.map((acc) => (
                  <ThemedView key={acc.id} type="backgroundElement" style={styles.row}>
                    <ThemedText type="smallBold">{acc.bankName} — {acc.nickname}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                      {revealedNumbers[acc.id] ?? acc.maskedAccountNumber} · {acc.accountType}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                      Balance {formatCurrency(acc.currentBalance)} · {acc.isActive ? 'Active' : 'Inactive'}
                    </ThemedText>
                    {balanceEditId === acc.id ? (
                      <View style={styles.inlineRow}>
                        <TextInput value={balanceInput} onChangeText={setBalanceInput} placeholder="New balance" placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" style={[styles.input, styles.flex1, { color: theme.text, backgroundColor: theme.background }]} />
                        <Pressable onPress={() => onSaveBalance(acc)} style={styles.smallButton}><ThemedText style={styles.buttonLabel}>Save</ThemedText></Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <Pressable onPress={() => openBankEdit(acc)}><ThemedText type="small" themeColor="textSecondary">Edit</ThemedText></Pressable>
                        <Pressable onPress={() => { setBalanceEditId(acc.id); setBalanceInput(String(acc.currentBalance)); }}><ThemedText type="small" themeColor="textSecondary">Update balance</ThemedText></Pressable>
                        {!revealedNumbers[acc.id] && <Pressable onPress={() => onReveal(acc)}><ThemedText type="small" themeColor="textSecondary">Reveal</ThemedText></Pressable>}
                        <Pressable onPress={() => toggleDocsPanel('bank', acc.id)}><ThemedText type="small" themeColor="textSecondary">{docsPanelKey === `bank:${acc.id}` ? 'Hide docs' : 'Documents'}</ThemedText></Pressable>
                        <Pressable onPress={() => toggleHistoryPanel(acc)}><ThemedText type="small" themeColor="textSecondary">{historyPanelKey === acc.id ? 'Hide history' : 'History'}</ThemedText></Pressable>
                        {acc.isActive && <Pressable onPress={() => onDeactivateBank(acc)}><ThemedText type="small" style={{ color: '#B83030' }}>Deactivate</ThemedText></Pressable>}
                      </View>
                    )}
                    {docsPanelKey === `bank:${acc.id}` && renderDocsPanel()}
                    {historyPanelKey === acc.id && (
                      <View style={styles.historyPanel}>
                        {historyError && <ThemedText style={styles.error}>{historyError}</ThemedText>}
                        {revealLog === null || balanceHistory === null ? (
                          <ActivityIndicator size="small" />
                        ) : (
                          <>
                            <ThemedText type="smallBold">Reveal log</ThemedText>
                            {revealLog.length === 0 ? (
                              <ThemedText type="small" themeColor="textSecondary">No reveals on record</ThemedText>
                            ) : (
                              revealLog.map((r) => (
                                <ThemedText key={r.id} type="small" themeColor="textSecondary">
                                  {r.revealedBy.name} · {new Date(r.createdAt).toLocaleString('en-IN')}
                                </ThemedText>
                              ))
                            )}
                            <ThemedText type="smallBold" style={styles.fieldLabel}>Balance history</ThemedText>
                            {balanceHistory.length === 0 ? (
                              <ThemedText type="small" themeColor="textSecondary">No balance updates on record</ThemedText>
                            ) : (
                              balanceHistory.map((b) => (
                                <ThemedText key={b.id} type="small" themeColor="textSecondary">
                                  {formatCurrency(b.balance)} · {b.updatedBy.name} · {new Date(b.createdAt).toLocaleString('en-IN')}
                                </ThemedText>
                              ))
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </ThemedView>
                ))
              )}
            </>
          )}

          {tab === 'emi' && (
            <>
              <Pressable onPress={() => setShowEmiForm(true)} style={styles.newButton}><ThemedText style={styles.buttonLabel}>+ New EMI</ThemedText></Pressable>
              {emis === null || emis.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No EMIs on file.</ThemedText>
              ) : (
                emis.map((emi) => (
                  <ThemedView key={emi.id} type="backgroundElement" style={styles.row}>
                    <ThemedText type="smallBold">{emi.lenderName} — {emi.loanPurpose}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                      {formatCurrency(emi.emiAmount)}/mo · {emi.emisPaid}/{emi.totalTenure} paid · {emi.status}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>Remaining {formatCurrency(emi.remainingBalance)}</ThemedText>
                    <View style={styles.actionRow}>
                      <Pressable onPress={() => openEmiEdit(emi)}><ThemedText type="small" themeColor="textSecondary">Edit</ThemedText></Pressable>
                      {emi.status === 'ACTIVE' && <Pressable onPress={() => onMarkEmiPaid(emi)}><ThemedText type="small" themeColor="textSecondary">Mark this month paid</ThemedText></Pressable>}
                      <Pressable onPress={() => toggleDocsPanel('emi', emi.id)}><ThemedText type="small" themeColor="textSecondary">{docsPanelKey === `emi:${emi.id}` ? 'Hide docs' : 'Documents'}</ThemedText></Pressable>
                      {emi.status === 'ACTIVE' && <Pressable onPress={() => onDeleteEmi(emi)}><ThemedText type="small" style={{ color: '#B83030' }}>Delete</ThemedText></Pressable>}
                    </View>
                    {docsPanelKey === `emi:${emi.id}` && renderDocsPanel()}
                  </ThemedView>
                ))
              )}
            </>
          )}

          {tab === 'reminders' && (
            <>
              <Pressable onPress={() => setShowReminderForm(true)} style={styles.newButton}><ThemedText style={styles.buttonLabel}>+ New Reminder</ThemedText></Pressable>
              {reminders === null || reminders.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No reminders on file.</ThemedText>
              ) : (
                reminders.map((r) => (
                  <ThemedView key={r.id} type="backgroundElement" style={styles.row}>
                    <ThemedText type="smallBold">{r.payeeName}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.tabularNums}>
                      {r.category} · {r.amount != null ? formatCurrency(r.amount) : 'Variable'} · {r.recurrence}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: r.isOverdue ? '#B83030' : r.isDue ? '#A86018' : theme.textSecondary }}>
                      Due {new Date(r.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {r.status}
                    </ThemedText>
                    {r.status !== 'PAID' && (
                      <View style={styles.actionRow}>
                        <Pressable onPress={() => onMarkReminderPaid(r)}><ThemedText type="small" themeColor="textSecondary">Mark paid</ThemedText></Pressable>
                        <Pressable onPress={() => onDeleteReminder(r)}><ThemedText type="small" style={{ color: '#B83030' }}>Delete</ThemedText></Pressable>
                      </View>
                    )}
                  </ThemedView>
                ))
              )}
            </>
          )}

          {tab === 'email' && (
            emailCheck === null ? (
              <ActivityIndicator style={styles.spinner} />
            ) : (
              <EmailCheckSection state={emailCheck} isChecking={isCheckingEmail} onCheck={onLogEmailCheck} />
            )
          )}
        </ScrollView>
      )}
    </>
  );
}

// Daily-check streak tracker, matching the dashboard's EmailCheckTab —
// today's checkbox, checked/missed/90-day-rate stats, and a compact
// day-by-day strip (last 30 days; the dashboard's 90-day grid is condensed
// for phone width) instead of the dashboard's 13-column calendar grid.
function EmailCheckSection({ state, isChecking, onCheck }: { state: EmailCheckState; isChecking: boolean; onCheck: () => void }) {
  const theme = useTheme();
  const { todayStr, days } = useMemo(() => {
    const nowMs = new Date().getTime();
    const istNow = new Date(nowMs + 5.5 * 60 * 60 * 1000);
    const today = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}-${String(istNow.getUTCDate()).padStart(2, '0')}`;
    const checkedDates = new Set(state.history.map((h) => h.date.slice(0, 10)));
    const result: { date: string; checked: boolean; isFuture: boolean }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(nowMs + 5.5 * 60 * 60 * 1000 - i * 86400000);
      const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      result.push({ date: ds, checked: checkedDates.has(ds), isFuture: ds > today });
    }
    return { todayStr: today, days: result };
  }, [state.history]);
  const checkedCount = days.filter((d) => d.checked).length;
  const missedCount = days.filter((d) => !d.checked && !d.isFuture).length;
  const rate = Math.round((checkedCount / Math.max(1, checkedCount + missedCount)) * 100);

  return (
    <>
      <ThemedView type="backgroundElement" style={styles.row}>
        <Pressable onPress={!state.checkedToday ? onCheck : undefined} disabled={state.checkedToday || isChecking} style={styles.actionRow}>
          <ThemedText type="smallBold">{state.checkedToday ? '✅ Email checked today' : '📧 Mark email as checked'}</ThemedText>
          {isChecking && <ActivityIndicator size="small" />}
        </Pressable>
        {state.checkedToday && state.todayLog ? (
          <ThemedText type="small" style={{ color: '#167A48' }}>Logged at {new Date(state.todayLog.checkedAt).toLocaleTimeString('en-IN')}</ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">Tap to confirm you&apos;ve checked email today</ThemedText>
        )}
      </ThemedView>
      <View style={styles.emailStatsRow}>
        <ThemedView type="backgroundElement" style={styles.emailStatCard}>
          <ThemedText type="subtitle" style={{ color: '#167A48' }}>{checkedCount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Checked</ThemedText>
        </ThemedView>
        <ThemedView type="backgroundElement" style={styles.emailStatCard}>
          <ThemedText type="subtitle" style={{ color: '#B83030' }}>{missedCount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Missed</ThemedText>
        </ThemedView>
        <ThemedView type="backgroundElement" style={styles.emailStatCard}>
          <ThemedText type="subtitle">{rate}%</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">30-day rate</ThemedText>
        </ThemedView>
      </View>
      <ThemedText type="smallBold" style={styles.fieldLabel}>Last 30 days</ThemedText>
      <View style={styles.heatmapRow}>
        {days.map((d) => (
          <View
            key={d.date}
            style={[
              styles.heatmapCell,
              {
                backgroundColor: d.isFuture ? 'transparent' : d.checked ? '#167A48' : d.date === todayStr ? 'rgba(232,168,40,0.3)' : 'rgba(184,48,48,0.3)',
                borderColor: d.date === todayStr ? '#A86018' : theme.border,
                borderWidth: d.date === todayStr ? 1 : 0,
              },
            ]}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  tabularNums: { fontVariant: ['tabular-nums'] },
  tabRow: { flexDirection: 'row', gap: Spacing.one, padding: Spacing.three, paddingBottom: 0 },
  tabButton: { flex: 1, height: 40, borderRadius: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  button: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  smallButton: { height: 40, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15, marginTop: Spacing.two },
  fieldLabel: { marginTop: Spacing.two },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.two },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.one },
  inlineRow: { flexDirection: 'row', gap: Spacing.one, alignItems: 'center', marginTop: Spacing.one },
  docsPanel: { marginTop: Spacing.two, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)', gap: Spacing.one },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  historyPanel: { marginTop: Spacing.two, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.2)', gap: 2 },
  emailStatsRow: { flexDirection: 'row', gap: Spacing.two },
  emailStatCard: { flex: 1, borderRadius: Spacing.three, padding: Spacing.two, alignItems: 'center', gap: 2 },
  heatmapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  heatmapCell: { width: 18, height: 18, borderRadius: 3 },
});
