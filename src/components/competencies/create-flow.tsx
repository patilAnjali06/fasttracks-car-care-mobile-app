import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CategoryPicker } from '@/components/competencies/category-picker';
import { TemplateEditor } from '@/components/competencies/template-editor';
import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createCompetencyTemplate,
  fetchDesignations,
  getErrorMessage,
  suggestCompetencyTemplate,
} from '@/lib/api';
import type { CompetencyCategory, CompetencyInput, CompetencyTemplate } from '@/types/api';

// Create = step 1 (role + category [+ AI description]), then either the manual
// editor or "Suggest with AI", which creates the DRAFT server-side and hands it
// to the parent to open for review. A 409 means the role already has a template.
export function CreateFlow({ onBack, onCreated, onOpenExisting }: {
  onBack: () => void;
  onCreated: (template: CompetencyTemplate, opts: { openEditor: boolean; message?: string }) => void;
  onOpenExisting: (id: string, archived: boolean) => void;
}) {
  const theme = useTheme();
  const [step, setStep] = useState<'details' | 'manual'>('details');
  const [roleName, setRoleName] = useState('');
  const [category, setCategory] = useState<CompetencyCategory | null>(null);
  const [description, setDescription] = useState('');
  const [designations, setDesignations] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState<'manual' | 'ai' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Suggestions only — a failed fetch just leaves the field free-text.
    fetchDesignations().then(setDesignations).catch(() => {});
  }, []);

  const suggestions = useMemo(() => {
    const q = roleName.trim().toLowerCase();
    if (!focused || !q) return [];
    return designations.filter((d) => d.toLowerCase().includes(q) && d.toLowerCase() !== q).slice(0, 6);
  }, [designations, roleName, focused]);

  const checkDetails = () => {
    if (!roleName.trim()) { setError('Role name is required.'); return false; }
    if (!category) { setError('Choose a category.'); return false; }
    setError(null);
    return true;
  };

  const handleConflict = (err: any): boolean => {
    const data = err?.response?.data;
    if (err?.response?.status === 409 && data?.existingTemplateId) {
      Alert.alert(
        'Template already exists',
        `${data.error ?? 'A template for this role already exists.'}${data.archived ? ' It is archived.' : ''}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open it', onPress: () => onOpenExisting(data.existingTemplateId, !!data.archived) },
        ],
      );
      return true;
    }
    return false;
  };

  const createManual = async (competencies: CompetencyInput[]) => {
    if (!category) return;
    setBusy('manual');
    setError(null);
    try {
      const res = await createCompetencyTemplate({ roleName: roleName.trim(), category, competencies });
      onCreated(res.template, { openEditor: false, message: res.message });
    } catch (err: any) {
      if (!handleConflict(err)) setError(getErrorMessage(err, 'Could not create the template.'));
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    if (!category) return;
    setBusy('ai');
    setError(null);
    try {
      const res = await suggestCompetencyTemplate({
        roleName: roleName.trim(),
        category,
        description: description.trim() || undefined,
      });
      onCreated(res.template, { openEditor: true, message: res.message });
    } catch (err: any) {
      // 502 = the AI call failed; the server message says so.
      if (!handleConflict(err)) setError(getErrorMessage(err, 'AI suggestion failed. Try again, or create the template manually.'));
    } finally {
      setBusy(null);
    }
  };

  const confirmSuggest = () => {
    if (!checkDetails()) return;
    Alert.alert(
      'Suggest with AI?',
      `Drafts competencies for "${roleName.trim()}" using AI and saves them as a Draft for you to review. This can take up to a minute or two.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Suggest', onPress: suggest },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <Pressable onPress={step === 'manual' ? () => setStep('details') : onBack} disabled={busy !== null} style={styles.backLink}>
        <ThemedText type="small">{step === 'manual' ? '← Back to details' : '← All templates'}</ThemedText>
      </Pressable>

      {step === 'details' ? (
        <GlassCard>
          <ThemedText type="smallBold">New template</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Role name *</ThemedText>
          <TextInput
            value={roleName}
            onChangeText={setRoleName}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="e.g. Service Advisor"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          {suggestions.length > 0 && (
            <View style={styles.suggestList}>
              {suggestions.map((d) => (
                <Pressable key={d} onPress={() => { setRoleName(d); setFocused(false); }} style={[styles.suggestion, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small">{d}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Category *</ThemedText>
          <CategoryPicker value={category} onChange={setCategory} disabled={busy !== null} />

          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Job description (optional, used only for AI)</ThemedText>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={4000}
            placeholder="Paste a job description for better suggestions"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, styles.multiline, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable onPress={() => { if (checkDetails()) setStep('manual'); }} disabled={busy !== null} style={styles.button}>
            <ThemedText style={styles.buttonLabel}>Start from scratch</ThemedText>
          </Pressable>
          <Pressable onPress={confirmSuggest} disabled={busy !== null} style={[styles.button, styles.ai]}>
            {busy === 'ai' ? (
              <View style={styles.row}>
                <ActivityIndicator color="#ffffff" />
                <ThemedText style={styles.buttonLabel}>Suggesting… this can take a minute</ThemedText>
              </View>
            ) : (
              <ThemedText style={styles.buttonLabel}>Suggest with AI</ThemedText>
            )}
          </Pressable>
        </GlassCard>
      ) : (
        <>
          <ThemedText type="smallBold">{roleName.trim()}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Saved as a Draft — it needs approval before it can be used for interviews.
          </ThemedText>
          <TemplateEditor
            initial={[]}
            submitLabel="Create template"
            submitting={busy === 'manual'}
            error={error}
            onSubmit={createManual}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  label: { marginTop: Spacing.two, marginBottom: Spacing.one },
  input: { minHeight: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, fontSize: 15 },
  multiline: { minHeight: 90, textAlignVertical: 'top', paddingTop: Spacing.two },
  suggestList: { gap: Spacing.half, marginTop: Spacing.one },
  suggestion: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { color: '#B83030', marginTop: Spacing.one },
  button: { marginTop: Spacing.two, minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  ai: { backgroundColor: '#3F5F8A' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
