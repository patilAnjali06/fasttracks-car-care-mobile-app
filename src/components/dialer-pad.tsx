import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const MAX_DIGITS = 10;

const KEYS: { digit: string; letters?: string }[] = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0' },
  { digit: '#' },
];
const DISABLED_KEYS = ['*', '#'];

// Valid Indian mobile: 10 digits starting with 6-9.
const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

function formatNumber(digits: string) {
  const spaced = digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  return `+91 ${spaced}`.trimEnd();
}

function helperText(digits: string) {
  if (digits.length === 0) return 'Enter a 10-digit mobile number';
  if (digits.length < MAX_DIGITS) {
    const left = MAX_DIGITS - digits.length;
    return `${left} more digit${left === 1 ? '' : 's'}`;
  }
  return isValidMobile(digits) ? 'Ready to call' : 'Not a valid mobile number';
}

// UI only — Exotel calling is wired up separately. Rendered by the Dialer tab
// of the Calls screen (calls.tsx), which already enforces the role check.
export function DialerPad() {
  const theme = useTheme();
  const [digits, setDigits] = useState('');

  const valid = isValidMobile(digits);
  const complete = digits.length === MAX_DIGITS;

  const press = (d: string) => setDigits((cur) => (cur.length < MAX_DIGITS ? cur + d : cur));
  const backspace = () => setDigits((cur) => cur.slice(0, -1));
  const clear = () => setDigits('');

  const call = () => {
    if (!valid) return;
    Alert.alert('Calling not connected yet', `${formatNumber(digits)}\n\nCalling through Exotel will be added soon.`);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.display}>
          <ThemedText
            style={[styles.number, digits.length === 0 && { color: theme.textMuted }]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {digits.length === 0 ? '+91' : formatNumber(digits)}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor={complete && !valid ? undefined : 'textSecondary'}
            style={complete && !valid ? { color: theme.danger } : valid ? { color: theme.success } : undefined}>
            {helperText(digits)}
          </ThemedText>
        </View>

        <View style={styles.pad}>
          {KEYS.map((k) => {
            const disabled = DISABLED_KEYS.includes(k.digit);
            return (
              <View key={k.digit} style={styles.cell}>
                <Pressable
                  disabled={disabled}
                  onPress={() => press(k.digit)}
                  accessibilityRole="button"
                  accessibilityLabel={k.digit}
                  style={({ pressed }) => [
                    styles.key,
                    { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
                    disabled && styles.disabled,
                  ]}>
                  <ThemedText style={styles.keyDigit}>{k.digit}</ThemedText>
                  {k.letters ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.keyLetters}>
                      {k.letters}
                    </ThemedText>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.pad}>
          <View style={styles.cell}>
            <Pressable
              onPress={clear}
              disabled={digits.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Clear"
              style={[styles.action, { backgroundColor: theme.backgroundElement }, digits.length === 0 && styles.disabled]}>
              <ThemedText type="smallBold">Clear</ThemedText>
            </Pressable>
          </View>
          <View style={styles.cell}>
            <Pressable
              onPress={call}
              disabled={!valid}
              accessibilityRole="button"
              accessibilityLabel="Call"
              style={[styles.action, { backgroundColor: theme.success }, !valid && styles.disabled]}>
              <ThemedText style={styles.callLabel}>Call</ThemedText>
            </Pressable>
          </View>
          <View style={styles.cell}>
            <Pressable
              onPress={backspace}
              onLongPress={clear}
              disabled={digits.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Backspace"
              style={[styles.action, { backgroundColor: theme.backgroundElement }, digits.length === 0 && styles.disabled]}>
              <ThemedText style={styles.backspace}>⌫</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </ThemedView>
  );
}

const KEY_SIZE = 76;

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  inner: { flex: 1, width: '100%', maxWidth: Math.min(MaxContentWidth, 420), padding: Spacing.three, justifyContent: 'center', gap: Spacing.three },
  display: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.three },
  number: { fontSize: 34, lineHeight: 44, fontWeight: '600', letterSpacing: 1 },
  pad: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '33.333%', alignItems: 'center', paddingVertical: Spacing.one + Spacing.half },
  key: { width: KEY_SIZE, height: KEY_SIZE, borderRadius: KEY_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  keyDigit: { fontSize: 28, lineHeight: 32, fontWeight: '500' },
  keyLetters: { fontSize: 10, lineHeight: 12, letterSpacing: 1.5 },
  action: { width: KEY_SIZE, height: KEY_SIZE, borderRadius: KEY_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  callLabel: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  backspace: { fontSize: 26, lineHeight: 30 },
  disabled: { opacity: 0.35 },
});
