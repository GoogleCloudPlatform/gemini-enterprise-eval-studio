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
 * Represents a row in the input CSV file.
 */
export interface CSVRow {
  query: string;
  golden: string;
  // Optional. Used to group rows into a conversation.
  conversationId?: string;
  /**
   * Optional. Determines execution order within a conversationId
   * (ascending numeric order). If omitted, rows are processed in their
   * original CSV order.
   */
  turn?: string;
  [key: string]: string | undefined;
}

/** The input columns Eval Studio itself interprets. */
const KNOWN_COLUMNS: ReadonlySet<string> =
    new Set(['query', 'golden', 'conversationId', 'turn']);

/**
 * The optional input column listing the sources an answer is expected to
 * cite, read by the Source Attribution scorer.
 */
export const EXPECTED_SOURCES_COLUMN = 'expected_sources';

/**
 * The input columns of a row other than the ones Eval Studio interprets
 * itself, such as `expected_sources`, so they can travel with the result.
 * Values that are not strings, such as the `__parsed_extra` list Papa Parse
 * adds for a line with more fields than headers, are left out.
 * @param row The uploaded row.
 * @returns The extra columns by header, in input order.
 */
export function extraColumns(row: CSVRow): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!KNOWN_COLUMNS.has(key) && typeof value === 'string') {
      extras[key] = value;
    }
  }
  return extras;
}
