import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { PermissionGate } from '@/components/permission-gate';
import { TaskEditor } from '@/components/onboarding-templates/task-editor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createOnboardingTemplate,
  fetchOnboardingTemplates,
  getErrorMessage,
  suggestOnboardingTemplate,
  updateOnboardingTemplate,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { OnboardingTaskInput, OnboardingTemplate } from '@/types/api';

// /onboarding-task-templates is router.use(verifyToken, requireHRModuleAccess)
// (backend/src/routes/onboardingTaskTemplates.ts): OWNER/STORE_MANAGER/HR/
// ACCOUNTING pass on role, anyone else needs the hr_module tab — same as
// analytics.tsx and competencies.tsx.
const TEMPLATE_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

// Editor target: an existing template, or a brand-new unsaved one (roleName +
// starting tasks, from "Start from Scratch" or an unsaved AI suggestion).
// `id` keeps the editor's state stable across the create -> update switch.
type Editing = { id: number; template: OnboardingTemplate | null; roleName: string; initialTasks: OnboardingTaskInput[] };
let editorSeq = 0;

function TemplatesContent() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const [templates, setTemplates] = useState<OnboardingTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // "New Onboarding Template" form
  const [creating, setCreating] = useState(false);
  const [roleName, setRoleName] = useState('');
  const [department, setDepartment] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [newError, setNewError] = useState('');

  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates(await fetchOnboardingTemplates());
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load onboarding templates.'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const openEditor = (template: OnboardingTemplate | null, name: string, initialTasks: OnboardingTaskInput[]) => {
    setSaveError(null);
    setSavedAt(null);
    setEditing({ id: editorSeq++, template, roleName: name, initialTasks });
  };

  // Neither path writes to the database — both just hand a task list to the editor.
  const startManual = () => {
    if (!roleName.trim()) { setNewError('Role name is required.'); return; }
    setNewError('');
    openEditor(null, roleName.trim(), [{ label: '', description: '', responsible: '' }]);
    setCreating(false);
  };

  const suggest = async () => {
    if (!roleName.trim()) { setNewError('Role name is required.'); return; }
    setSuggesting(true);
    setNewError('');
    try {
      const tasks = await suggestOnboardingTemplate({ roleName: roleName.trim(), department: department.trim() || undefined });
      openEditor(null, roleName.trim(), tasks);
      setCreating(false);
    } catch (err: any) {
      setNewError(getErrorMessage(err, 'Failed to generate suggestions.'));
    } finally {
      setSuggesting(false);
    }
  };

  const save = async (tasks: OnboardingTaskInput[]) => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      const res = editing.template
        ? await updateOnboardingTemplate(editing.template.id, { tasks })
        : await createOnboardingTemplate({ roleName: editing.roleName, tasks });
      // After a first save the editor keeps going on the saved template, so the
      // next Save is an update.
      setEditing((e) => (e ? { ...e, template: res.template, roleName: res.template.roleName } : e));
      setSavedAt(new Date());
    } catch (err: any) {
      setSaveError(getErrorMessage(err, 'Failed to save template.'));
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    load();
  };

  if (editing) {
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Onboarding Templates' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]} keyboardShouldPersistTaps="handled">
          <TaskEditor
            key={editing.id}
            roleName={editing.roleName}
            initialTasks={editing.template
              ? editing.template.tasks.map((t) => ({ label: t.label, description: t.description ?? undefined, responsible: t.responsible ?? undefined }))
              : editing.initialTasks}
            saving={saving}
            error={saveError}
            savedAt={savedAt}
            onSave={save}
            onBack={closeEditor}
          />
        </ScrollView>
      </View>
    );
  }

  if (creating) {
    const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Onboarding Templates' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => { setCreating(false); setNewError(''); }} disabled={suggesting} style={styles.backLink}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.underline}>← Back to list</ThemedText>
          </Pressable>
          <GlassCard>
            <ThemedText type="smallBold">New Onboarding Template</ThemedText>
            {newError ? <ThemedText style={styles.error}>{newError}</ThemedText> : null}

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>ROLE / DESIGNATION <ThemedText type="small" style={styles.error}>*</ThemedText></ThemedText>
            <TextInput value={roleName} onChangeText={setRoleName} placeholder="e.g. Technician" placeholderTextColor={theme.textSecondary} style={inputStyle} />

            <ThemedText type="small" themeColor="textSecondary" style={styles.label}>DEPARTMENT (OPTIONAL, FOR AI CONTEXT)</ThemedText>
            <TextInput value={department} onChangeText={setDepartment} placeholderTextColor={theme.textSecondary} style={inputStyle} />

            <Pressable onPress={startManual} disabled={suggesting} style={[styles.button, styles.grey]}>
              <ThemedText style={styles.buttonLabel}>Start from Scratch</ThemedText>
            </Pressable>
            <Pressable onPress={suggest} disabled={suggesting} style={styles.button}>
              {suggesting ? (
                <View style={styles.inline}>
                  <ActivityIndicator color="#ffffff" />
                  <ThemedText style={styles.buttonLabel}>Suggesting…</ThemedText>
                </View>
              ) : (
                <ThemedText style={styles.buttonLabel}>Suggest via AI</ThemedText>
              )}
            </Pressable>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Onboarding Templates' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <ThemedText type="small" themeColor="textSecondary">
          Role-specific onboarding checklists, matched against an employee&apos;s designation at creation time. Roles without a template here get the default checklist.
        </ThemedText>

        <Pressable onPress={() => { setNewError(''); setRoleName(''); setDepartment(''); setCreating(true); }} style={styles.newButton}>
          <ThemedText style={styles.buttonLabel}>+ New Template</ThemedText>
        </Pressable>

        {error ? (
          <GlassCard>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </GlassCard>
        ) : templates === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : templates.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No role-specific templates yet — every new employee gets the default checklist.
          </ThemedText>
        ) : (
          templates.map((t) => (
            <Pressable key={t.id} onPress={() => openEditor(t, t.roleName, [])}>
              <ThemedView type="backgroundElement" style={styles.card}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1}>{t.roleName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.tasks.length} task{t.tasks.length === 1 ? '' : 's'} · Last updated {fmtDateTime(t.updatedAt)}
                  </ThemedText>
                </View>
                <ThemedText type="small" style={{ color: theme.primary, fontWeight: '600' }}>Edit</ThemedText>
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function OnboardingTemplatesScreen() {
  const { user } = useAuth();
  if (TEMPLATE_ROLES.includes(user?.role ?? '')) return <TemplatesContent />;
  return (
    <PermissionGate tabKey="hr_module" deniedMessage="Onboarding Templates is available to Owner, Store Manager, HR and Accounting roles, or users granted HR module access.">
      <TemplatesContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  spinner: { marginTop: Spacing.three },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget },
  newButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, minHeight: Layout.minTouchTarget, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: Spacing.three, marginBottom: Spacing.one },
  input: { minHeight: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  error: { color: '#B83030', marginTop: Spacing.one },
  button: { marginTop: Spacing.three, minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  grey: { backgroundColor: '#8A8A8E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
