/**
 * Represents a row in the evaluation results.
 */
export interface ResultRow {
  query: string;
  golden: string;
  fetched: string;
  /** Time to First Token. */
  ttft: number;
  /** Time to First User Facing Token. */
  tfuft: number;
  latency: number;
  score: number;
}
