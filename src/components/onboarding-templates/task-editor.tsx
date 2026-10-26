import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { OnboardingTaskInput } from '@/types/api';

type Row = { key: number; label: string; description: string; responsible: string };

// Stable React keys (module-level so render stays pure) — rows move and are
// removed, so an index key would shuffle their text.
let rowKeySeq = 0;
const blank = (): Row => ({ key: rowKeySeq++, label: '', description: '', responsible: '' });

function Label({ children, required }: { children: string; required?: boolean }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
      {children.toUpperCase()}{required ? <ThemedText type="small" style={styles.req}> *</ThemedText> : null}
    </ThemedText>
  );
}

// The dashboard's TemplateEditor, used for a not-yet-saved template (manual or
// AI-suggested) and for an existing one. Rows of Label / Description /
// Responsible, add / remove / reorder; nothing is persisted until Save.
export function TaskEditor({ roleName, initialTasks, saving, error, savedAt, onSave, onBack }: {
  roleName: string;
  initialTasks: OnboardingTaskInput[];
  saving: boolean;
  error: string | null;
  savedAt: Date | null;
  onSave: (tasks: OnboardingTaskInput[]) => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const [rows, setRows] = useState<Row[]>(() =>
    (initialTasks.length ? initialTasks : [{ label: '', description: '', responsible: '' }]).map((t) => ({
      key: rowKeySeq++,
      label: t.label,
      description: t.description ?? '',
      responsible: t.responsible ?? '',
    })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const touch = () => { setDirty(true); setFormError(null); };
  const update = (key: number, patch: Partial<Row>) => { touch(); setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r))); };
  const add = () => { touch(); setRows((p) => [...p, blank()]); };
  const remove = (key: number) => { touch(); setRows((p) => p.filter((r) => r.key !== key)); };
  const move = (i: number, dir: -1 | 1) => {
    touch();
    setRows((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const save = () => {
    if (rows.some((r) => !r.label.trim())) { setFormError('Every task needs a label.'); return; }
    setFormError(null);
    setDirty(false);
    onSave(rows.map((r) => ({ label: r.label.trim(), description: r.description.trim() || undefined, responsible: r.responsible.trim() || undefined })));
  };

  const back = () => {
    if (!dirty || saving) { onBack(); return; }
    // The dashboard discards silently; on a phone a stray back-swipe would throw
    // away an AI draft, so ask first when there are unsaved edits.
    Alert.alert('Discard changes?', 'You have unsaved changes to this template.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onBack },
    ]);
  };

  const input = [styles.input, { color: theme.text, backgroundColor: theme.background }];
  const shownError = formError ?? error;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={back} style={styles.backLink}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.underline}>← Back to list</ThemedText>
      </Pressable>
      <ThemedText type="subtitle">{roleName}</ThemedText>

      {shownError && !saving ? <ThemedText style={styles.error}>{shownError}</ThemedText> : null}

      <GlassCard>
        <View style={styles.rows}>
          {rows.map((r, i) => (
            <ThemedView key={r.key} type="backgroundElement" style={styles.row}>
              <Label required={i === 0}>Label</Label>
              <TextInput value={r.label} onChangeText={(v) => update(r.key, { label: v })} style={input} />
              <Label>Description</Label>
              <TextInput value={r.description} onChangeText={(v) => update(r.key, { description: v })} multiline style={[...input, styles.multiline]} />
              <Label>Responsible</Label>
              <TextInput
                value={r.responsible}
                onChangeText={(v) => update(r.key, { responsible: v })}
                placeholder="e.g. HR"
                placeholderTextColor={theme.textSecondary}
                style={input}
              />
              <View style={styles.rowActions}>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={[styles.iconBtn, i === 0 && styles.disabled]}>
                  <ThemedText type="small">↑</ThemedText>
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === rows.length - 1} style={[styles.iconBtn, i === rows.length - 1 && styles.disabled]}>
                  <ThemedText type="small">↓</ThemedText>
                </Pressable>
                <Pressable onPress={() => remove(r.key)} disabled={rows.length === 1} style={[styles.iconBtn, rows.length === 1 && styles.disabled]}>
                  <ThemedText type="small" style={styles.error}>✕</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ))}

          <Pressable onPress={add} style={[styles.button, styles.grey]}>
            <ThemedText style={styles.buttonLabel}>+ Add Task</ThemedText>
          </Pressable>

          {savedAt && !saving ? (
            <ThemedText type="small" style={styles.ok}>
              ✓ Saved at {savedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
          ) : null}

          <Pressable onPress={save} disabled={saving} style={styles.button}>
            {saving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Save</ThemedText>}
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  rows: { gap: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: Spacing.one },
  req: { color: '#B83030' },
  input: { minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, fontSize: 15 },
  multiline: { minHeight: 70, textAlignVertical: 'top', paddingTop: Spacing.two },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, marginTop: Spacing.one },
  iconBtn: { minWidth: 40, height: 36, borderRadius: Spacing.one, borderWidth: 1, borderColor: 'rgba(127,127,127,0.4)', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  error: { color: '#B83030' },
  ok: { color: '#167A48', fontWeight: '600', textAlign: 'right' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  grey: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
