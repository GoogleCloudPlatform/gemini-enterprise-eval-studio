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
 * @fileoverview The naming of the per-scorer columns in the results table and
 * in the CSV it exports. The Run Evaluation tab writes these headers and the
 * Compare Evals tab reads them back, so both sides share this one definition.
 */

/** Suffix naming the column that holds a scorer's scores. */
const SCORE_SUFFIX = ' Score';

/** Suffix naming the column that holds a scorer's errors. */
const ERROR_SUFFIX = ' Error';

/**
 * Header of the column holding a scorer's scores.
 * @param displayName The scorer's display name.
 * @returns The column header, e.g. `Auto Rater Score`.
 */
export function scoreColumnHeader(displayName: string): string {
  return `${displayName}${SCORE_SUFFIX}`;
}

/**
 * Header of the column holding a scorer's errors.
 * @param displayName The scorer's display name.
 * @returns The column header, e.g. `Auto Rater Error`.
 */
export function scoreErrorColumnHeader(displayName: string): string {
  return `${displayName}${ERROR_SUFFIX}`;
}

/** A per-scorer score column found among the headers of a results CSV. */
export interface ScoreColumn {
  /** The display name of the scorer that produced the column. */
  scorer: string;
  /** The column header, exactly as it appears in the CSV. */
  header: string;
}

/**
 * Finds the per-scorer score columns among the headers of a results CSV.
 * Matching ignores case, so a CSV edited by hand still reads back.
 * @param headers The CSV's column headers.
 * @returns One entry per score column, in CSV order.
 */
export function findScoreColumns(headers: readonly string[]): ScoreColumn[] {
  const suffix = SCORE_SUFFIX.toLowerCase();
  return headers
      .filter(
          header => header.length > SCORE_SUFFIX.length &&
              header.toLowerCase().endsWith(suffix))
      .map(header => ({
             scorer: header.slice(0, -SCORE_SUFFIX.length),
             header,
           }));
}
