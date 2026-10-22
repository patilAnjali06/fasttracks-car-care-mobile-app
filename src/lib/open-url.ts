import { Alert, Linking } from 'react-native';

// Schemes we allow opening from server- or chat-provided URLs.
// Anything else (javascript:, file:, intent:, etc.) is rejected so a
// crafted URL in backend data can't trigger an unexpected action.
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Safely open an external URL. Only opens known-safe schemes; otherwise
 * it shows a notice instead of silently handing the URL to the OS.
 */
export async function openExternalUrl(url?: string | null): Promise<void> {
  const value = (url ?? '').trim();
  if (!value) return;

  const match = value.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
  const scheme = match ? match[1].toLowerCase() : '';

  if (!scheme || !ALLOWED_SCHEMES.includes(scheme)) {
    Alert.alert('Cannot open link', 'This link type is not supported.');
    return;
  }

  try {
    await Linking.openURL(value);
  } catch {
    Alert.alert('Cannot open link', 'Something went wrong opening this link.');
  }
}
