import { Stack } from 'expo-router';

import { MenuButton } from '@/components/menu-button';

export default function TeamChatLayout() {
  return (
    <Stack screenOptions={{ headerLeft: () => <MenuButton /> }}>
      <Stack.Screen name="index" options={{ title: 'Team Chat' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
