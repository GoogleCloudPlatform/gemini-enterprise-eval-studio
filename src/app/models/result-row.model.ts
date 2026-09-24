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

import {ScorerRunResult} from '../scoring/scorer';

/**
 * Represents a row in the evaluation results.
 */
export interface ResultRow {
  query: string;
  golden: string;
  fetched: string;
  /** Time to First Token in seconds (s). */
  ttft: number;
  /** Time to First Answer Token in seconds (s). */
  ttfa: number;
  /** Time to Last Token in seconds (s). */
  ttlt: number;
  score: number;
  /**
   * One entry per scorer that ran, in run order. `scorerResults[0]` is the
   * primary scorer; read its id, score and error from there.
   */
  scorerResults?: ScorerRunResult[];
  assistToken?: string;
  projectId?: string;
  region?: string;
  engineId?: string;
  scoreError?: string;
  traceUrl?: string;
  /** Conversation grouping id, present only for multi-turn rows. */
  conversationId?: string;
  /** Turn number within the conversation. */
  turn?: number;
  /** Discovery Engine session resource name used for/returned by this turn. */
  session?: string;
  /** Turn id returned by the Assistant API for this turn. */
  turnId?: string;
}
