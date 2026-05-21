/**
 * Represents the result of comparing two evaluations.
 */
export interface ComparisonResult {
  query: string;
  baselineScore: number;
  recentScore: number;
  delta: number;
}
