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

import {Injectable} from '@angular/core';

import {CitedSource} from '../../models/answer-trace.model';
import {ScoreResult, Scorer, ScoringRequest} from '../scorer';

/** Identifier of the deterministic Source Attribution scorer. */
export const SOURCE_ATTRIBUTION_SCORER_ID = 'source-attribution';

/** The level of the trace an expected source is matched against. */
export type ExpectationLevel = 'sources'|'dataStores'|'connectors';

/** One entry of an `expected_sources` cell. */
export interface SourceExpectation {
  level: ExpectationLevel;
  /** The value to look for, trimmed and non-empty. */
  value: string;
}

/** The level prefixes accepted in `expected_sources`, matched ignoring case. */
const LEVEL_PREFIXES: ReadonlyMap<string, ExpectationLevel> = new Map([
  ['sources', 'sources'],
  ['datastores', 'dataStores'],
  ['connectors', 'connectors'],
]);

/**
 * Parses an `expected_sources` cell such as
 * `dataStores:jira-prod;sources:Runbook v2`.
 *
 * Entries are `;`-separated and prefixed with their level: `sources:`,
 * `dataStores:` or `connectors:`. An entry without a recognized prefix is
 * read as `sources:`. Blank entries and repeated entries are dropped.
 * @param cell The raw cell, possibly absent.
 * @returns The distinct expectations, in cell order.
 */
export function parseExpectedSources(cell: string|undefined):
    SourceExpectation[] {
  const expectations: SourceExpectation[] = [];
  const seen = new Set<string>();
  for (const rawEntry of (cell ?? '').split(';')) {
    const entry = rawEntry.trim();
    const separator = entry.indexOf(':');
    const prefixed = separator > 0 ?
        LEVEL_PREFIXES.get(entry.slice(0, separator).trim().toLowerCase()) :
        undefined;
    const level: ExpectationLevel = prefixed ?? 'sources';
    const value = (prefixed ? entry.slice(separator + 1) : entry).trim();
    const key = `${level}:${value}`;
    if (value && !seen.has(key)) {
      seen.add(key);
      expectations.push({level, value});
    }
  }
  return expectations;
}

/**
 * Whether the cited sources satisfy one expectation.
 *
 * Data stores and connectors must equal a cited id exactly, so `sales` cannot
 * pass for `salesforce-crm`. A source matches when its value appears anywhere
 * in a cited document's URI, resource name or title, ignoring case, so a
 * tester can name a page by its title.
 * @param expectation The expectation to check.
 * @param cited The documents the agent cited.
 * @returns Whether any cited document satisfies it.
 */
export function isSatisfied(
    expectation: SourceExpectation, cited: readonly CitedSource[]): boolean {
  const {level, value} = expectation;
  switch (level) {
    case 'dataStores':
      return cited.some(source => source.dataStore === value);
    case 'connectors':
      return cited.some(source => source.connector === value);
    case 'sources': {
      const needle = value.toLowerCase();
      return cited.some(
          source => [source.uri, source.document, source.title].some(
              field => field.toLowerCase().includes(needle)));
    }
    default:
      return false;
  }
}

function roundTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Scores whether the agent cited the sources a row expects, from the answer
 * trace and the row's `expected_sources` column.
 *
 * The score is the share of expected sources that were cited: 2 of 3 scores
 * 0.67, none scores 0 and all score 1. Citing extra sources is not penalized.
 * Rows without an expectation are skipped rather than scored 0.
 */
@Injectable({providedIn: 'root'})
export class SourceAttributionScorer extends Scorer {
  readonly id = SOURCE_ATTRIBUTION_SCORER_ID;
  readonly displayName = 'Source Attribution';
  override readonly description =
      'Measures the share of the sources in the expected_sources column that the agent cited. Rows without expected sources are skipped.';
  override readonly requiresGolden = false;

  override canScore({expectedSources}: ScoringRequest): boolean {
    return parseExpectedSources(expectedSources).length > 0;
  }

  async score({trace, expectedSources}: ScoringRequest):
      Promise<ScoreResult> {
    const expectations = parseExpectedSources(expectedSources);
    if (expectations.length === 0) {
      throw new Error('No expected sources to check.');
    }
    const cited = trace?.citedSources ?? [];
    const matched = expectations.filter(
                                    expectation =>
                                        isSatisfied(expectation, cited))
                        .length;
    return {
      score: roundTwoDecimals(matched / expectations.length),
      details: {
        expected: expectations.length,
        matched,
        cited: cited.length,
      },
    };
  }
}
