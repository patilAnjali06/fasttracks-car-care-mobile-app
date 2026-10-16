import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {/* Part 2 of the nav redesign: down to 2 tabs. Tasks, Customers, and
          every "More" module moved to the side menu (see side-menu.tsx) —
          their screens now live as root-stack siblings, see src/app/_layout.tsx. */}
      <NativeTabs.Trigger name="attendance">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>

      {/* This screen is the WhatsApp conversations thread UI (hits
          /conversations, conversations.ts on the backend) — mislabeled
          "Calls" since an earlier phase. The real call log (Exotel,
          /calls) is a separate screen at src/app/more/calls.tsx, reachable
          from the side menu. Fixed 2026-09-20 while building the dedicated
          Conversations/WhatsApp module for Wave 2 parity — this tab was the
          actual, already-complete implementation of that module the whole
          time, just wrongly labeled. */}
      <NativeTabs.Trigger name="conversations">
        <NativeTabs.Trigger.Label>Conversations</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="message" md="chat" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
