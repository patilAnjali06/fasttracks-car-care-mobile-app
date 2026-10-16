import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, FontWeights, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontWeights.medium,
  },
  smallBold: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontWeights.bold,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: FontWeights.medium,
  },
  title: {
    fontSize: 48,
    lineHeight: 52,
    fontFamily: FontWeights.semiBold,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontFamily: FontWeights.semiBold,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: FontWeights.medium,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    fontFamily: FontWeights.medium,
    color: '#7A1C2E',
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
