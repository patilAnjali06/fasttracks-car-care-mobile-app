import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Layout, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCustomers, getErrorMessage } from '@/lib/api';
import type { CustomerListItem } from '@/types/api';

const MIN_DIGITS = 3;
const MAX_DIGITS = 10;
const DEBOUNCE_MS = 400;

// Digits only; drops a pasted +91 / 91 country code (only when the number is
// longer than 10 digits, so typing "91…" as a real number prefix still works)
// and a leading 0, then caps at 10.
function normalizePhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d.length > MAX_DIGITS && d.startsWith('91')) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d.slice(0, MAX_DIGITS);
}

type Settled = { key: string; customers: CustomerListItem[] | null; error: string | null };

// Search customers by phone number only (GET /crm/customers?searchBy=phone).
export function CustomerPhoneSearch() {
  const theme = useTheme();
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [retry, setRetry] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  const key = `${digits}:${retry}`;

  useEffect(() => {
    if (digits.length < MIN_DIGITS) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetchCustomers(digits, { searchBy: 'phone' });
        if (!cancelled) setSettled({ key, customers: res.customers, error: null });
      } catch (err: any) {
        if (!cancelled) setSettled({ key, customers: null, error: getErrorMessage(err, 'Could not search customers.') });
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [digits, key]);

  const belowMin = digits.length < MIN_DIGITS;
  const current = !belowMin && settled?.key === key ? settled : null;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.inner}>
        <TextInput
          value={digits}
          onChangeText={(v) => setDigits(normalizePhone(v))}
          placeholder="Search customer by phone number"
          placeholderTextColor={theme.textSecondary}
          keyboardType="phone-pad"
          maxLength={14}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
          {belowMin ? (
            <ThemedText type="small" themeColor="textSecondary">Type at least 3 digits</ThemedText>
          ) : !current ? (
            <ActivityIndicator style={styles.spinner} />
          ) : current.error ? (
            <View style={styles.results}>
              <ThemedText type="small" style={{ color: theme.danger }}>{current.error}</ThemedText>
              <Pressable
                onPress={() => setRetry((n) => n + 1)}
                accessibilityRole="button"
                style={[styles.retry, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.retryLabel}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : current.customers && current.customers.length > 0 ? (
            current.customers.map((c) => (
              <Pressable key={c.id} onPress={() => router.push(`/customers/${c.id}` as never)} accessibilityRole="button">
                <ThemedView type="backgroundElement" style={styles.row}>
                  <ThemedText type="smallBold">{c.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{c.phone}</ThemedText>
                </ThemedView>
              </Pressable>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">No customer with this number</ThemedText>
          )}
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: MaxContentWidth, padding: Spacing.three, gap: Spacing.three },
  input: { height: 46, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, fontSize: 15 },
  results: { gap: Layout.cardGap },
  spinner: { marginTop: Spacing.three },
  row: { borderRadius: Spacing.three, padding: Spacing.three, minHeight: Layout.minTouchTarget, gap: Spacing.half },
  retry: { alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.two },
  retryLabel: { color: '#ffffff', fontWeight: '600' },
});
