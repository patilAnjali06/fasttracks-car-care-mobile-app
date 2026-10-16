import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCompanySettings, getErrorMessage, updateCompanySettings } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { usePermissions } from '@/lib/permissions-context';
import type { CompanySettings } from '@/types/api';

// GET /settings/supplier (backend/src/routes/settings_route.ts) is open to
// any authenticated user. CORRECTED 2026-09-28 (re-verification sweep):
// PUT is NOT gated to a flat [OWNER,STORE_MANAGER] role list — the real
// gate is companySettingsLevel(role, tabs) === 'edit'
// (backend/src/lib/companySettingsAccess.ts), which is 'edit' for OWNER/
// STORE_MANAGER OR for any other role granted the settings_company tab at
// full_access via the Configure page's per-employee override. The prior
// EDIT_ROLES-only check would hide the edit form from an employee who'd
// been granted that override, even though the dashboard shows it to them
// and the backend accepts their PUT.
const EDIT_ROLES = ['OWNER', 'STORE_MANAGER'];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const { tabMode } = usePermissions();
  const canEdit = EDIT_ROLES.includes(user?.role ?? '') || tabMode('settings_company') === 'full_access';

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [form, setForm] = useState<Partial<CompanySettings>>({});
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchCompanySettings();
      setSettings(result);
      setForm(result);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load settings.'));
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

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await updateCompanySettings(form);
      setSettings(result);
      setForm(result);
      setIsEditing(false);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save settings.'));
    } finally {
      setIsSaving(false);
    }
  };

  const field = (label: string, key: keyof CompanySettings) => (
    <ThemedView type="backgroundElement" style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      {isEditing ? (
        <TextInput
          value={String(form[key] ?? '')}
          onChangeText={(v) => setForm((prev) => ({ ...prev, [key]: v }))}
          style={[styles.input, { color: theme.text }]}
          placeholderTextColor={theme.textSecondary}
        />
      ) : (
        <ThemedText type="smallBold">{settings ? String(settings[key] ?? '—') : '—'}</ThemedText>
      )}
    </ThemedView>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {settings === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {field('Company Name', 'name')}
          {field('GST Number', 'gstNo')}
          {field('Address', 'address')}
          {field('Phone', 'phone')}
          {field('Email', 'email')}
          {field('Logo URL', 'logoUrl')}
          {canEdit && (
            <TouchableOpacity
              onPress={isEditing ? save : () => setIsEditing(true)}
              disabled={isSaving}
              style={[styles.button, { backgroundColor: theme.primary }]}
            >
              <ThemedText style={styles.buttonText}>
                {isSaving ? 'Saving…' : isEditing ? 'Save Changes' : 'Edit'}
              </ThemedText>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  field: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  input: { fontSize: 15, fontWeight: '600', paddingVertical: Spacing.half },
  button: { borderRadius: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', marginTop: Spacing.two },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
});
