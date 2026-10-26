import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { CardVisual, PasswordCard, PWD_CATEGORIES } from '@/components/password-manager/entry-cards';
import { CardFormView, PasswordForm } from '@/components/password-manager/entry-forms';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createCardEntry,
  createPasswordEntry,
  deleteCardEntry,
  deletePasswordEntry,
  fetchCardEntries,
  fetchPasswordEntries,
  getErrorMessage,
  revealCardCvv,
  revealCardNumber,
  revealPasswordEntry,
  updateCardEntry,
  updatePasswordEntry,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CardEntry, CardEntryInput, PasswordEntry, PasswordEntryInput } from '@/types/api';

// Both /passwords and /cards are requireRoles(OWNER, STORE_MANAGER,
// INVENTORY_MANAGER) (backend/src/routes/passwords.ts, cards.ts) — a static
// role check, same list as the dashboard's Sidebar entry.
const PM_ROLES = ['OWNER', 'STORE_MANAGER', 'INVENTORY_MANAGER'];

// A revealed secret is dropped from memory after this long, like the dashboard.
const REVEAL_MS = 30000;

type Tab = 'passwords' | 'cards';
type Kind = 'pwd' | 'num' | 'cvv';

function CardList({
  list, canManage, revealedNums, revealedCvvs, onReveal, onCopy, onEdit, onDelete,
}: {
  list: CardEntry[];
  canManage: (c: CardEntry) => boolean;
  revealedNums: Record<string, string>;
  revealedCvvs: Record<string, string>;
  onReveal: (k: 'num' | 'cvv', id: string) => void;
  onCopy: (value: string, label: string) => void;
  onEdit: (c: CardEntry) => void;
  onDelete: (c: CardEntry) => void;
}) {
  return (
    <>
      {list.map((c) => (
        <CardVisual
          key={c.id}
          card={c}
          revealedNum={revealedNums[c.id]}
          revealedCvv={revealedCvvs[c.id]}
          canManage={canManage(c)}
          onRevealNum={() => onReveal('num', c.id)}
          onRevealCvv={() => onReveal('cvv', c.id)}
          onCopy={onCopy}
          onEdit={() => onEdit(c)}
          onDelete={() => onDelete(c)}
        />
      ))}
    </>
  );
}

export default function PasswordManagerScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const allowed = PM_ROLES.includes(user?.role ?? '');

  const [tab, setTab] = useState<Tab>('passwords');
  const [passwords, setPasswords] = useState<PasswordEntry[] | null>(null);
  const [cards, setCards] = useState<CardEntry[] | null>(null);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');

  // Revealed secrets, by entry id. Kept in memory only — never logged, stored
  // or written anywhere — and cleared on timeout, app background and unmount.
  const [revealedPwds, setRevealedPwds] = useState<Record<string, string>>({});
  const [revealedNums, setRevealedNums] = useState<Record<string, string>>({});
  const [revealedCvvs, setRevealedCvvs] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Add / edit forms replace the list.
  const [form, setForm] = useState<{ kind: 'pwd'; editing: PasswordEntry | null } | { kind: 'card'; editing: CardEntry | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const setterFor = (k: Kind) => (k === 'pwd' ? setRevealedPwds : k === 'num' ? setRevealedNums : setRevealedCvvs);

  const hide = useCallback((k: Kind, id: string) => {
    const key = `${k}:${id}`;
    clearTimeout(timers.current[key]);
    delete timers.current[key];
    setterFor(k)((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  }, []);

  const clearAllSecrets = useCallback(() => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    setRevealedPwds({});
    setRevealedNums({});
    setRevealedCvvs({});
  }, []);

  // Drop every revealed secret when the app goes to the background, and when
  // the screen closes.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') clearAllSecrets(); });
    return () => {
      sub.remove();
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    };
  }, [clearAllSecrets]);

  const loadPasswords = useCallback(async () => {
    setPwdError(null);
    try {
      setPasswords(await fetchPasswordEntries());
    } catch (err: any) {
      setPwdError(getErrorMessage(err, 'Failed to load passwords'));
    }
  }, []);

  const loadCards = useCallback(async () => {
    setCardError(null);
    try {
      setCards(await fetchCardEntries());
    } catch (err: any) {
      setCardError(getErrorMessage(err, 'Failed to load cards'));
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    loadPasswords();
    loadCards();
  }, [allowed, loadPasswords, loadCards]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    clearAllSecrets();
    await Promise.all([loadPasswords(), loadCards()]);
    setIsRefreshing(false);
  };

  // Reveal fetches the real secret only on this tap; tapping again hides it.
  const reveal = async (k: Kind, id: string, current: string | undefined) => {
    if (current) { hide(k, id); return; }
    try {
      const value = k === 'pwd' ? await revealPasswordEntry(id) : k === 'num' ? await revealCardNumber(id) : await revealCardCvv(id);
      setterFor(k)((p) => ({ ...p, [id]: value }));
      timers.current[`${k}:${id}`] = setTimeout(() => hide(k, id), REVEAL_MS);
    } catch {
      showToast(k === 'pwd' ? 'Failed to reveal password' : k === 'num' ? 'Failed to reveal card number' : 'Failed to reveal CVV', false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      showToast(`${label} copied`);
    } catch {
      showToast('Could not copy', false);
    }
  };

  // Same rule as the backend's canManage: OWNER any; STORE_MANAGER unless the
  // entry was added by an OWNER; everyone else only their own.
  const canManage = (e: { addedById: string; addedBy: { role: string } }) => {
    if (!user) return false;
    if (user.role === 'OWNER') return true;
    if (user.role === 'STORE_MANAGER' && e.addedBy?.role !== 'OWNER') return true;
    return e.addedById === user.id;
  };

  const closeForm = () => { setForm(null); setSaveError(null); };

  const savePwd = async (editing: PasswordEntry | null, body: PasswordEntryInput) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await updatePasswordEntry(editing.id, body);
        hide('pwd', editing.id); // the stored value may have changed
        showToast('Password updated');
      } else {
        await createPasswordEntry(body);
        showToast('Password added');
      }
      setForm(null);
      await loadPasswords();
    } catch (err: any) {
      setSaveError(getErrorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const saveCard = async (editing: CardEntry | null, body: CardEntryInput) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await updateCardEntry(editing.id, body);
        hide('num', editing.id);
        hide('cvv', editing.id);
        showToast('Card updated');
      } else {
        await createCardEntry(body);
        showToast('Card added');
      }
      setForm(null);
      await loadCards();
    } catch (err: any) {
      setSaveError(getErrorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const deletePwd = (p: PasswordEntry) => {
    Alert.alert('Delete this password entry?', p.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePasswordEntry(p.id);
            hide('pwd', p.id);
            showToast('Deleted');
            await loadPasswords();
          } catch (err: any) {
            showToast(getErrorMessage(err, 'Failed to delete'), false);
          }
        },
      },
    ]);
  };

  const deleteCard = (c: CardEntry) => {
    Alert.alert('Delete this card?', c.label, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCardEntry(c.id);
            hide('num', c.id);
            hide('cvv', c.id);
            showToast('Deleted');
            await loadCards();
          } catch (err: any) {
            showToast(getErrorMessage(err, 'Failed to delete'), false);
          }
        },
      },
    ]);
  };

  if (!allowed) {
    return (
      <View style={[styles.content, styles.flex1]}>
        <Stack.Screen options={{ title: 'Password Manager' }} />
        <ThemedText type="small" themeColor="textSecondary">
          Password Manager is available to Owner, Store Manager and Inventory Manager roles only.
        </ThemedText>
      </View>
    );
  }

  const toastView = toast && (
    <View style={[styles.toast, { top: insets.top + Spacing.two, backgroundColor: toast.ok ? '#323232' : '#B83030' }]} pointerEvents="none">
      <ThemedText type="small" style={styles.toastText}>{toast.text}</ThemedText>
    </View>
  );

  if (form) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'Password Manager' }} />
        {toastView}
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]} keyboardShouldPersistTaps="handled">
          {form.kind === 'pwd' ? (
            <PasswordForm
              // Fresh form state per entry being edited.
              key={form.editing?.id ?? 'new-pwd'}
              editing={form.editing}
              saving={saving}
              error={saveError}
              onCancel={closeForm}
              onSubmit={(b) => savePwd(form.editing, b)}
            />
          ) : (
            <CardFormView
              key={form.editing?.id ?? 'new-card'}
              editing={form.editing}
              saving={saving}
              error={saveError}
              onCancel={closeForm}
              onSubmit={(b) => saveCard(form.editing, b)}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const q = search.toLowerCase();
  const filteredPwds = (passwords ?? []).filter((p) => {
    const matchSearch = !q || p.title.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
    const matchCat = !catFilter || p.category === catFilter;
    return matchSearch && matchCat;
  });
  const creditCards = (cards ?? []).filter((c) => c.cardType === 'CREDIT');
  const debitCards = (cards ?? []).filter((c) => c.cardType === 'DEBIT');

  const errorCard = (message: string, retry: () => void) => (
    <GlassCard>
      <ThemedText style={styles.error}>{message}</ThemedText>
      <Pressable onPress={retry} style={styles.retry}>
        <ThemedText style={styles.btnLabel}>Retry</ThemedText>
      </Pressable>
    </GlassCard>
  );


  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Password Manager' }} />
      {toastView}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="small" themeColor="textSecondary">Securely store passwords and payment cards</ThemedText>

        <Pressable
          onPress={() => { setSaveError(null); setForm(tab === 'passwords' ? { kind: 'pwd', editing: null } : { kind: 'card', editing: null }); }}
          style={styles.addButton}>
          <ThemedText style={styles.btnLabel}>+ Add {tab === 'passwords' ? 'Password' : 'Card'}</ThemedText>
        </Pressable>

        <View style={styles.tabs}>
          {(['passwords', 'cards'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, { backgroundColor: tab === t ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={tab === t ? styles.tabActive : undefined}>{t === 'passwords' ? 'Passwords' : 'Cards'}</ThemedText>
            </Pressable>
          ))}
        </View>

        {tab === 'passwords' ? (
          <>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search passwords..."
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[{ key: '', label: 'All Categories' }, ...PWD_CATEGORIES.map((c) => ({ key: c, label: c }))].map((o) => (
                <Pressable
                  key={o.key || 'all'}
                  onPress={() => setCatFilter(o.key)}
                  style={[styles.filterChip, { backgroundColor: catFilter === o.key ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={catFilter === o.key ? styles.tabActive : undefined}>{o.label}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>

            {pwdError ? errorCard(pwdError, loadPasswords) : passwords === null ? (
              <ActivityIndicator style={styles.spinner} />
            ) : filteredPwds.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>No password entries found.</ThemedText>
            ) : (
              filteredPwds.map((p) => (
                <PasswordCard
                  key={p.id}
                  entry={p}
                  revealed={revealedPwds[p.id]}
                  canManage={canManage(p)}
                  onReveal={() => reveal('pwd', p.id, revealedPwds[p.id])}
                  onCopy={copy}
                  onEdit={() => { setSaveError(null); setForm({ kind: 'pwd', editing: p }); }}
                  onDelete={() => deletePwd(p)}
                />
              ))
            )}
          </>
        ) : cardError ? (
          errorCard(cardError, loadCards)
        ) : cards === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={[styles.dot, { backgroundColor: '#334155' }]} />
                <ThemedText type="smallBold">Credit Cards</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">({creditCards.length})</ThemedText>
              </View>
              {creditCards.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>No credit cards added.</ThemedText>
              ) : (
                <CardList list={creditCards} canManage={canManage}
                revealedNums={revealedNums}
                revealedCvvs={revealedCvvs}
                onReveal={(k, id) => reveal(k, id, k === 'num' ? revealedNums[id] : revealedCvvs[id])}
                onCopy={copy}
                onEdit={(c) => { setSaveError(null); setForm({ kind: 'card', editing: c }); }}
                onDelete={deleteCard} />
              )}
            </View>
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={[styles.dot, { backgroundColor: '#0d9488' }]} />
                <ThemedText type="smallBold">Debit Cards</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">({debitCards.length})</ThemedText>
              </View>
              {debitCards.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.italic}>No debit cards added.</ThemedText>
              ) : (
                <CardList list={debitCards} canManage={canManage}
                revealedNums={revealedNums}
                revealedCvvs={revealedCvvs}
                onReveal={(k, id) => reveal(k, id, k === 'num' ? revealedNums[id] : revealedCvvs[id])}
                onCopy={copy}
                onEdit={(c) => { setSaveError(null); setForm({ kind: 'card', editing: c }); }}
                onDelete={deleteCard} />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  addButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, minHeight: Layout.minTouchTarget, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: Spacing.one },
  tab: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  tabActive: { color: '#ffffff', fontWeight: '600' },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  filterChip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four, marginRight: Spacing.one },
  spinner: { marginTop: Spacing.three },
  empty: { textAlign: 'center', paddingVertical: Spacing.five },
  section: { gap: Spacing.three, marginTop: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 12, height: 12, borderRadius: 6 },
  italic: { fontStyle: 'italic' },
  error: { color: '#B83030' },
  retry: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  btnLabel: { color: '#ffffff', fontWeight: '600' },
  toast: { position: 'absolute', left: Spacing.three, right: Spacing.three, zIndex: 50, borderRadius: Spacing.two, padding: Spacing.two, alignItems: 'center' },
  toastText: { color: '#ffffff' },
});
