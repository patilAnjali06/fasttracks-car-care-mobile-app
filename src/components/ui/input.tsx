import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FontWeights, Radii, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
};

// Dashboard .input-base: surface bg, 1px border, 8px radius, 14px text,
// 10/14 padding. Focus = primary border + a 3px 15% ring; error = danger.
// (The dashboard floats its label; on a phone a plain label above is clearer.)
export function Input({ label, error, hint, required, onFocus, onBlur, ...props }: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  const accent = error ? theme.danger : theme.primary;
  const ring = error || focused ? withAlpha(accent, 0.15) : 'transparent';

  return (
    <View>
      {label ? (
        <ThemedText themeColor={error ? 'danger' : 'textSecondary'} style={styles.label}>
          {label}
          {required ? ' *' : ''}
        </ThemedText>
      ) : null}
      <View style={[styles.ring, { backgroundColor: ring }]}>
        <TextInput
          {...props}
          placeholderTextColor={theme.textMuted}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            styles.input,
            {
              backgroundColor: theme.surface,
              color: theme.text,
              borderColor: error || focused ? accent : theme.border,
            },
            props.multiline && styles.multiline,
          ]}
        />
      </View>
      {error ? (
        <ThemedText themeColor="danger" style={styles.helper}>{error}</ThemedText>
      ) : hint ? (
        <ThemedText themeColor="textMuted" style={styles.helper}>{hint}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, lineHeight: 18, fontFamily: FontWeights.medium, marginBottom: 4 },
  // The ring lives in padding so focusing never shifts the layout.
  ring: { borderRadius: Radii.sm + 3, padding: 3, margin: -3 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: Radii.sm, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: FontWeights.regular },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  helper: { fontSize: 12, lineHeight: 16, marginTop: 4 },
});
