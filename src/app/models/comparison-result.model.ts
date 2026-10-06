/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * How one scorer's score moved between the two evaluations of a query.
 */
export interface ScoreComparison {
  /** Display name of the scorer. */
  scorer: string;
  /** The baseline score, or null when the baseline has none for the query. */
  baselineScore: number|null;
  /** The recent score, or null when the recent run has none for the query. */
  recentScore: number|null;
  /** Recent minus baseline, or null when either score is missing. */
  delta: number|null;
}

/**
 * Represents the result of comparing two evaluations.
 */
export interface ComparisonResult {
  query: string;
  /** One entry per scorer present in both evaluations, in baseline order. */
  scores: ScoreComparison[];
  baselineResponse?: string;
  recentResponse?: string;
}
