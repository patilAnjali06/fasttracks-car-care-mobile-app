import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Layout } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deletePolicy,
  fetchDeviceAlerts,
  fetchDeviceAppUsage,
  fetchDeviceLocationLogs,
  fetchDevices,
  fetchRolePolicies,
  generateEnrollmentCode,
  getErrorMessage,
  lockDevice,
  markDeviceAlertRead,
  savePolicy,
  unlockDevice,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { DeviceAlert, DeviceAppUsage, DeviceLocationLog, DeviceRow, RoleAppPolicy } from '@/types/api';

// CORRECTED 2026-09-28 (re-verification sweep): this list was missing
// SOCIAL_MEDIA, INVENTORY_MANAGER, ACCOUNTING, HOUSEKEEPING — the backend's
// validRoles for GET/POST/DELETE /devices/policies/:role
// (backend/src/routes/devices.ts) is a fixed 12-role list, matching the
// dashboard's own ROLES array. Without these 4, an owner couldn't view or
// set app policies for those roles on mobile even though the backend and
// dashboard both fully support it.
const POLICY_ROLES = [
  'OWNER', 'STORE_MANAGER', 'SALES', 'TECHNICIAN', 'TECH_TEAM', 'SOCIAL_MEDIA',
  'STAFF', 'INVENTORY_MANAGER', 'ACCOUNTING', 'CASHIER', 'HR', 'HOUSEKEEPING',
];
const DEVICE_TYPES = ['ANDROID', 'IOS'];

// MDM_ADMIN_ROLES=[OWNER,STORE_MANAGER,HR] (backend/src/routes/devices.ts,
// verified 2026-09-19) gates GET /, /alerts, /:id, /:id/location-logs,
// /:id/app-usage, /policies/:role, and generate-code (re-verified
// 2026-09-24). Lock/unlock is narrower — requireOwnerMgr=[OWNER,
// STORE_MANAGER] — mirrored via OWNER_MGR_ROLES below. Policy write
// (POST/DELETE /policies) is OWNER-only.
//
// Lock/unlock, alert dismiss, generate-enrollment-code, and policy add/
// delete added 2026-09-24 (full-parity pass) — lockDevice/unlockDevice/
// markDeviceAlertRead already existed unused in api.ts from an earlier
// pass. Device *enrollment* itself (POST /devices/enroll) stays out of
// scope — that's called by the device being enrolled (an MDM agent app),
// not initiated by an admin from this employee-facing app; generating
// the handoff code is the admin action that belongs here.
const MDM_ADMIN_ROLES = ['OWNER', 'STORE_MANAGER', 'HR'];
const OWNER_MGR_ROLES = ['OWNER', 'STORE_MANAGER'];

export default function DevicesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user } = useAuth();
  const isAuthorized = MDM_ADMIN_ROLES.includes(user?.role ?? '');
  const canLockUnlock = OWNER_MGR_ROLES.includes(user?.role ?? '');
  const isOwner = user?.role === 'OWNER';

  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [locationLogs, setLocationLogs] = useState<Record<string, DeviceLocationLog[]>>({});
  const [appUsage, setAppUsage] = useState<Record<string, DeviceAppUsage[]>>({});
  const [policyRole, setPolicyRole] = useState<string | null>(null);
  const [policies, setPolicies] = useState<RoleAppPolicy[] | null>(null);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [dismissingAlertId, setDismissingAlertId] = useState<string | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState<{ code: string; expiresIn: string } | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const [newPolicyAppName, setNewPolicyAppName] = useState('');
  const [newPolicyPackage, setNewPolicyPackage] = useState('');
  const [newPolicyDeviceType, setNewPolicyDeviceType] = useState('ANDROID');
  const [newPolicyAllowed, setNewPolicyAllowed] = useState(true);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthorized) return;
    setError(null);
    try {
      const [d, a] = await Promise.all([fetchDevices(), fetchDeviceAlerts()]);
      setDevices(d);
      setAlerts(a);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not load devices.'));
    }
  }, [isAuthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    load();
  }, [load]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!locationLogs[id] && !appUsage[id]) {
      try {
        const [logs, usage] = await Promise.all([fetchDeviceLocationLogs(id), fetchDeviceAppUsage(id)]);
        setLocationLogs((prev) => ({ ...prev, [id]: logs }));
        setAppUsage((prev) => ({ ...prev, [id]: usage }));
      } catch {
        // leave the section blank; the row itself already loaded fine
      }
    }
  };

  const onToggleLock = (d: DeviceRow) => {
    Alert.alert(
      d.isLocked ? 'Unlock device?' : 'Lock device?',
      `${d.isLocked ? 'Unlock' : 'Lock'} "${d.deviceName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: d.isLocked ? 'Unlock' : 'Lock',
          style: d.isLocked ? 'default' : 'destructive',
          onPress: async () => {
            setBusyDeviceId(d.id);
            setError(null);
            try {
              const updated = d.isLocked ? await unlockDevice(d.id) : await lockDevice(d.id);
              setDevices((prev) => prev?.map((row) => (row.id === d.id ? updated : row)) ?? prev);
            } catch (err: any) {
              setError(getErrorMessage(err, `Could not ${d.isLocked ? 'unlock' : 'lock'} this device.`));
            } finally {
              setBusyDeviceId(null);
            }
          },
        },
      ]
    );
  };

  const onDismissAlert = async (id: string) => {
    setDismissingAlertId(id);
    setError(null);
    try {
      await markDeviceAlertRead(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not dismiss this alert.'));
    } finally {
      setDismissingAlertId(null);
    }
  };

  const onGenerateCode = async () => {
    setIsGeneratingCode(true);
    setError(null);
    try {
      const res = await generateEnrollmentCode();
      setEnrollmentCode({ code: res.enrollmentCode, expiresIn: res.expiresIn });
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not generate an enrollment code.'));
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const onSavePolicy = async () => {
    if (!policyRole || !newPolicyAppName.trim()) {
      setPoliciesError('An app name is required.');
      return;
    }
    setIsSavingPolicy(true);
    setPoliciesError(null);
    try {
      await savePolicy({
        role: policyRole, appName: newPolicyAppName.trim(),
        packageName: newPolicyPackage.trim() || undefined,
        deviceType: newPolicyDeviceType, isAllowed: newPolicyAllowed,
      });
      setNewPolicyAppName(''); setNewPolicyPackage(''); setNewPolicyAllowed(true);
      setShowNewPolicy(false);
      setPolicies(await fetchRolePolicies(policyRole));
    } catch (err: any) {
      setPoliciesError(getErrorMessage(err, 'Could not save this policy.'));
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const onDeletePolicy = (policy: RoleAppPolicy) => {
    Alert.alert('Delete policy', `Delete the ${policy.appName} policy for ${policyRole}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deletePolicy(policy.id);
          if (policyRole) setPolicies(await fetchRolePolicies(policyRole));
        } catch (err: any) {
          setPoliciesError(getErrorMessage(err, 'Could not delete this policy.'));
        }
      } },
    ]);
  };

  const selectPolicyRole = async (role: string) => {
    setPolicyRole(role);
    setPolicies(null);
    setPoliciesError(null);
    try {
      setPolicies(await fetchRolePolicies(role));
    } catch (err: any) {
      setPoliciesError(getErrorMessage(err, 'Could not load policies.'));
    }
  };

  if (!isAuthorized) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">
          Devices is only available to Owner, Store Manager, or HR accounts.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Devices' }} />
      {error && <ThemedText style={styles.error}>{error}</ThemedText>}
      {devices === null ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {isAuthorized && (
            <ThemedView type="backgroundElement" style={styles.alertsWrap}>
              <ThemedText type="smallBold">Enroll a device</ThemedText>
              {enrollmentCode ? (
                <>
                  <ThemedText type="title" style={styles.codeText}>{enrollmentCode.code}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">Expires in {enrollmentCode.expiresIn}</ThemedText>
                </>
              ) : (
                <Pressable onPress={onGenerateCode} disabled={isGeneratingCode} style={styles.smallButton}>
                  {isGeneratingCode ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Generate code</ThemedText>}
                </Pressable>
              )}
            </ThemedView>
          )}
          {alerts.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.alertsWrap}>
              <ThemedText type="smallBold">Unread Alerts ({alerts.length})</ThemedText>
              {alerts.slice(0, 5).map((a) => (
                <View key={a.id} style={styles.alertRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
                    {a.alertType}: {a.message}
                  </ThemedText>
                  <Pressable onPress={() => onDismissAlert(a.id)} disabled={dismissingAlertId === a.id}>
                    <ThemedText type="small" style={{ color: theme.primary }}>Dismiss</ThemedText>
                  </Pressable>
                </View>
              ))}
            </ThemedView>
          )}
          {devices.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No devices.</ThemedText>
          ) : (
            devices.map((d) => (
              <TouchableOpacity key={d.id} onPress={() => toggleExpand(d.id)} activeOpacity={0.8}>
                <ThemedView type="backgroundElement" style={styles.row}>
                  <ThemedText type="smallBold">{d.deviceName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {d.deviceType} · {d.user?.name ?? 'Unassigned'} · {d.isOnline ? 'Online' : 'Offline'}
                    {d.isLocked ? ' · Locked' : ''}
                  </ThemedText>
                  {canLockUnlock && (
                    <Pressable
                      onPress={() => onToggleLock(d)}
                      disabled={busyDeviceId === d.id}
                      style={[styles.smallButton, d.isLocked ? styles.unlockButton : styles.lockButton]}
                    >
                      {busyDeviceId === d.id ? (
                        <ActivityIndicator color="#ffffff" size="small" />
                      ) : (
                        <ThemedText style={styles.buttonLabel}>{d.isLocked ? 'Unlock' : 'Lock'}</ThemedText>
                      )}
                    </Pressable>
                  )}
                  {expandedId === d.id && (
                    <ThemedView style={styles.detailWrap}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Recent locations: {locationLogs[d.id]?.length ?? '…'}
                      </ThemedText>
                      {locationLogs[d.id]?.slice(0, 3).map((l) => (
                        <ThemedText key={l.id} type="small" themeColor="textSecondary">
                          {l.latitude.toFixed(4)}, {l.longitude.toFixed(4)} — {new Date(l.createdAt).toLocaleString()}
                        </ThemedText>
                      ))}
                      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionGap}>
                        App usage: {appUsage[d.id]?.length ?? '…'}
                      </ThemedText>
                      {appUsage[d.id]?.slice(0, 5).map((u) => (
                        <ThemedText key={u.id} type="small" themeColor="textSecondary">
                          {u.appName} — {u.usageMinutes} min ({u.date})
                        </ThemedText>
                      ))}
                    </ThemedView>
                  )}
                </ThemedView>
              </TouchableOpacity>
            ))
          )}

          <View style={styles.policyHeaderRow}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>App Policies by Role</ThemedText>
            {isOwner && policyRole && (
              <Pressable onPress={() => setShowNewPolicy((v) => !v)}>
                <ThemedText type="small" style={{ color: theme.primary }}>
                  {showNewPolicy ? 'Cancel' : '+ Add policy'}
                </ThemedText>
              </Pressable>
            )}
          </View>
          <View style={styles.roleRow}>
            {POLICY_ROLES.map((role) => (
              <TouchableOpacity key={role} onPress={() => selectPolicyRole(role)}>
                <ThemedView type={policyRole === role ? 'backgroundSelected' : 'backgroundElement'} style={styles.roleChip}>
                  <ThemedText type="small">{role}</ThemedText>
                </ThemedView>
              </TouchableOpacity>
            ))}
          </View>
          {policiesError && <ThemedText style={styles.error}>{policiesError}</ThemedText>}
          {isOwner && showNewPolicy && policyRole && (
            <ThemedView type="backgroundElement" style={styles.editBlock}>
              <TextInput
                placeholder="App name"
                value={newPolicyAppName}
                onChangeText={setNewPolicyAppName}
                style={[styles.input, { color: theme.text }]}
                placeholderTextColor={theme.textSecondary}
              />
              <TextInput
                placeholder="Package name (optional)"
                value={newPolicyPackage}
                onChangeText={setNewPolicyPackage}
                style={[styles.input, { color: theme.text }]}
                placeholderTextColor={theme.textSecondary}
              />
              <View style={styles.roleRow}>
                {DEVICE_TYPES.map((t) => (
                  <TouchableOpacity key={t} onPress={() => setNewPolicyDeviceType(t)}>
                    <ThemedView type={newPolicyDeviceType === t ? 'backgroundSelected' : 'background'} style={styles.roleChip}>
                      <ThemedText type="small">{t}</ThemedText>
                    </ThemedView>
                  </TouchableOpacity>
                ))}
              </View>
              <Pressable onPress={() => setNewPolicyAllowed((v) => !v)} style={styles.checkboxRow}>
                <ThemedView type={newPolicyAllowed ? 'backgroundSelected' : 'background'} style={styles.roleChip}>
                  <ThemedText type="small">{newPolicyAllowed ? 'Allowed' : 'Blocked'}</ThemedText>
                </ThemedView>
              </Pressable>
              <Pressable onPress={onSavePolicy} disabled={isSavingPolicy} style={styles.smallButton}>
                {isSavingPolicy ? <ActivityIndicator color="#ffffff" size="small" /> : <ThemedText style={styles.buttonLabel}>Save policy</ThemedText>}
              </Pressable>
            </ThemedView>
          )}
          {policyRole && !policies && !policiesError && <ActivityIndicator style={styles.spinner} />}
          {policies && (
            <ThemedView type="backgroundElement" style={styles.row}>
              {policies.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No policies configured for {policyRole}.</ThemedText>
              ) : (
                policies.map((p) => (
                  <View key={p.id} style={styles.alertRow}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.flex1}>
                      {p.appName} ({p.deviceType}) — {p.isAllowed ? 'Allowed' : 'Blocked'}
                    </ThemedText>
                    {isOwner && (
                      <Pressable onPress={() => onDeletePolicy(p)}>
                        <ThemedText type="small" style={{ color: '#B83030' }}>Delete</ThemedText>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </ThemedView>
          )}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Layout.cardGap, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  error: { color: '#B83030', marginHorizontal: Spacing.three, marginTop: Spacing.two },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  alertsWrap: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  detailWrap: { marginTop: Spacing.two, gap: Spacing.half },
  sectionGap: { marginTop: Spacing.one },
  sectionTitle: { marginTop: Spacing.two },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  roleChip: { borderRadius: Spacing.two, paddingVertical: Spacing.half, paddingHorizontal: Spacing.two },
  policyHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex1: { flex: 1 },
  codeText: { letterSpacing: 4 },
  smallButton: { borderRadius: Spacing.two, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#2E7D32' },
  lockButton: { backgroundColor: '#B83030' },
  unlockButton: { backgroundColor: '#2E7D32' },
  buttonLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  editBlock: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  input: { fontSize: 14, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderRadius: Spacing.two, borderWidth: StyleSheet.hairlineWidth, borderColor: '#8884' },
  checkboxRow: { flexDirection: 'row' },
});
