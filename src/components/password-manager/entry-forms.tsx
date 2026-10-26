import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { PWD_CATEGORIES } from '@/components/password-manager/entry-cards';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CardEntry, CardEntryInput, CardType, PasswordEntry, PasswordEntryInput } from '@/types/api';

// The dashboard's blankPwd / blankCard defaults.
type PwdForm = { title: string; category: string; url: string; username: string; password: string; notes: string };
type CardForm = {
  label: string; cardType: CardType; bankName: string; cardholderName: string;
  cardNumber: string; expiry: string; cvv: string; billingAddress: string; notes: string;
};

function Label({ children }: { children: React.ReactNode }) {
  return <ThemedText type="small" themeColor="textSecondary" style={styles.label}>{children}</ThemedText>;
}

function Field({
  value, onChangeText, placeholder, multiline, rows, keyboardType, maxLength, autoCapitalize,
}: {
  value: string; onChangeText: (v: string) => void; placeholder?: string; multiline?: boolean; rows?: number;
  keyboardType?: 'default' | 'number-pad' | 'url' | 'email-address'; maxLength?: number; autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      multiline={multiline}
      keyboardType={keyboardType}
      maxLength={maxLength}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      autoCorrect={false}
      style={[
        styles.input,
        multiline && { height: 28 * (rows ?? 3) + 18, textAlignVertical: 'top', paddingTop: Spacing.two },
        { color: theme.text, backgroundColor: theme.backgroundElement },
      ]}
    />
  );
}

// The dashboard's PwdInput: masked field with a show/hide toggle.
function PwdInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const theme = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={[styles.pwdWrap, { backgroundColor: theme.backgroundElement }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.pwdInput, { color: theme.text }]}
      />
      <Pressable onPress={() => setShow((s) => !s)} hitSlop={10}>
        <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

function Chips<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.chipRow}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.chip, { backgroundColor: value === o.key ? theme.primary : theme.backgroundElement }]}>
          <ThemedText type="small" style={value === o.key ? styles.chipActive : undefined}>{o.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function Actions({ saving, submitLabel, onCancel, onSubmit }: { saving: boolean; submitLabel: string; onCancel: () => void; onSubmit: () => void }) {
  return (
    <View style={styles.actions}>
      <Pressable onPress={onCancel} disabled={saving} style={[styles.btn, styles.cancel, styles.flex1]}>
        <ThemedText style={styles.btnLabel}>Cancel</ThemedText>
      </Pressable>
      <Pressable onPress={onSubmit} disabled={saving} style={[styles.btn, styles.flex1]}>
        {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.btnLabel}>{submitLabel}</ThemedText>}
      </Pressable>
    </View>
  );
}

// Add / Edit Password — fields, labels and placeholders as on the dashboard.
// Editing leaves the password blank (blank = keep current); the real value is
// never fetched into the form.
export function PasswordForm({ editing, saving, error, onCancel, onSubmit }: {
  editing: PasswordEntry | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: PasswordEntryInput) => void;
}) {
  const [f, setF] = useState<PwdForm>(() =>
    editing
      ? { title: editing.title, category: editing.category, url: editing.url || '', username: editing.username, password: '', notes: editing.notes || '' }
      : { title: '', category: 'Social Media', url: '', username: '', password: '', notes: '' },
  );
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof PwdForm) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => {
    if (!f.title.trim()) { setFormError('Title is required.'); return; }
    if (!f.username.trim()) { setFormError('Username / Email is required.'); return; }
    if (!editing && !f.password) { setFormError('Password is required.'); return; }
    setFormError(null);
    // Edit: only send the password when one was typed, like the dashboard.
    const body: PasswordEntryInput = { title: f.title, category: f.category, url: f.url, username: f.username, notes: f.notes };
    if (!editing || f.password) body.password = f.password;
    onSubmit(body);
  };

  return (
    <GlassCard>
      <ThemedText type="smallBold">{editing ? 'Edit Password' : 'Add Password'}</ThemedText>

      <Label>Title *</Label>
      <Field value={f.title} onChangeText={set('title')} placeholder="e.g. Google Account" />

      <Label>Category *</Label>
      <Chips options={PWD_CATEGORIES.map((c) => ({ key: c, label: c }))} value={f.category} onChange={set('category')} />

      <Label>URL</Label>
      <Field value={f.url} onChangeText={set('url')} placeholder="https://..." keyboardType="url" autoCapitalize="none" />

      <Label>Username / Email *</Label>
      <Field value={f.username} onChangeText={set('username')} placeholder="username@example.com" keyboardType="email-address" autoCapitalize="none" />

      <Label>{editing ? 'Password (leave blank to keep current)' : 'Password *'}</Label>
      <PwdInput value={f.password} onChange={set('password')} placeholder={editing ? 'Leave blank to keep' : 'Enter password'} />

      <Label>Notes</Label>
      <Field value={f.notes} onChangeText={set('notes')} placeholder="Optional notes..." multiline rows={3} />

      {(formError || error) && <ThemedText style={styles.error}>{formError ?? error}</ThemedText>}
      <Actions saving={saving} submitLabel={editing ? 'Save Changes' : 'Add Password'} onCancel={onCancel} onSubmit={submit} />
    </GlassCard>
  );
}

// Add / Edit Card — fields, labels, placeholders and input masks as on the
// dashboard (16-digit number, MM/YY auto-slash, 4-digit CVV).
export function CardFormView({ editing, saving, error, onCancel, onSubmit }: {
  editing: CardEntry | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: CardEntryInput) => void;
}) {
  const [f, setF] = useState<CardForm>(() =>
    editing
      ? {
          label: editing.label, cardType: editing.cardType, bankName: editing.bankName, cardholderName: editing.cardholderName,
          cardNumber: '', expiry: editing.expiry, cvv: '', billingAddress: editing.billingAddress || '', notes: editing.notes || '',
        }
      : { label: '', cardType: 'CREDIT', bankName: '', cardholderName: '', cardNumber: '', expiry: '', cvv: '', billingAddress: '', notes: '' },
  );
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof CardForm>(k: K) => (v: CardForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = () => {
    if (!f.label.trim()) { setFormError('Card Label is required.'); return; }
    if (!f.bankName.trim()) { setFormError('Bank Name is required.'); return; }
    if (!f.cardholderName.trim()) { setFormError('Cardholder Name is required.'); return; }
    if (!editing && !f.cardNumber) { setFormError('Card Number is required.'); return; }
    if (!f.expiry.trim()) { setFormError('Expiry (MM/YY) is required.'); return; }
    if (!editing && !f.cvv) { setFormError('CVV is required.'); return; }
    setFormError(null);
    // Edit: number / CVV are only sent when typed (blank = keep).
    const body: CardEntryInput = {
      label: f.label, cardType: f.cardType, bankName: f.bankName, cardholderName: f.cardholderName,
      expiry: f.expiry, billingAddress: f.billingAddress, notes: f.notes,
    };
    if (!editing || f.cardNumber) body.cardNumber = f.cardNumber;
    if (!editing || f.cvv) body.cvv = f.cvv;
    onSubmit(body);
  };

  return (
    <GlassCard>
      <ThemedText type="smallBold">{editing ? 'Edit Card' : 'Add Card'}</ThemedText>

      <Label>Card Label *</Label>
      <Field value={f.label} onChangeText={set('label')} placeholder="e.g. HDFC Business Card" />

      <Label>Card Type *</Label>
      <Chips options={[{ key: 'CREDIT', label: 'Credit' }, { key: 'DEBIT', label: 'Debit' }]} value={f.cardType} onChange={set('cardType')} />

      <Label>Bank Name *</Label>
      <Field value={f.bankName} onChangeText={set('bankName')} placeholder="e.g. HDFC Bank" />

      <Label>Cardholder Name *</Label>
      <Field value={f.cardholderName} onChangeText={set('cardholderName')} placeholder="Name on card" />

      <Label>{editing ? 'Card Number (leave blank to keep)' : 'Card Number *'}</Label>
      <Field
        value={f.cardNumber}
        onChangeText={(v) => set('cardNumber')(v.replace(/\D/g, '').slice(0, 16))}
        placeholder={editing ? 'Leave blank to keep' : '16-digit card number'}
        keyboardType="number-pad"
        maxLength={16}
      />

      <View style={styles.twoCol}>
        <View style={styles.flex1}>
          <Label>Expiry (MM/YY) *</Label>
          <Field
            value={f.expiry}
            onChangeText={(v) => {
              let d = v.replace(/\D/g, '');
              if (d.length >= 2) d = `${d.slice(0, 2)}/${d.slice(2, 4)}`;
              set('expiry')(d);
            }}
            placeholder="MM/YY"
            keyboardType="number-pad"
            maxLength={5}
          />
        </View>
        <View style={styles.flex1}>
          <Label>{editing ? 'CVV (leave blank)' : 'CVV *'}</Label>
          <PwdInput value={f.cvv} onChange={(v) => set('cvv')(v.replace(/\D/g, '').slice(0, 4))} placeholder={editing ? 'Leave blank' : 'CVV'} />
        </View>
      </View>

      <Label>Billing Address</Label>
      <Field value={f.billingAddress} onChangeText={set('billingAddress')} placeholder="Optional" multiline rows={2} />

      <Label>Notes</Label>
      <Field value={f.notes} onChangeText={set('notes')} placeholder="Optional notes..." multiline rows={2} />

      {(formError || error) && <ThemedText style={styles.error}>{formError ?? error}</ThemedText>}
      <Actions saving={saving} submitLabel={editing ? 'Save Changes' : 'Add Card'} onCancel={onCancel} onSubmit={submit} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  label: { marginTop: Spacing.two, marginBottom: Spacing.one },
  input: { minHeight: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  pwdWrap: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, gap: Spacing.two },
  pwdInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipActive: { color: '#ffffff', fontWeight: '600' },
  twoCol: { flexDirection: 'row', gap: Spacing.two },
  error: { color: '#B83030', marginTop: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three },
  btn: { height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: '#8A8A8E' },
  btnLabel: { color: '#ffffff', fontWeight: '600' },
});
