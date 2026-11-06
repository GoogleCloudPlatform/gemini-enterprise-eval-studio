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
 * Non-numeric transition or persistent state between baseline and recent when
 * at least one side was not scored because of an error code.
 */
export type ScoreStatusChange =
    |'recent_failure'
    |'recent_skip'
    |'persistent_failure'
    |'persistent_skip'
    |'recovered';

/**
 * Display labels for each non-numeric status change in the Delta column and
 * comparison cards.
 */
export const SCORE_STATUS_LABELS: Readonly<Record<ScoreStatusChange, string>> =
    {
      recent_failure: 'Recent Failure',
      recent_skip: 'Recent Skip',
      persistent_failure: 'Persistent Failure',
      persistent_skip: 'Persistent Skip',
      recovered: 'Recovered',
    };

/**
 * Badge CSS classes for each `ScoreStatusChange` in the Side-by-Side
 * comparison cards.
 */
export const STATUS_CHANGE_BADGE_CLASSES:
    Readonly<Record<ScoreStatusChange, string>> = {
      recent_failure: 'bg-red-100 text-red-700',
      recent_skip: 'bg-red-100 text-red-700',
      persistent_failure: 'bg-red-100 text-red-700',
      persistent_skip: 'bg-amber-100 text-amber-700',
      recovered: 'bg-green-100 text-green-700',
    };

/**
 * Badge CSS classes keyed by the display label stored in `delta_*` table cells.
 */
export const DELTA_LABEL_BADGE_CLASSES: Readonly<Record<string, string>> = {
  [SCORE_STATUS_LABELS.recent_failure]: 'bg-red-100 text-red-800',
  [SCORE_STATUS_LABELS.recent_skip]: 'bg-red-100 text-red-800',
  [SCORE_STATUS_LABELS.persistent_failure]: 'bg-red-100 text-red-800',
  [SCORE_STATUS_LABELS.persistent_skip]: 'bg-amber-100 text-amber-800',
  [SCORE_STATUS_LABELS.recovered]: 'bg-green-100 text-green-800',
};

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
  /**
   * Transition or persistent status when at least one evaluation was not
   * scored because of an error code.
   */
  statusChange?: ScoreStatusChange;
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
  /** Error code from the baseline evaluation, when present. */
  baselineErrorCode?: string;
  /** Error code from the recent evaluation, when present. */
  recentErrorCode?: string;
}
