import { Stack, useLocalSearchParams } from 'expo-router';

import { ScreenStub } from '@/components/screen-stub';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SCREEN_REGISTRY } from '@/constants/screen-registry';

export default function MoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meta = SCREEN_REGISTRY.find((s) => s.id === id);

  if (!meta) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ThemedText>Unknown screen.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: meta.title }} />
      <ScreenStub meta={meta} />
    </>
  );
}
