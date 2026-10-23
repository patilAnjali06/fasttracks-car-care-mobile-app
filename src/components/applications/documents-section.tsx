import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { downloadApplicationFile, getErrorMessage, type ApplicationFileKind } from '@/lib/api';
import type { Application } from '@/types/api';

type DocRow = { kind: ApplicationFileKind; label: string; filename: string; mimeType: string | null };

function documentsOf(a: Application): DocRow[] {
  const rows: DocRow[] = [];
  if (a.resumeFilename) rows.push({ kind: 'resume', label: 'Résumé', filename: a.resumeFilename, mimeType: a.resumeMimeType });
  if (a.aadhaarImageFilename) rows.push({ kind: 'aadhaar-image', label: 'Aadhaar image', filename: a.aadhaarImageFilename, mimeType: a.aadhaarImageMimeType });
  if (a.salarySlipFilename) rows.push({ kind: 'salary-slip', label: 'Salary slip', filename: a.salarySlipFilename, mimeType: a.salarySlipMimeType });
  return rows;
}

function DocumentRow({ applicationId, doc }: { applicationId: string; doc: DocRow }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const isImage = !!doc.mimeType?.startsWith('image/');

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const { uri } = await downloadApplicationFile(applicationId, doc.kind, doc.filename);
      if (isImage) setPreviewUri(uri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, doc.mimeType ? { mimeType: doc.mimeType } : undefined);
      } else if (!isImage) {
        setError('Sharing isn’t available on this device.');
      }
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not open this document.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.flex1}>
          <ThemedText type="smallBold">{doc.label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} ellipsizeMode="middle">{doc.filename}</ThemedText>
        </View>
        <Pressable onPress={open} disabled={loading} style={styles.button}>
          {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <ThemedText style={styles.buttonLabel}>Open</ThemedText>}
        </Pressable>
      </View>
      {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
      {previewUri && <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />}
    </ThemedView>
  );
}

// Lists only the documents the applicant actually uploaded (non-null
// *Filename on the application); renders a short note when there are none.
export function DocumentsSection({ application }: { application: Application }) {
  const docs = documentsOf(application);
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Documents</ThemedText>
      {docs.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">No documents uploaded.</ThemedText>
      ) : (
        docs.map((d) => <DocumentRow key={d.kind} applicationId={application.id} doc={d} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  section: { gap: Spacing.two },
  row: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  button: { minWidth: 72, height: 40, paddingHorizontal: Spacing.three, borderRadius: Spacing.two, backgroundColor: '#7A1C2E', alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#B83030' },
  preview: { width: '100%', height: 220, borderRadius: Spacing.two },
});
