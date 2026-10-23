import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarChart } from '@/components/analytics/bar-chart';
import { GlassCard } from '@/components/home/glass-card';
import { PermissionGate } from '@/components/permission-gate';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  approveCompetencyTemplate,
  archiveCompetencyTemplate,
  deleteCompetencyTemplate,
  fetchCompetencyTemplate,
  fetchCompetencyTemplates,
  getErrorMessage,
  unarchiveCompetencyTemplate,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CompetencyCategory, CompetencyTemplateListItem, CompetencyTemplateStatus } from '@/types/api';

// /competency-templates is router.use(verifyToken, requireHRModuleAccess)
// (backend/src/routes/competencyTemplates.ts): OWNER/STORE_MANAGER/HR/
// ACCOUNTING pass on role, anyone else needs the hr_module tab — same as
// analytics.tsx.
const COMPETENCY_ROLES = ['OWNER', 'STORE_MANAGER', 'HR', 'ACCOUNTING'];

const CATEGORY_LABELS: Record<CompetencyCategory, string> = {
  WORKSHOP: 'Workshop',
  CUSTOMER_SALES: 'Customer & Sales',
  OFFICE_ADMIN: 'Office & Admin',
  TECH_IT: 'Tech & IT',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusColor(status: CompetencyTemplateStatus) {
  return status === 'APPROVED' ? '#167A48' : '#A86018';
}

function StatusBadge({ status, archived }: { status: CompetencyTemplateStatus; archived: boolean }) {
  const label = archived ? 'Archived' : status === 'APPROVED' ? 'Approved' : 'Draft';
  return (
    <View style={[styles.badge, { backgroundColor: archived ? '#8A8A8E' : statusColor(status) }]}>
      <ThemedText type="small" style={styles.badgeLabel}>{label}</ThemedText>
    </View>
  );
}

function usageText(n: number) {
  return `${n} candidate${n === 1 ? '' : 's'} used`;
}

function CompetenciesContent() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const [showArchived, setShowArchived] = useState(false);
  const [items, setItems] = useState<CompetencyTemplateListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // includeArchived=true returns ONLY the archived roles.
      setItems(await fetchCompetencyTemplates(showArchived));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load competency templates.'));
    }
  }, [showArchived]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount / view change
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const selected = selectedId ? items?.find((t) => t.id === selectedId) ?? null : null;

  // Refresh the open template from GET /:id (competency text etc.) and merge it
  // over the list row, which alone carries usageCount/liveStatus.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetchCompetencyTemplate(selectedId)
      .then((fresh) => {
        if (cancelled) return;
        setItems((list) => (list ? list.map((t) => (t.id === selectedId ? { ...t, ...fresh } : t)) : list));
      })
      .catch(() => {
        // Keep showing the list row — it already has everything the view needs.
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const backToList = () => {
    setSelectedId(null);
    setActionError(null);
  };

  // Approve is optimistic (flip to Approved, revert if the server refuses).
  const approve = async (t: CompetencyTemplateListItem) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const prev = { status: t.status, liveStatus: t.liveStatus };
    setItems((list) => (list ? list.map((x) => (x.id === t.id ? { ...x, status: 'APPROVED', liveStatus: 'APPROVED' } : x)) : list));
    try {
      const res = await approveCompetencyTemplate(t.id);
      setNotice(res.message ?? 'Approved.');
    } catch (err: any) {
      setItems((list) => (list ? list.map((x) => (x.id === t.id ? { ...x, ...prev } : x)) : list));
      setActionError(getErrorMessage(err, 'Could not approve the template.'));
    } finally {
      setBusy(false);
    }
  };

  // Archive / unarchive / delete move the role out of the current view, so they
  // wait for the server, then return to the list and reload.
  const runThenBack = async (fn: () => Promise<{ message?: string }>, fallback: string) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fn();
      setNotice(res.message ?? 'Done.');
      setSelectedId(null);
      await load();
    } catch (err: any) {
      setActionError(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const confirmArchive = (t: CompetencyTemplateListItem) => {
    Alert.alert(
      `Archive "${t.roleName}"?`,
      `Hides it from the list and stops it being offered to new applications.${
        t.usageCount > 0 ? ` ${usageText(t.usageCount)} it, and they are unaffected.` : ''
      } It can be restored anytime — nothing is deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', onPress: () => runThenBack(() => archiveCompetencyTemplate(t.id), 'Could not archive the template.') },
      ],
    );
  };

  const confirmDelete = (t: CompetencyTemplateListItem) => {
    Alert.alert(
      `Delete "${t.roleName}"?`,
      'This permanently deletes the template and all its versions. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runThenBack(() => deleteCompetencyTemplate(t.id), 'Could not delete the template.') },
      ],
    );
  };

  if (selected) {
    const archived = !!selected.archivedAt;
    const total = selected.competencies.reduce((s, c) => s + c.weightage, 0);
    const canDelete = selected.usageCount === 0;
    return (
      <View style={styles.flex1}>
        <Stack.Screen options={{ title: 'Competencies' }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable onPress={backToList} style={styles.backLink}>
            <ThemedText type="small">← All templates</ThemedText>
          </Pressable>

          <GlassCard>
            <ThemedText type="smallBold">{selected.roleName}</ThemedText>
            <View style={styles.badgeRow}>
              <StatusBadge status={selected.liveStatus} archived={archived} />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {[selected.category ? CATEGORY_LABELS[selected.category] : null, `Version ${selected.version}`, selected.source === 'AI_SUGGESTED' ? 'AI suggested' : null]
                .filter(Boolean).join(' · ')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{usageText(selected.usageCount)} · updated {fmtDate(selected.updatedAt)}</ThemedText>
            {selected.status === 'DRAFT' && selected.liveStatus === 'APPROVED' && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.cardNote}>
                An earlier approved version is still live for this role; approve this draft to replace it.
              </ThemedText>
            )}
          </GlassCard>

          <GlassCard>
            <ThemedText type="smallBold">Competencies ({selected.competencies.length})</ThemedText>
            <ThemedText type="small" themeColor={total === 100 ? 'textSecondary' : undefined} style={total === 100 ? styles.cardNote : [styles.cardNote, styles.warn]}>
              Weightage total: {total}%{total === 100 ? '' : ' — must add up to 100 to approve'}
            </ThemedText>
            <BarChart
              rows={selected.competencies.map((c) => ({ label: c.name, value: c.weightage }))}
              max={100}
              format={(v) => `${v}%`}
            />
            {selected.competencies.some((c) => c.description) && (
              <View style={styles.descList}>
                {selected.competencies.filter((c) => c.description).map((c) => (
                  <View key={c.id}>
                    <ThemedText type="small">{c.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{c.description}</ThemedText>
                  </View>
                ))}
              </View>
            )}
          </GlassCard>

          {actionError && <ThemedText style={styles.error}>{actionError}</ThemedText>}
          {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

          {!archived && selected.status === 'DRAFT' && (
            <Pressable onPress={() => approve(selected)} disabled={busy} style={[styles.button, styles.green]}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Approve</ThemedText>}
            </Pressable>
          )}
          {archived ? (
            <Pressable
              onPress={() => runThenBack(() => unarchiveCompetencyTemplate(selected.id), 'Could not restore the template.')}
              disabled={busy}
              style={styles.button}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Unarchive</ThemedText>}
            </Pressable>
          ) : (
            <Pressable onPress={() => confirmArchive(selected)} disabled={busy} style={[styles.button, styles.grey]}>
              <ThemedText style={styles.buttonLabel}>Archive</ThemedText>
            </Pressable>
          )}
          {canDelete ? (
            <Pressable onPress={() => confirmDelete(selected)} disabled={busy} style={[styles.button, styles.red]}>
              <ThemedText style={styles.buttonLabel}>Delete</ThemedText>
            </Pressable>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Used in interviews, so it can&apos;t be deleted — archive it instead.
            </ThemedText>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      <Stack.Screen options={{ title: 'Competencies' }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.chipRow}>
          {([false, true] as const).map((archived) => (
            <Pressable
              key={String(archived)}
              onPress={() => { if (archived !== showArchived) { setItems(null); setShowArchived(archived); } setNotice(null); }}
              style={[styles.chip, { backgroundColor: showArchived === archived ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={showArchived === archived ? styles.chipLabelActive : undefined}>
                {archived ? 'Archived' : 'Active'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {showArchived ? 'Archived roles — restore or delete them.' : 'Per-role competency templates used for AI interviews.'}
        </ThemedText>

        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

        {error ? (
          <GlassCard>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <Pressable onPress={load} style={styles.button}>
              <ThemedText style={styles.buttonLabel}>Retry</ThemedText>
            </Pressable>
          </GlassCard>
        ) : items === null ? (
          <ActivityIndicator style={styles.spinner} />
        ) : items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {showArchived ? 'No archived templates.' : 'No competency templates yet.'}
          </ThemedText>
        ) : (
          items.map((t) => (
            <Pressable key={t.id} onPress={() => { setSelectedId(t.id); setActionError(null); setNotice(null); }}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="smallBold" numberOfLines={1} ellipsizeMode="tail">{t.roleName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.competencies.length} competenc{t.competencies.length === 1 ? 'y' : 'ies'} · {usageText(t.usageCount)}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Updated {fmtDate(t.updatedAt)}</ThemedText>
                </View>
                <StatusBadge status={t.liveStatus} archived={!!t.archivedAt} />
              </ThemedView>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default function CompetenciesScreen() {
  const { user } = useAuth();
  if (COMPETENCY_ROLES.includes(user?.role ?? '')) return <CompetenciesContent />;
  return (
    <PermissionGate tabKey="hr_module" deniedMessage="Competencies is available to Owner, Store Manager, HR and Accounting roles, or users granted HR module access.">
      <CompetenciesContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  spinner: { marginTop: Spacing.three },
  backLink: { minHeight: Layout.minTouchTarget, justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.four },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, borderRadius: Spacing.four },
  badgeLabel: { color: '#ffffff', fontWeight: '600' },
  badgeRow: { flexDirection: 'row', marginVertical: Spacing.one },
  cardNote: { marginTop: Spacing.one, marginBottom: Spacing.two },
  warn: { color: '#A86018' },
  descList: { gap: Spacing.two, marginTop: Spacing.three },
  error: { color: '#B83030' },
  notice: { color: '#167A48' },
  button: { minHeight: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  green: { backgroundColor: '#167A48' },
  grey: { backgroundColor: '#8A8A8E' },
  red: { backgroundColor: '#B83030' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
