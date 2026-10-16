import { Stack } from 'expo-router';

import { MenuButton } from '@/components/menu-button';

export default function CustomersLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Customers & Jobs', headerLeft: () => <MenuButton /> }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
