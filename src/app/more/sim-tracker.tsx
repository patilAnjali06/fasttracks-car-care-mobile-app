import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createSim, deleteSim, fetchSimStats, fetchSims, getErrorMessage, updateSim } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { CreateSimInput, SimCard, SimStats, SimStatus } from '@/types/api';

// GET /sims and GET /sims/stats (backend/src/routes/simRoutes.ts, verified
// 2026-09-19, re-verified 2026-09-24) are open to any authenticated user;
// POST/PUT/DELETE are gated to ADMIN_ROLES=[OWNER,STORE_MANAGER]. Add/edit/
// delete/search were the pending gap — filled 2026-09-24 (full-parity pass).
const ADMIN_ROLES = ['OWNER', 'STORE_MANAGER'];
const STATUSES: SimStatus[] = ['ACTIVE', 'INACTIVE', 'LOST', 'EXPIRED', 'SPARE'];

const emptyForm: CreateSimInput = {
  simNumber: '', mobileNumber: '', operator: '', dataPlan: '', monthlyRent: undefined,
  planExpiry: '', assignedTo: '', purpose: '', deviceName: '', status: 'ACTIVE', notes: '',
};

export default function SimTrackerScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const canManage = ADMIN_ROLES.includes(user?.role ?? '');

  const [stats, setStats] = useState<SimStats | null>(null);
  const [sims, setSims] = useState<SimCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SimStatus | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CreateSimInput>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async (opts?: { search?: string; status?: SimStatus | null }) => {
    setError(null);
    try {
      const s = opts?.search ?? search;
      const st = opts?.status !== undefined ? opts.status : statusFilter;
      const [statResult, list] = await Promise.all([
        fetchSimStats(),
        fetchSims({ search: s.trim() || undefined, status: st ?? undefined }),
      ]);
      setStats(statResult);
      setSims(list);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load SIM data.'));
    }
  }, [search, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced search/filter re-fetch, `load` already depends on these
  }, [search, statusFilter]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const startEdit = (sim: SimCard) => {
    setEditingId(sim.id);
    setForm({
      simNumber: sim.simNumber,
      mobileNumber: sim.mobileNumber ?? '',
      operator: sim.operator,
      dataPlan: sim.dataPlan ?? '',
      monthlyRent: sim.monthlyRent ?? undefined,
      planExpiry: sim.planExpiry ? sim.planExpiry.slice(0, 10) : '',
      assignedTo: sim.assignedTo ?? '',
      purpose: sim.purpose ?? '',
      deviceName: sim.deviceName ?? '',
      status: sim.status,
      notes: sim.notes ?? '',
    });
    setShowForm(true);
  };

  const onSubmit = async () => {
    if (!form.simNumber.trim() || !form.operator.trim()) {
      setError('SIM number and operator are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    const payload: CreateSimInput = {
      ...form,
      simNumber: form.simNumber.trim(),
      operator: form.operator.trim(),
      mobileNumber: form.mobileNumber?.trim() || undefined,
      dataPlan: form.dataPlan?.trim() || undefined,
      planExpiry: form.planExpiry?.trim() || undefined,
      assignedTo: form.assignedTo?.trim() || undefined,
      purpose: form.purpose?.trim() || undefined,
      deviceName: form.deviceName?.trim() || undefined,
      notes: form.notes?.trim() || undefined,
      monthlyRent: form.monthlyRent != null && String(form.monthlyRent) !== '' ? Number(form.monthlyRent) : undefined,
    };
    try {
      if (editingId != null) {
        await updateSim(editingId, payload);
      } else {
        await createSim(payload);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not save this SIM.'));
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = (sim: SimCard) => {
    Alert.alert('Delete SIM card', `Delete "${sim.simNumber}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(sim.id);
          setError(null);
          try {
            await deleteSim(sim.id);
            await load();
          } catch (err: any) {
            setError(getErrorMessage(err, 'Could not delete this SIM.'));
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'SIM Tracker' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {stats === null || sims === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.grid}>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Total</ThemedText>
              <ThemedText type="smallBold">{stats.total}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Active</ThemedText>
              <ThemedText type="smallBold">{stats.active}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Spare</ThemedText>
              <ThemedText type="smallBold">{stats.spare}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Expiring Soon</ThemedText>
              <ThemedText type="smallBold">{stats.expiringSoon}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Lost</ThemedText>
              <ThemedText type="smallBold">{stats.lost}</ThemedText>
            </GlassCard>
            <GlassCard style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">Expired</ThemedText>
              <ThemedText type="smallBold">{stats.expired}</ThemedText>
            </GlassCard>
          </View>

          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search SIM number, mobile, assignee, device"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
            <Pressable onPress={() => setStatusFilter(null)} style={[styles.chip, { backgroundColor: statusFilter === null ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={statusFilter === null ? styles.chipLabelActive : undefined}>All</ThemedText>
            </Pressable>
            {STATUSES.map((s) => (
              <Pressable key={s} onPress={() => setStatusFilter(s)} style={[styles.chip, { backgroundColor: statusFilter === s ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={statusFilter === s ? styles.chipLabelActive : undefined}>{s}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          {canManage && (
            <Pressable onPress={() => (showForm ? resetForm() : setShowForm(true))} style={styles.addButton}>
              <ThemedText style={styles.buttonLabel}>{showForm ? 'Cancel' : '+ Add SIM'}</ThemedText>
            </Pressable>
          )}

          {showForm && (
            <GlassCard style={styles.formCard}>
              <TextInput
                value={form.simNumber}
                onChangeText={(v) => setForm((p) => ({ ...p, simNumber: v }))}
                placeholder="SIM number"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.mobileNumber}
                onChangeText={(v) => setForm((p) => ({ ...p, mobileNumber: v }))}
                placeholder="Mobile number"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.operator}
                onChangeText={(v) => setForm((p) => ({ ...p, operator: v }))}
                placeholder="Operator"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.dataPlan}
                onChangeText={(v) => setForm((p) => ({ ...p, dataPlan: v }))}
                placeholder="Data plan"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.monthlyRent != null ? String(form.monthlyRent) : ''}
                onChangeText={(v) => setForm((p) => ({ ...p, monthlyRent: v ? Number(v) : undefined }))}
                placeholder="Monthly rent"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.planExpiry}
                onChangeText={(v) => setForm((p) => ({ ...p, planExpiry: v }))}
                placeholder="Plan expiry (YYYY-MM-DD)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.assignedTo}
                onChangeText={(v) => setForm((p) => ({ ...p, assignedTo: v }))}
                placeholder="Assigned to"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.deviceName}
                onChangeText={(v) => setForm((p) => ({ ...p, deviceName: v }))}
                placeholder="Device name"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <TextInput
                value={form.purpose}
                onChangeText={(v) => setForm((p) => ({ ...p, purpose: v }))}
                placeholder="Purpose"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              />
              <View style={styles.chipRow}>
                {STATUSES.map((s) => (
                  <Pressable key={s} onPress={() => setForm((p) => ({ ...p, status: s }))} style={[styles.chip, { backgroundColor: form.status === s ? theme.primary : theme.background }]}>
                    <ThemedText type="small" style={form.status === s ? styles.chipLabelActive : undefined}>{s}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={form.notes}
                onChangeText={(v) => setForm((p) => ({ ...p, notes: v }))}
                placeholder="Notes"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[styles.input, styles.notesInput, { color: theme.text, backgroundColor: theme.background }]}
              />
              <Pressable onPress={onSubmit} disabled={isSaving} style={styles.saveButton}>
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>{editingId != null ? 'Save changes' : 'Add SIM'}</ThemedText>}
              </Pressable>
            </GlassCard>
          )}

          <ThemedText type="smallBold" style={styles.sectionTitle}>All SIMs</ThemedText>
          {sims.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No SIM cards.</ThemedText>
          ) : (
            sims.map((sim) => (
              <ThemedView key={sim.id} type="backgroundElement" style={styles.row}>
                <View style={styles.rowTop}>
                  <ThemedText type="smallBold" style={styles.flex1}>{sim.simNumber}</ThemedText>
                  {canManage && (
                    <View style={styles.rowActions}>
                      <Pressable onPress={() => startEdit(sim)}><ThemedText type="link">Edit</ThemedText></Pressable>
                      <Pressable onPress={() => onDelete(sim)} disabled={deletingId === sim.id}>
                        {deletingId === sim.id ? <ActivityIndicator size="small" /> : <ThemedText style={styles.error}>Delete</ThemedText>}
                      </Pressable>
                    </View>
                  )}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {sim.operator} · {sim.status}
                  {sim.assignedTo ? ` · ${sim.assignedTo}` : ''}
                  {sim.deviceName ? ` (${sim.deviceName})` : ''}
                </ThemedText>
                {(sim.dataPlan || sim.monthlyRent != null || sim.planExpiry) && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {[sim.dataPlan, sim.monthlyRent != null ? `₹${sim.monthlyRent}/mo` : null, sim.planExpiry ? `Expires ${sim.planExpiry.slice(0, 10)}` : null]
                      .filter(Boolean).join(' · ')}
                  </ThemedText>
                )}
                {sim.notes && <ThemedText type="small" themeColor="textSecondary">{sim.notes}</ThemedText>}
              </ThemedView>
            ))
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  card: { width: '47%', padding: Spacing.three, gap: Spacing.one },
  sectionTitle: { marginTop: Spacing.two },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowActions: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  notesInput: { minHeight: 60, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  chipScroller: { flexDirection: 'row' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999, marginRight: Spacing.one },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  addButton: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two, backgroundColor: '#7A1C2E' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  formCard: { gap: Spacing.one },
  saveButton: { marginTop: Spacing.two, height: 46, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
});
