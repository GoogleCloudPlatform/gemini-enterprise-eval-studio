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

import {AppConfig} from '../models/app-config.model';

/**
 * Everything a scorer receives about a single evaluated row.
 */
export interface ScoringRequest {
  /** The original query sent to the agent. */
  query: string;
  /** The response the agent produced for the query. */
  response: string;
  /** The expected answer, when the uploaded dataset provides one. */
  golden?: string;
  /** The active application configuration. */
  config: AppConfig;
}

/**
 * The outcome a scorer produces for a single evaluated row.
 */
export interface ScoreResult {
  /**
   * Normalized score, where 0.0 is the worst and 1.0 the best. `EvalService`
   * reports anything that is not a finite number in that range as the
   * scorer's error for the row instead of storing it.
   */
  score: number;
  /**
   * Optional scorer-specific sub-metrics (e.g., recall, precision,
   * matchedWords), logged when the scorer runs to aid debugging.
   */
  details?: Record<string, number>;
}

/**
 * The outcome of running one scorer against one row, including the failures
 * and skips that a bare `ScoreResult` cannot express.
 */
export interface ScorerRunResult {
  /** Identifier of the scorer that produced this entry. */
  scorerId: string;
  /** Display name of the scorer, so results stay readable once exported. */
  displayName: string;
  /** Normalized score. Zero when the scorer failed or was skipped. */
  score: number;
  /** The scorer's error message, when it threw. */
  error?: string;
  /**
   * Whether `error` concerns this row's content only, such as a score outside
   * 0.0 to 1.0, rather than the scorer or its backend. A re-rate records such
   * an error on the row and moves on, as a normal run does.
   */
  rowError?: boolean;
  /**
   * Whether the scorer was skipped (because it requires a golden answer and
   * the row has none, or because the row itself is not scorable during
   * re-rating).
   */
  skipped?: boolean;
}

/**
 * A scoring failure that concerns the evaluated row only, such as a score
 * outside 0.0 to 1.0, as opposed to the scorer or its backend failing.
 * `EvalService` records it on the row with `ScorerRunResult.rowError` set.
 */
export class RowScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RowScoreError';
  }
}

/**
 * Describes the first failed scorer in a run, if any.
 * @param results The per-scorer outcomes, in run order.
 * @returns The failing scorer's message, prefixed with its name when several
 *     scorers ran, or undefined when every scorer succeeded.
 */
export function firstScorerError(results: readonly ScorerRunResult[]):
    string|undefined {
  const failed = results.find(result => result.error);
  if (!failed) {
    return undefined;
  }
  // Name the scorer only when several ran, so a single-scorer run keeps
  // reporting the scorer's own message unchanged.
  return results.length > 1 ? `${failed.displayName}: ${failed.error}` :
                              failed.error;
}

/**
 * A strategy for scoring a single agent response.
 *
 * Implementations are Angular services registered in the `SCORERS` token; see
 * `scorer.registry.ts` and `README.md` in this directory for how to add one.
 */
export abstract class Scorer {
  /** Stable identifier, persisted in the app config and exported results. */
  abstract readonly id: string;

  /** Human readable name shown in the configuration form. */
  abstract readonly displayName: string;

  /** Short explanation shown alongside the name in the configuration form. */
  readonly description: string = '';

  /**
   * Whether this scorer needs a golden answer to work. Rows without one are
   * left unscored when this is true.
   */
  readonly requiresGolden: boolean = true;

  /**
   * The `AppConfig` keys this scorer reads. The configuration form renders
   * only the inputs belonging to the currently selected scorers.
   */
  readonly configKeys: ReadonlyArray<keyof AppConfig> = [];

  /**
   * Scores a single response.
   * @param request The query, response, golden answer and active config.
   * @returns A promise resolving to the score.
   * @throws An `Error` with a user facing message when scoring fails.
   */
  abstract score(request: ScoringRequest): Promise<ScoreResult>;

  /**
   * Validates the scorer specific parts of the configuration.
   * @param config The active application configuration.
   * @returns An error message, or undefined when the configuration is usable.
   */
  validate(config: AppConfig): string|undefined {
    return undefined;
  }
}
