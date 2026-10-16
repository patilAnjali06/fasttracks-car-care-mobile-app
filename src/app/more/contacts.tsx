import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createContact, deleteContact, fetchContact, fetchContacts, getErrorMessage, updateContact } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Contact, ContactDetail, ContactType } from '@/types/api';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// CONTACTS_DIRECTORY_ROLES=[OWNER,STORE_MANAGER,TECH_TEAM]
// (backend/src/middleware/auth.ts, requireContactsDirectoryAccess) gates
// GET /contacts, GET /contacts/:id, POST /contacts, AND PATCH /:id —
// re-verified 2026-09-28 against backend/src/routes/contacts.ts line 164
// (router.patch('/:id', requireContactsDirectoryAccess, ...)), correcting
// a prior stale claim that edit had no directory gate; it does, same as
// list/create. Delete (DELETE /:id) is narrower —
// CONTACTS_DELETE_ROLES=[OWNER,STORE_MANAGER] — TECH_TEAM can view/create/
// edit but not delete.
const DIRECTORY_ROLES = ['OWNER', 'STORE_MANAGER', 'TECH_TEAM'];
const DELETE_ROLES = ['OWNER', 'STORE_MANAGER'];

const CONTACT_TYPES: { key: ContactType; label: string }[] = [
  { key: 'CUSTOMER', label: 'Customer' },
  { key: 'VENDOR_SERVICE_PROVIDER', label: 'Vendor / Service' },
  { key: 'STAFF', label: 'Staff' },
  { key: 'OTHER', label: 'Other' },
];

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = DIRECTORY_ROLES.includes(user?.role ?? '');
  const canDelete = DELETE_ROLES.includes(user?.role ?? '');

  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editing, setEditing] = useState<Contact | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<ContactType>('OTHER');
  const [editLabel, setEditLabel] = useState('');
  const [editReason, setEditReason] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Detail + link history — GET /contacts/:id, fetchContact() already
  // existed in api.ts unused by any screen.
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ContactType>('CUSTOMER');
  const [newLabel, setNewLabel] = useState('');
  const [newReason, setNewReason] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async (q?: string) => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const res = await fetchContacts(q?.trim() ? { q: q.trim() } : undefined);
      setContacts(res.contacts);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load contacts.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load(search);
    setIsRefreshing(false);
  };

  const onSearch = () => load(search);

  const onStartEdit = (c: Contact) => {
    setEditing(c);
    setEditName(c.name ?? '');
    setEditType(c.contactType);
    setEditLabel(c.contactTypeOther ?? '');
    setEditReason(c.reason ?? '');
    setError(null);
    setNotice(null);
    setDetail(null);
    setDetailError(null);
    loadDetail(c.id);
  };

  const loadDetail = async (id: string) => {
    setDetailError(null);
    try {
      setDetail(await fetchContact(id));
    } catch (err: any) {
      setDetailError(getErrorMessage(err, 'Could not load link history.'));
    }
  };

  const onSaveEdit = async () => {
    if (!editing) return;
    setIsSavingEdit(true);
    setError(null);
    setNotice(null);
    try {
      await updateContact(editing.id, {
        contactType: editType,
        name: editName.trim() || undefined,
        contactTypeOther: editType === 'OTHER' ? editLabel.trim() : undefined,
        reason: editReason.trim() || undefined,
      });
      setNotice('Contact updated.');
      setEditing(null);
      await load(search);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not update this contact.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const onCreate = async () => {
    if (!newPhone.trim()) {
      setError('Phone number is required.');
      return;
    }
    setIsCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createContact({
        phone: newPhone.trim(),
        contactType: newType,
        name: newName.trim() || undefined,
        contactTypeOther: newType === 'OTHER' ? newLabel.trim() : undefined,
        reason: newReason.trim() || undefined,
      });
      setNewPhone('');
      setNewName('');
      setNewLabel('');
      setNewReason('');
      setNewType('CUSTOMER');
      setShowCreate(false);
      setNotice('Contact created.');
      await load(search);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not create the contact.'));
    } finally {
      setIsCreating(false);
    }
  };

  const onDelete = (c: Contact) => {
    Alert.alert(
      'Delete this contact?',
      `This removes ${c.name || c.phone} from the directory. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(c.id);
            setError(null);
            setNotice(null);
            try {
              await deleteContact(c.id);
              setNotice('Contact deleted.');
              await load(search);
            } catch (err: any) {
              setError(getErrorMessage(err, 'Could not delete this contact.'));
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Contacts is only available to Owner, Store Manager, or Tech Team accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  if (editing) {
    return (
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
        <Stack.Screen options={{ title: 'Edit Contact' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={() => setEditing(null)} style={styles.backButton} accessibilityLabel="Back to contacts list">
            <ThemedText type="link">‹ Back to list</ThemedText>
          </Pressable>
          <GlassCard style={styles.card}>
            <ThemedText type="smallBold">{editing.phone}</ThemedText>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Name"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <View style={styles.chipRow}>
              {CONTACT_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setEditType(t.key)}
                  style={[styles.chip, { backgroundColor: editType === t.key ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={editType === t.key ? styles.chipLabelActive : undefined}>{t.label}</ThemedText>
                </Pressable>
              ))}
            </View>
            {editType === 'OTHER' && (
              <TextInput
                value={editLabel}
                onChangeText={setEditLabel}
                placeholder="What kind of contact is this?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            )}
            <TextInput
              value={editReason}
              onChangeText={setEditReason}
              placeholder="Reason / notes"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
            <Pressable onPress={onSaveEdit} disabled={isSavingEdit} style={styles.button}>
              {isSavingEdit ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
            </Pressable>
            {canDelete && (
              <Pressable onPress={() => onDelete(editing)} disabled={deletingId === editing.id} style={[styles.button, styles.buttonDanger]}>
                {deletingId === editing.id ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Delete contact</ThemedText>}
              </Pressable>
            )}
          </GlassCard>

          {detail && (detail.addedBy || detail.lastEditedBy) && (
            <ThemedView type="backgroundElement" style={styles.card}>
              {detail.addedBy && <ThemedText type="small" themeColor="textSecondary">Added by {detail.addedBy.name} · {formatDate(detail.createdAt)}</ThemedText>}
              {detail.lastEditedBy && <ThemedText type="small" themeColor="textSecondary">Last edited by {detail.lastEditedBy.name}</ThemedText>}
            </ThemedView>
          )}

          <ThemedText type="smallBold" style={styles.sectionTitle}>Link history</ThemedText>
          {detailError && <ThemedText style={styles.error}>{detailError}</ThemedText>}
          {!detail && !detailError && <ActivityIndicator style={styles.spinner} />}
          {detail && detail.links.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">Never linked to a timesheet entry.</ThemedText>
          )}
          {detail && detail.links.map((link) => (
            <ThemedView key={link.id} type="backgroundElement" style={styles.linkRow}>
              <ThemedText type="small">{link.employee.name} · {formatDate(link.timesheetDate)}</ThemedText>
              {link.entryTask && <ThemedText type="small" themeColor="textSecondary">{link.entryTask}</ThemedText>}
              {link.reason && <ThemedText type="small" themeColor="textSecondary">{link.reason}</ThemedText>}
              <ThemedText type="small" themeColor="textSecondary">Linked by {link.linkedBy.name} · {formatDate(link.createdAt)}</ThemedText>
            </ThemedView>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
      <Stack.Screen options={{ title: 'Contacts' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={onSearch}
          placeholder="Search name, phone, or reason"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

        <Pressable onPress={() => setShowCreate((v) => !v)} style={styles.newButton}>
          <ThemedText style={styles.buttonLabel}>{showCreate ? 'Cancel' : '+ New contact'}</ThemedText>
        </Pressable>

        {showCreate && (
          <GlassCard style={styles.card}>
            <ThemedText type="smallBold">New contact</ThemedText>
            <TextInput
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="Phone number"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Name (optional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <View style={styles.chipRow}>
              {CONTACT_TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => setNewType(t.key)}
                  style={[styles.chip, { backgroundColor: newType === t.key ? theme.primary : theme.backgroundElement }]}>
                  <ThemedText type="small" style={newType === t.key ? styles.chipLabelActive : undefined}>{t.label}</ThemedText>
                </Pressable>
              ))}
            </View>
            {newType === 'OTHER' && (
              <TextInput
                value={newLabel}
                onChangeText={setNewLabel}
                placeholder="What kind of contact is this?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            )}
            <TextInput
              value={newReason}
              onChangeText={setNewReason}
              placeholder="Reason / notes (optional)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <Pressable onPress={onCreate} disabled={isCreating} style={styles.button}>
              {isCreating ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Create</ThemedText>}
            </Pressable>
          </GlassCard>
        )}

        {contacts === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : contacts.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No contacts found.</ThemedText>
        ) : (
          contacts.map((c) => (
            <Pressable key={c.id} onPress={() => onStartEdit(c)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{c.name || c.phone}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">
                    {c.phone} · {c.contactType === 'OTHER' ? (c.contactTypeOther || 'Other') : c.contactType.replace('_', ' ')}
                  </ThemedText>
                  {c.reason && (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="tail">{c.reason}</ThemedText>
                  )}
                </View>
                <ThemedText type="link">Edit ›</ThemedText>
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  spinner: { marginTop: Spacing.three },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  backButton: { marginBottom: Spacing.one, minHeight: 44, justifyContent: 'center' },
  card: { gap: Spacing.one, marginBottom: Spacing.two },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  button: { marginTop: Spacing.two, height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonDanger: { backgroundColor: '#B83030' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  newButton: { height: 44, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { marginTop: Spacing.two },
  linkRow: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
});
