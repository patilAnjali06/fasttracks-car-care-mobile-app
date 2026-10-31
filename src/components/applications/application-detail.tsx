import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiInterviewInviteSection } from '@/components/applications/ai-interview-invite-section';
import { AiScreeningSection } from '@/components/applications/ai-screening-section';
import { CANDIDATE_QUESTION_LABELS, fmtDateTime } from '@/components/applications/application-format';
import { DocumentsSection } from '@/components/applications/documents-section';
import { InterviewSection } from '@/components/applications/interview-section';
import { PracticalQuestionsSection } from '@/components/applications/practical-questions-section';
import { ThemedText } from '@/components/themed-text';
import { FontWeights, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentWidth } from '@/lib/drawer-context';
import type { ApplicationRowData } from '@/types/api';

type Props = {
  application: ApplicationRowData;
  onClose: () => void;
  onChanged: (a: ApplicationRowData) => void;
};

function Row({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <ThemedText style={[styles.body, full && styles.full]}>
      <ThemedText themeColor="textMuted" style={styles.body}>{label}: </ThemedText>
      {value}
    </ThemedText>
  );
}

// The dashboard's expanded "Candidate Details" modal: candidate info, the
// Aadhaar self-declaration note, the candidate's own answers, then the
// screening / interview / assessment sections, in the same order. Full screen
// on a phone; the content is the same on a wide screen.
export function ApplicationDetail({ application, onClose, onChanged }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useContentWidth() >= 560;
  const { width } = useWindowDimensions();
  const a = application;

  const answers = a.candidateQuestionAnswers;
  const hasAnswers = !!answers && Object.keys(answers).length > 0;
  const inPipeline = !a.convertedUserId && a.status !== 'REJECTED';
  const hasSignals = (x?: unknown) => !!x;
  const hasRowDetails = !!(a.hasAadhaar || a.aadhaarImageFilename) || hasAnswers || a.status === 'MANAGER_INTERVIEW' || !!a.aiScreeningResult || hasSignals(a.aiInterviewScorecard) || hasSignals(a.aiAssignmentScorecard);

  const panel = [styles.panel, { backgroundColor: theme.surface, borderBottomColor: theme.border }];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.title} numberOfLines={1}>{a.name} — Candidate Details</ThemedText>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four, maxWidth: Math.min(width, 900) }]} keyboardShouldPersistTaps="handled">
          <View style={panel}>
            <ThemedText themeColor="textMuted" style={styles.sectionTitle}>CANDIDATE DETAILS (FROM THE APPLICATION LINK)</ThemedText>
            <View style={[styles.grid, wide && styles.gridWide]}>
              <Row label="Email" value={a.email || '—'} />
              <Row label="Phone" value={a.phone || '—'} />
              {a.dateOfBirth ? (
                <Row label="Date of Birth" value={new Date(a.dateOfBirth).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} />
              ) : a.age != null ? (
                <Row label="Age" value={`${a.age} (recorded before Date of Birth was added)`} />
              ) : null}
              <Row label="Fresher" value={a.fresher == null ? '—' : a.fresher ? 'Yes' : 'No'} />
              {a.currentAddress ? <Row label="Current Address" value={a.currentAddress} full /> : null}
              {a.permanentAddress ? <Row label="Permanent Address" value={a.permanentAddress} full /> : null}
              {a.notes ? <Row label="Notes" value={a.notes} full /> : null}
            </View>
          </View>

          {a.hasAadhaar || a.aadhaarImageFilename ? (
            <View style={panel}>
              <ThemedText style={[styles.small, { color: a.aadhaarSelfDeclared ? theme.textSecondary : theme.warning }]}>
                {a.aadhaarSelfDeclared
                  ? `✓ Candidate self-declared this Aadhaar as genuine${a.aadhaarSelfDeclaredAt ? ` on ${fmtDateTime(a.aadhaarSelfDeclaredAt)}` : ''} — not verified by HR.`
                  : '⚠ Aadhaar not self-declared by the candidate — verify it manually before relying on it.'}
              </ThemedText>
            </View>
          ) : null}

          {hasAnswers ? (
            <View style={panel}>
              <ThemedText themeColor="textMuted" style={styles.sectionTitle}>CANDIDATE-PROVIDED ANSWERS (OPTIONAL CONTEXT, NOT HR-VERIFIED)</ThemedText>
              <View style={styles.answers}>
                {CANDIDATE_QUESTION_LABELS.filter(({ key }) => answers?.[key]).map(({ key, label }) => (
                  <View key={key}>
                    <ThemedText themeColor="textMuted" style={[styles.small, styles.questionLabel]}>{label}</ThemedText>
                    <ThemedText style={styles.body}>{answers?.[key]}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <AiScreeningSection application={a} onApplicationChanged={(next) => onChanged(next as ApplicationRowData)} />
          <AiInterviewInviteSection application={a} />
          {inPipeline ? <InterviewSection application={a} onApplicationChanged={(next) => onChanged(next as ApplicationRowData)} /> : null}
          {a.status === 'ASSESSMENT' ? <ThemedText themeColor="textMuted" style={styles.sectionTitle}>ASSESSMENT STAGE</ThemedText> : null}
          <PracticalQuestionsSection application={a} />
          <DocumentsSection application={a} />

          {!hasRowDetails ? (
            <ThemedText themeColor="textMuted" style={styles.small}>
              No screening, interview or assessment activity yet — those and the interview schedule will appear here as the candidate moves through the pipeline.
            </ThemedText>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 20, paddingRight: 8, minHeight: 56, borderBottomWidth: 1 },
  title: { flex: 1, fontSize: 16, lineHeight: 22, fontFamily: FontWeights.bold },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 12, width: '100%', alignSelf: 'center' },
  panel: { padding: 16, gap: 8, borderRadius: Radii.md, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 12, lineHeight: 16, fontFamily: FontWeights.bold, letterSpacing: 0.8 },
  grid: { gap: 4 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  full: { width: '100%' },
  body: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 18 },
  answers: { gap: 8 },
  questionLabel: { fontFamily: FontWeights.medium },
});
