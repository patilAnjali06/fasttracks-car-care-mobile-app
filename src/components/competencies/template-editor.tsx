import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CompetencyInput, RoleCompetency } from '@/types/api';

// Stable React keys for rows (module-level so render stays pure).
let rowKeySeq = 0;

type Row = {
  key: number;
  name: string;
  weightage: string;
  description: string;
  whatToAssess: string;
  ratingGuide: string;
  open: boolean;
};

const DETAIL_FIELDS: { field: 'description' | 'whatToAssess' | 'ratingGuide'; label: string }[] = [
  { field: 'description', label: 'Description' },
  { field: 'whatToAssess', label: 'What to assess' },
  { field: 'ratingGuide', label: 'Rating guide' },
];

// Mirrors validateCompetencies in the backend: every competency needs a name
// and an integer weightage 0-100, and the weightages must add up to exactly 100.
// The server rounds weightage; requiring an integer here keeps the running
// total honest.
function validate(rows: Row[]): { ok: true; competencies: CompetencyInput[] } | { ok: false; error: string } {
  if (rows.length === 0) return { ok: false, error: 'At least one competency is required.' };
  const competencies: CompetencyInput[] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) return { ok: false, error: 'Every competency needs a name.' };
    const w = Number(r.weightage);
    if (r.weightage.trim() === '' || !Number.isInteger(w) || w < 0 || w > 100) {
      return { ok: false, error: `"${name}" needs a whole-number weightage between 0 and 100.` };
    }
    competencies.push({
      name,
      weightage: w,
      description: r.description.trim() || undefined,
      whatToAssess: r.whatToAssess.trim() || undefined,
      ratingGuide: r.ratingGuide.trim() || undefined,
    });
  }
  const total = competencies.reduce((s, c) => s + c.weightage, 0);
  if (total !== 100) return { ok: false, error: `Competency weightages must add up to 100 (currently ${total}).` };
  return { ok: true, competencies };
}

// Reusable competency list editor (Create and Edit). Submit stays disabled until
// the live weight total is exactly 100.
export function TemplateEditor({ initial, submitLabel, submitting, error, onSubmit, onCancel }: {
  initial: RoleCompetency[] | CompetencyInput[];
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (competencies: CompetencyInput[]) => void;
  onCancel?: () => void;
}) {
  const theme = useTheme();
  const blank = (): Row => ({ key: rowKeySeq++, name: '', weightage: '', description: '', whatToAssess: '', ratingGuide: '', open: false });
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length > 0
      ? initial.map((c) => ({
          key: rowKeySeq++,
          name: c.name,
          weightage: String(c.weightage),
          description: c.description ?? '',
          whatToAssess: c.whatToAssess ?? '',
          ratingGuide: c.ratingGuide ?? '',
          open: false,
        }))
      : [blank()],
  );
  const [formError, setFormError] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + (Number.isFinite(Number(r.weightage)) ? Number(r.weightage) || 0 : 0), 0);
  const totalOk = total === 100;

  const patch = (key: number, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const submit = () => {
    const v = validate(rows);
    if (!v.ok) { setFormError(v.error); return; }
    setFormError(null);
    onSubmit(v.competencies);
  };

  const input = [styles.input, { color: theme.text, backgroundColor: theme.background }];

  return (
    <View style={styles.wrap}>
      {rows.map((r, i) => (
        <ThemedView key={r.key} type="backgroundElement" style={styles.card}>
          <View style={styles.row}>
            <ThemedText type="smallBold" style={styles.index}>{i + 1}</ThemedText>
            <TextInput
              value={r.name}
              onChangeText={(v) => patch(r.key, { name: v })}
              placeholder="Competency name"
              placeholderTextColor={theme.textSecondary}
              style={[...input, styles.flex1]}
            />
            <TextInput
              value={r.weightage}
              onChangeText={(v) => patch(r.key, { weightage: v.replace(/[^0-9]/g, '') })}
              placeholder="%"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
              style={[...input, styles.weight]}
            />
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => patch(r.key, { open: !r.open })} style={styles.linkBtn}>
              <ThemedText type="small">{r.open ? 'Hide details ▴' : 'Details ▾'}</ThemedText>
            </Pressable>
            {rows.length > 1 && (
              <Pressable onPress={() => setRows((list) => list.filter((x) => x.key !== r.key))} style={styles.linkBtn}>
                <ThemedText type="small" style={styles.remove}>Remove</ThemedText>
              </Pressable>
            )}
          </View>
          {r.open && DETAIL_FIELDS.map(({ field, label }) => (
            <View key={field}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>{label}</ThemedText>
              <TextInput
                value={r[field]}
                onChangeText={(v) => patch(r.key, { [field]: v })}
                multiline
                style={[...input, styles.multiline]}
              />
            </View>
          ))}
        </ThemedView>
      ))}

      <Pressable onPress={() => setRows((list) => [...list, blank()])} style={[styles.button, styles.grey]}>
        <ThemedText style={styles.buttonLabel}>+ Add competency</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" style={totalOk ? styles.ok : styles.warn}>
        Weightage total: {total} / 100{totalOk ? '' : total > 100 ? ` (${total - 100} over)` : ` (${100 - total} to go)`}
      </ThemedText>

      {(formError || error) && <ThemedText style={styles.error}>{formError ?? error}</ThemedText>}

      <Pressable onPress={submit} disabled={submitting || !totalOk} style={[styles.button, (!totalOk || submitting) && styles.disabled]}>
        {submitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>{submitLabel}</ThemedText>}
      </Pressable>
      {onCancel && (
        <Pressable onPress={onCancel} disabled={submitting} style={[styles.button, styles.grey]}>
          <ThemedText style={styles.buttonLabel}>Cancel</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  wrap: { gap: Spacing.two },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  index: { width: 18 },
  input: { minHeight: 44, borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, fontSize: 15 },
  weight: { width: 64, textAlign: 'center' },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  label: { marginTop: Spacing.one, marginBottom: Spacing.half },
  linkBtn: { paddingVertical: Spacing.one, paddingRight: Spacing.two },
  remove: { color: '#B83030' },
  ok: { color: '#167A48' },
  warn: { color: '#A86018' },
  error: { color: '#B83030' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  grey: { backgroundColor: '#8A8A8E' },
  disabled: { opacity: 0.5 },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
