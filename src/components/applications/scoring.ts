import type { AiScorecardSummary, AiScreeningResult } from '@/types/api';

// Mirrors backend/src/lib/cvScreen.ts's isDegradedScreening — a result saved
// when screening couldn't actually run carries a placeholder fitScore of 0,
// which must never be shown (or sorted) as if the candidate scored zero.
// Rows saved before the `degraded` flag existed are caught by their all-empty
// shape.
export function isDegradedScreening(r: AiScreeningResult | null | undefined): boolean {
  if (!r) return false;
  if (r.degraded) return true;
  return r.fitScore === 0 && !r.experienceSummary && (r.skillsMatched?.length ?? 0) === 0;
}

export function screeningScore(r: AiScreeningResult | null | undefined): number | null {
  return r && !isDegradedScreening(r) ? r.fitScore : null;
}

// ARIA interview with no answered competency is "not enough data", not 0.
export function scorecardScore(s: AiScorecardSummary | null | undefined): number | null {
  if (!s || s.answeredCount === 0) return null;
  return s.weightedOverallScore;
}

// Same thresholds as the dashboard's scoreVariant.
export function scoreColor(score: number) {
  return score >= 70 ? '#167A48' : score >= 40 ? '#A86018' : '#B83030';
}
