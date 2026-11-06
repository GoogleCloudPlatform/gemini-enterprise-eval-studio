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

// The answer trace: the evidence an agent cited behind an answer, captured
// from the `streamAssist` response so it can be shown, exported and scored
// rather than only read as text.

/** One document the agent cited for an answer. */
export interface CitedSource {
  /** The document title, or an empty string when the API gave none. */
  title: string;
  /** The document URI, or an empty string when the API gave none. */
  uri: string;
  /**
   * The Discovery Engine document resource name, or an empty string when the
   * citation did not come from an indexed document (e.g. web grounding).
   */
  document: string;
  /**
   * The id of the data store holding the document, parsed from `document`.
   * Empty when `document` names none.
   */
  dataStore: string;
  /**
   * The connector that served the document: the collection holding its data
   * store, parsed from `document`. Empty for data stores in
   * `default_collection`, which no connector manages.
   */
  connector: string;
}

/** The evidence behind a single answer. */
export interface AnswerTrace {
  /** Every distinct document the agent cited, in the order first cited. */
  citedSources: CitedSource[];
}

/** The collection that holds data stores no connector manages. */
const DEFAULT_COLLECTION = 'default_collection';

/** Captures the data store id in a Discovery Engine resource name. */
const DATA_STORE_RE = /(?:^|\/)dataStores\/([^/]+)/;

/** Captures the collection id in a Discovery Engine resource name. */
const COLLECTION_RE = /(?:^|\/)collections\/([^/]+)/;

/**
 * Parses the data store and connector out of a Discovery Engine document
 * resource name, e.g.
 * `projects/p/locations/l/collections/c/dataStores/d/branches/b/documents/x`.
 * @param document The document resource name, possibly empty.
 * @returns The data store id and connector name, each empty when absent.
 */
export function parseDocumentResource(document: string):
    {dataStore: string; connector: string} {
  const dataStore = DATA_STORE_RE.exec(document)?.[1] ?? '';
  const collection = COLLECTION_RE.exec(document)?.[1] ?? '';
  return {
    dataStore,
    connector: collection === DEFAULT_COLLECTION ? '' : collection,
  };
}

/**
 * The distinct non-empty values of one field across the cited sources.
 * @param trace The answer trace, if any.
 * @param field The field to collect.
 * @returns The values in first-cited order, without duplicates.
 */
export function distinctCitedValues(
    trace: AnswerTrace|undefined,
    field: 'dataStore'|'connector'): string[] {
  const values = (trace?.citedSources ?? []).map(source => source[field]);
  return [...new Set(values.filter(value => value))];
}

/**
 * A human readable label for a cited source: its title and URI, or whichever
 * of the two it has.
 * @param source The cited source.
 * @returns The label, e.g. `Refund Policy - https://example.com/refund`.
 */
export function citedSourceLabel(source: CitedSource): string {
  if (source.title && source.uri && source.title !== source.uri) {
    return `${source.title} - ${source.uri}`;
  }
  return source.title || source.uri || source.document;
}

/** An answer trace flattened into one text cell per kind of evidence. */
export interface TraceCells {
  /** One cited source label per line. */
  citedSources: string;
  /** The distinct cited data store ids, comma separated. */
  citedDataStores: string;
  /** The distinct cited connectors, comma separated. */
  citedConnectors: string;
}

/**
 * Flattens an answer trace for the results table and the CSV export. Every
 * cell is present, and empty when nothing of its kind was cited, so every row
 * exports the same columns.
 * @param trace The answer trace, if any.
 * @returns The cells.
 */
export function traceCells(trace: AnswerTrace|undefined): TraceCells {
  return {
    citedSources:
        (trace?.citedSources ?? []).map(citedSourceLabel).join('\n'),
    citedDataStores: distinctCitedValues(trace, 'dataStore').join(', '),
    citedConnectors: distinctCitedValues(trace, 'connector').join(', '),
  };
}
