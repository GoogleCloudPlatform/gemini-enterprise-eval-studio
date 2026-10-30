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
 * Tooltip text for the Trace column header explaining trace persistence delay.
 */
export const TRACE_COLUMN_TOOLTIP =
    'Trace links might take some time to appear as traces aren\'t persisted in real time and take some time after Gemini Enterprise has responded.';

/**
 * Represents a row in the evaluation results.
 */
export interface ResultRow {
  query: string;
  golden: string;
  fetched: string;
  thoughts?: string;
  /** Time to First Token in seconds (s). */
  ttft: number;
  /** Time to First Answer Token in seconds (s). */
  ttfa: number;
  /** Time to Last Token in seconds (s). */
  ttlt: number;
  /**
   * One entry per scorer that ran, in run order, carrying each scorer's score
   * and error. Empty when the response could not be fetched.
   */
  scorerResults: ScorerRunResult[];
  assistToken?: string;
  projectId?: string;
  region?: string;
  engineId?: string;
  /**
   * Id of the agent that answered, or empty when the row ran against the
   * engine's default assistant. Recorded beside `engineId` because the same
   * query against the same engine scores differently per agent, so a run is
   * not reproducible without knowing which agent served it.
   */
  agentId?: string;
  traceId?: string;
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
