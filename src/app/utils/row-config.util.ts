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
import {ConnectorOption, WEB_SEARCH_CONNECTOR_ID} from '../models/connector.model';
import {CSVRow} from '../models/csv-row.model';

import {parseListCell} from './list-cell.util';

/** Input column that overrides the global connector selection for a row. */
export const CONNECTORS_OVERRIDE_COLUMN = 'connectors_override';

/** Entry of `connectors_override` that turns on web grounding. */
const WEB_SEARCH_TOKEN = 'web_search';

/** Value of `connectors_override` that turns off every connector. */
const NO_CONNECTORS = '[]';

/** Label for a row that used no connectors at all. */
const NO_CONNECTORS_LABEL = '(none)';

/** Label for a row that searched every data store of the engine. */
const ALL_DATA_STORES_LABEL = '(all engine data stores)';

/** What a row asked for, before connector ids are expanded. */
export interface RowConfig {
  /**
   * Connector ids listed in the row's `connectors_override` cell, or
   * `undefined` when the cell is blank and the row inherits the global
   * selection.
   */
  readonly connectorIds?: readonly string[];
  /** Whether web grounding is on for the row. */
  readonly enableWebSearch: boolean;
}

/** The grounding a row is run with. */
export interface RowGrounding {
  /** Data stores to search, without duplicates. */
  readonly dataStoreIds: readonly string[];
  /**
   * Whether to search every data store of the engine. Only true for a row
   * that inherits a global selection with no data stores and Web Search off,
   * which keeps the existing behavior for runs without an override. A row
   * whose override resolves to no data stores searches none instead.
   */
  readonly searchAllDataStores: boolean;
  /** Whether web grounding is on. */
  readonly enableWebSearch: boolean;
  /**
   * Comma-separated connectors the row used, such as
   * `jira-connector, Web Search`, `(all engine data stores)` or `(none)`.
   * Connector ids that the engine does not offer are marked `(not found)`,
   * and ids named while the connector list is unknown are marked
   * `(connectors unavailable)`.
   */
  readonly connectorsUsed: string;
}

/**
 * Reads the row's `connectors_override` cell.
 *
 * A blank or missing cell inherits the global web search setting. Any other
 * value fully overrides it: `web_search` (in any case) turns web grounding on,
 * every other entry is a connector id, and `[]` turns everything off.
 */
export function resolveRowConfig(row: CSVRow, config: AppConfig): RowConfig {
  const cell = row[CONNECTORS_OVERRIDE_COLUMN];
  if (cell?.trim() === NO_CONNECTORS) {
    return {connectorIds: [], enableWebSearch: false};
  }
  const entries = parseListCell(cell);
  if (entries === undefined) {
    return {enableWebSearch: config.enableWebSearch};
  }
  const isWebSearch = (entry: string) =>
      entry.toLowerCase() === WEB_SEARCH_TOKEN;
  return {
    connectorIds: entries.filter(entry => !isWebSearch(entry)),
    enableWebSearch: entries.some(isWebSearch),
  };
}

/**
 * Resolves the data stores, web search setting and connector label a row is
 * run with.
 *
 * Connector ids named by the row are expanded into the searchable data stores
 * of the matching connector. Ids that match no connector with searchable data
 * stores are left out of the request and flagged in the label. A row whose
 * override leaves no data stores (such as `[]`, or only unknown ids) searches
 * no data stores at all, so it returns an ungrounded answer.
 *
 * @param row The input row.
 * @param config The global run configuration.
 * @param connectors The connectors offered by the selected engine, or
 *     `undefined` if they are not known (the widget config has not loaded or
 *     could not be fetched). Connector ids named by a row are then left out
 *     and labelled `(connectors unavailable)` instead of `(not found)`.
 * @returns The grounding to send for the row.
 */
export function resolveRowGrounding(
    row: CSVRow, config: AppConfig,
    connectors: readonly ConnectorOption[]|undefined): RowGrounding {
  const {connectorIds, enableWebSearch} = resolveRowConfig(row, config);
  const {dataStoreIds, labels} = connectorIds === undefined ?
      describeGlobalSelection(
          config.selectedDataStores ?? [], connectors ?? []) :
      expandConnectorIds(connectorIds, connectors);
  const searchAllDataStores = connectorIds === undefined &&
      dataStoreIds.length === 0 && !enableWebSearch;
  if (searchAllDataStores) {
    labels.push(ALL_DATA_STORES_LABEL);
  }
  if (enableWebSearch) {
    labels.push(WEB_SEARCH_CONNECTOR_ID);
  }
  return {
    dataStoreIds,
    searchAllDataStores,
    enableWebSearch,
    connectorsUsed: labels.length > 0 ? labels.join(', ') : NO_CONNECTORS_LABEL,
  };
}

interface ExpandedConnectors {
  dataStoreIds: string[];
  labels: string[];
}

/**
 * Expands connector ids named by a row into their searchable data stores.
 * With no connector list, every id is left out and labelled as unavailable.
 */
function expandConnectorIds(
    connectorIds: readonly string[],
    connectors: readonly ConnectorOption[]|undefined): ExpandedConnectors {
  if (connectors === undefined) {
    return {
      dataStoreIds: [],
      labels: connectorIds.map(id => `${id} (connectors unavailable)`),
    };
  }
  const dataStoreIds = new Set<string>();
  const labels: string[] = [];
  for (const id of connectorIds) {
    const connector = connectors.find(
        c => c.id === id && c.searchableDataStoreIds.length > 0);
    if (connector == null) {
      labels.push(`${id} (not found)`);
      continue;
    }
    connector.searchableDataStoreIds.forEach(ds => dataStoreIds.add(ds));
    labels.push(id);
  }
  return {dataStoreIds: [...dataStoreIds], labels};
}

/**
 * Names the connectors behind the globally selected data stores. A connector
 * counts once all of its data stores are selected, matching the dropdown;
 * selected data stores that belong to no such connector are named by id.
 */
function describeGlobalSelection(
    selectedDataStores: readonly string[],
    connectors: readonly ConnectorOption[]): ExpandedConnectors {
  const selected = new Set(selectedDataStores);
  const labels: string[] = [];
  const described = new Set<string>();
  for (const connector of connectors) {
    if (connector.entityIds.length > 0 &&
        connector.entityIds.every(id => selected.has(id))) {
      labels.push(connector.id);
      connector.entityIds.forEach(id => described.add(id));
    }
  }
  for (const id of selectedDataStores) {
    if (!described.has(id)) {
      labels.push(id);
    }
  }
  return {dataStoreIds: [...selectedDataStores], labels};
}
