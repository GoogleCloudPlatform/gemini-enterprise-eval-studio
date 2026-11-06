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
