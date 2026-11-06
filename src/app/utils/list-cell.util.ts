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
 * Separates the entries of a list-valued CSV cell.
 *
 * A comma is not used because it already separates the CSV columns.
 */
export const LIST_CELL_SEPARATOR = ';';

/**
 * Parses a list-valued CSV cell into its entries.
 *
 * List-valued input columns (`connectors_override` today, and
 * `expected_sources` once the Source Attribution scorer adopts it) should go
 * through this parser so that they all share one format: entries are separated
 * by `;`, surrounding whitespace is trimmed, empty entries are dropped and
 * repeated entries are kept once. Entries may contain spaces. The cell is read
 * as-is; malformed input is not repaired.
 *
 * Line breaks are not separators: a cell written one value per line (for
 * example with Alt+Enter in Sheets) stays a single entry with the line break
 * inside it, which callers will not match. Use `;` between values.
 *
 * @param cell The raw cell value.
 * @returns The distinct entries in the order they first appear, or `undefined`
 *     when the cell has no entries: it is missing, blank, or holds only
 *     separators and whitespace (such as `' ; ; '`). A stray `;` is therefore
 *     read the same as an empty cell, never as an explicit empty list.
 */
export function parseListCell(cell: string|undefined): string[]|undefined {
  const entries = (cell ?? '')
                      .split(LIST_CELL_SEPARATOR)
                      .map(entry => entry.trim())
                      .filter(entry => entry !== '');
  return entries.length > 0 ? [...new Set(entries)] : undefined;
}
