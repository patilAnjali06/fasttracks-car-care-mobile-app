/**
 * Fasttracks brand tokens — pulled from the dashboard's own
 * frontend/src/app/globals.css (`--color-*` CSS variables). Keep these in
 * sync with that file if the dashboard's palette ever changes; don't
 * reinvent colors here.
 */
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0F0F12',
    textSecondary: '#5A5A6A',
    textMuted: '#9A9AAA',
    background: '#F6F5F5',
    backgroundElement: '#FFFFFF', // dashboard --color-card
    backgroundSelected: '#E8E0E1', // dashboard --color-border, used for dividers/selected rows
    border: '#E8E0E1',
    primary: '#7A1C2E',
    primaryHover: '#751325',
    success: '#167A48',
    warning: '#A86018',
    danger: '#B83030',
  },
  dark: {
    text: '#F4EEEF',
    textSecondary: '#8A8090',
    textMuted: '#4A3E40',
    background: '#0F0D0D',
    backgroundElement: '#1F1618', // dashboard --color-card (dark)
    backgroundSelected: '#2E2325',
    border: '#2E2325',
    primary: '#8C3B4A',
    primaryHover: '#7A1C2E',
    success: '#36C87E',
    warning: '#E8A828',
    danger: '#E06868',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

// Inter is the dashboard's body typeface (see globals.css's Google Fonts
// import); JetBrains Mono covers its `.font-mono`/data displays.
export const Fonts = Platform.select({
  web: {
    sans: 'Inter, system-ui, -apple-system, sans-serif',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  default: {
    sans: 'Inter_400Regular',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const FontWeights = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Layout standard — added 2026-09-24 during a spacing/density pass across
// the app (most screens were hand-rolling their own `content`/`row` styles
// with no shared reference point, which is how the gap between cards drifted
// to Spacing.two=8 everywhere instead of a real card gap, and list rows had
// no enforced minimum height). New screens should reference these instead
// of picking numbers ad hoc.
export const Layout = {
  screenPaddingH: Spacing.three, // 16 — dashboard-mirror screens; bump to 20 for a screen that reads sparse
  cardPadding: Spacing.three, // 16
  cardGap: 12, // between cards/list rows in a vertical stack — deliberately not on the Spacing scale (12 sits between two=8 and three=16)
  sectionGap: Spacing.four, // 24 — between major sections within a screen
  minTouchTarget: 48, // minimum row/button height
} as const;

// Card/button radii, matching the dashboard's `.card` (12px) and
// `rounded-lg`/`rounded-xl` button sizes.
export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
