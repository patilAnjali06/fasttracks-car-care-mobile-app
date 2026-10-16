import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/home/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createJobEntry, fetchEmployees, getErrorMessage, lookupCustomerByPhone } from '@/lib/api';
import { usePermissions } from '@/lib/permissions-context';
import type { EmployeeListItem, JobLookupCustomer } from '@/types/api';

// Field-level parity pass, 2026-09-25 — every label, field order, dropdown
// option, and button label below was copied VERBATIM from the dashboard's
// actual JSX (frontend/src/app/(dashboard)/dashboard/entry/page.tsx),
// re-read field-by-field for this pass, not paraphrased. Mirrors the
// dashboard's "New Entry" form, which POSTs to /job-cards.
//
// CORRECTED 2026-09-28 (re-verification sweep): this screen previously had
// NO permission gate at all, on the false premise that POST /job-cards and
// GET /job-cards/lookup required only verifyToken. Re-read against current
// backend/src/routes/job_cards.ts: both routes call hasCJAccess(user) (role
// default or a per-employee customers_jobs permission override), and POST /
// additionally 403s when the caller's customers_jobs mode is 'view_only'.
// Gated the same way customers/[id].tsx already does — tabMode('customers_jobs'),
// canWrite = mode !== null && mode !== 'view_only' — instead of letting a
// view_only or unauthorized user fill out the whole form and only discover
// it's blocked on submit.
//
// One data gap, noted rather than worked around: the dashboard's "existing
// customer" status line reads "✓ Existing customer · N visits" using a
// visitCount field GET /crm/customers/lookup doesn't return to this app
// (only id/name/phone/vehicles) — shown here as "✓ Existing customer"
// without the count, closest faithful rendering with the data available.
//
// Inspection photo upload is a separate flow on the dashboard too (upload
// happens after the job card is created, not as part of this POST) —
// mirrored the same way: on success this screen now opens the new job
// card's detail view (built earlier this pass, with its own photo
// upload), instead of the Pipeline list, so "add inspection photos" is
// the natural next step exactly as it is on the dashboard.
const SOURCE_OPTIONS = [
  { value: '', label: '— Select source —' },
  { value: 'INSTAGRAM_FACEBOOK', label: 'Instagram / Facebook' },
  { value: 'FAMILY_FRIENDS', label: 'Family & Friends' },
  { value: 'GOOGLE_SEARCH', label: 'Google Search' },
  { value: 'WALK_IN', label: 'Walk In' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'INTERNAL_EMPLOYEE', label: 'Internal Employee' },
  { value: 'KNOWN_TO_OWNER', label: 'Known to Owner' },
];
const FUEL_OPTIONS = [
  { value: '', label: '— Select —' },
  { value: 'Petrol', label: 'Petrol' },
  { value: 'Diesel', label: 'Diesel' },
  { value: 'Electric', label: 'Electric' },
  { value: 'CNG', label: 'CNG' },
  { value: 'Hybrid', label: 'Hybrid' },
];

export default function NewEntryScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { status: permStatus, tabMode } = usePermissions();
  const cjMode = tabMode('customers_jobs');
  const canWrite = cjMode !== null && cjMode !== 'view_only';

  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerRole, setCustomerRole] = useState<'OWNER' | 'DRIVER'>('OWNER');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerGSTIN, setCustomerGSTIN] = useState('');
  const [customerSource, setCustomerSource] = useState('');
  const [noVehicle, setNoVehicle] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleFuel, setVehicleFuel] = useState('');
  const [vehicleColour, setVehicleColour] = useState('');
  const [estimatedTotal, setEstimatedTotal] = useState('');
  const [reasonForVisit, setReasonForVisit] = useState('');
  const [handledById, setHandledById] = useState('');
  const [visitDate, setVisitDate] = useState('');

  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [existingCustomer, setExistingCustomer] = useState<JobLookupCustomer | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, not a render loop
    fetchEmployees().then(setEmployees).catch(() => {});
  }, []);

  const lookup = useCallback(async (phone: string) => {
    if (phone.trim().length < 10) {
      setExistingCustomer(null);
      return;
    }
    setIsLookingUp(true);
    try {
      const found = await lookupCustomerByPhone(phone.trim());
      setExistingCustomer(found);
      if (found) {
        setCustomerName((prev) => prev || found.name);
      }
    } catch {
      setExistingCustomer(null);
    } finally {
      setIsLookingUp(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => lookup(customerPhone), 500);
    return () => clearTimeout(t);
  }, [customerPhone, lookup]);

  const isNewCustomerWithPhone = !existingCustomer && customerPhone.trim().length >= 10;

  const onSubmit = async () => {
    setError(null);
    if (!customerName.trim()) {
      setError('Customer name is required');
      return;
    }
    if (!noVehicle && !vehicleNumber.trim()) {
      setError('Vehicle number is required');
      return;
    }
    if (!reasonForVisit.trim()) {
      setError('Reason for visit is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createJobEntry({
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        customerGSTIN: customerGSTIN.trim() || undefined,
        customerSource: customerSource || undefined,
        noVehicle,
        vehicleNumber: noVehicle ? '' : vehicleNumber.trim(),
        vehicleMake: vehicleMake.trim() || undefined,
        vehicleModel: vehicleModel.trim() || undefined,
        vehicleYear: vehicleYear.trim() || undefined,
        vehicleFuel: vehicleFuel || undefined,
        vehicleColour: vehicleColour.trim() || undefined,
        reasonForVisit: reasonForVisit.trim(),
        customerRole,
        ownerName: customerRole === 'DRIVER' ? ownerName.trim() || undefined : undefined,
        ownerPhone: customerRole === 'DRIVER' ? ownerPhone.trim() || undefined : undefined,
        handledById: handledById || undefined,
        visitDate: visitDate.trim() || undefined,
        estimatedTotal: estimatedTotal.trim() ? Number(estimatedTotal) : undefined,
      });
      router.replace(`/customers/job/${result.jobCard.id}` as never);
    } catch (err: any) {
      setError(getErrorMessage(err, 'Failed to create job card'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (permStatus === 'idle' || permStatus === 'loading') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!canWrite) {
    return (
      <>
        <Stack.Screen options={{ title: 'New Entry' }} />
        <ThemedView style={styles.center}>
          <ThemedText themeColor="textSecondary">
            New Entry is not available for your account — you don&apos;t have write access to Customers &amp; Jobs.
          </ThemedText>
        </ThemedView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New Entry' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.three }]}>
        <ThemedText type="small" themeColor="textSecondary">
          Create a job card and draft invoice for a new vehicle visit
        </ThemedText>

        <GlassCard style={styles.card}>
          <ThemedText type="smallBold">Customer</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Phone Number</ThemedText>
          <TextInput
            value={customerPhone}
            onChangeText={setCustomerPhone}
            placeholder="10-digit phone number"
            placeholderTextColor={theme.textSecondary}
            keyboardType="phone-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          {isLookingUp && <ActivityIndicator style={styles.inlineSpinner} />}
          {!isLookingUp && existingCustomer && (
            <ThemedText type="small" themeColor="textSecondary">✓ Existing customer</ThemedText>
          )}
          {!isLookingUp && isNewCustomerWithPhone && (
            <ThemedText type="small" themeColor="textSecondary">✦ New customer</ThemedText>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Full Name *</ThemedText>
          <TextInput
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Customer full name"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>This person is the</ThemedText>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setCustomerRole('OWNER')} style={[styles.chip, { backgroundColor: customerRole === 'OWNER' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={customerRole === 'OWNER' ? styles.chipLabelActive : undefined}>🧑 Owner</ThemedText>
            </Pressable>
            <Pressable onPress={() => setCustomerRole('DRIVER')} style={[styles.chip, { backgroundColor: customerRole === 'DRIVER' ? theme.primary : theme.backgroundElement }]}>
              <ThemedText type="small" style={customerRole === 'DRIVER' ? styles.chipLabelActive : undefined}>🚗 Driver / Representative</ThemedText>
            </Pressable>
          </View>

          {customerRole === 'DRIVER' && (
            <>
              <ThemedText type="smallBold" style={styles.fieldLabel}>Actual Car Owner (optional)</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Owner Name</ThemedText>
              <TextInput
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="Owner's full name"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <ThemedText type="small" themeColor="textSecondary">Owner Phone</ThemedText>
              <TextInput
                value={ownerPhone}
                onChangeText={setOwnerPhone}
                placeholder="10-digit number without +91"
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Email</ThemedText>
          <TextInput
            value={customerEmail}
            onChangeText={setCustomerEmail}
            placeholder="optional"
            placeholderTextColor={theme.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>GSTIN</ThemedText>
          <TextInput
            value={customerGSTIN}
            onChangeText={setCustomerGSTIN}
            placeholder="optional"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          {isNewCustomerWithPhone && (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>How did they find us?</ThemedText>
              <View style={styles.chipRow}>
                {SOURCE_OPTIONS.map((o) => (
                  <Pressable key={o.value} onPress={() => setCustomerSource(o.value)} style={[styles.chip, { backgroundColor: customerSource === o.value ? theme.primary : theme.backgroundElement }]}>
                    <ThemedText type="small" style={customerSource === o.value ? styles.chipLabelActive : undefined}>{o.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </GlassCard>

        <GlassCard style={styles.card}>
          <View style={styles.toggleRow}>
            <ThemedText type="smallBold">Vehicle</ThemedText>
          </View>
          <View style={styles.toggleRow}>
            <ThemedText type="small">No vehicle — enquiry/consultation only</ThemedText>
            <Switch value={noVehicle} onValueChange={setNoVehicle} />
          </View>
          {noVehicle ? (
            <ThemedText type="small" themeColor="textSecondary">
              Walk-in / No Vehicle — job card will be created without vehicle details
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Vehicle Number *</ThemedText>
              <TextInput
                value={vehicleNumber}
                onChangeText={setVehicleNumber}
                placeholder="e.g. TS07JK2255"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Make</ThemedText>
                  <TextInput
                    value={vehicleMake}
                    onChangeText={setVehicleMake}
                    placeholder="e.g. Toyota"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </View>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Model</ThemedText>
                  <TextInput
                    value={vehicleModel}
                    onChangeText={setVehicleModel}
                    placeholder="e.g. Fortuner"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Year</ThemedText>
                  <TextInput
                    value={vehicleYear}
                    onChangeText={setVehicleYear}
                    placeholder="e.g. 2022"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </View>
                <View style={styles.flex1}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Fuel Type</ThemedText>
                  <View style={styles.chipRow}>
                    {FUEL_OPTIONS.map((f) => (
                      <Pressable key={f.value} onPress={() => setVehicleFuel(f.value)} style={[styles.chip, { backgroundColor: vehicleFuel === f.value ? theme.primary : theme.backgroundElement }]}>
                        <ThemedText type="small" style={vehicleFuel === f.value ? styles.chipLabelActive : undefined}>{f.label}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Colour</ThemedText>
              <TextInput
                value={vehicleColour}
                onChangeText={setVehicleColour}
                placeholder="e.g. White"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </>
          )}
        </GlassCard>

        <GlassCard style={styles.card}>
          <ThemedText type="smallBold">Job Details</ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Estimated Total (₹)</ThemedText>
          <TextInput
            value={estimatedTotal}
            onChangeText={setEstimatedTotal}
            placeholder="Optional rough quote, e.g. 3500"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Reason for Visit *</ThemedText>
          <TextInput
            value={reasonForVisit}
            onChangeText={setReasonForVisit}
            placeholder="Describe the work to be done…"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, styles.noteInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Handled By *</ThemedText>
          <View style={styles.chipRow}>
            {employees.map((e) => (
              <Pressable key={e.id} onPress={() => setHandledById((cur) => (cur === e.id ? '' : e.id))} style={[styles.chip, { backgroundColor: handledById === e.id ? theme.primary : theme.backgroundElement }]}>
                <ThemedText type="small" style={handledById === e.id ? styles.chipLabelActive : undefined}>
                  {e.designation ? `${e.name} (${e.designation})` : e.name}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Visit Date</ThemedText>
          <TextInput
            value={visitDate}
            onChangeText={setVisitDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
        </GlassCard>

        <ThemedText type="small" themeColor="textSecondary">
          Inspection Photos can be added from the job card after it&apos;s created.
        </ThemedText>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable onPress={onSubmit} disabled={isSubmitting} style={styles.button}>
          {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Create Job Card &amp; Draft Invoice</ThemedText>}
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  card: { gap: Spacing.one },
  fieldLabel: { marginTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  flex1: { flex: 1 },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  noteInput: { minHeight: 70, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  inlineSpinner: { alignSelf: 'flex-start' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: 999 },
  chipLabelActive: { color: '#ffffff', fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  error: { color: '#B83030' },
  button: { height: 48, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
});
