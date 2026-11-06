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

/** Identifier of the pseudo-connector that toggles web grounding. */
export const WEB_SEARCH_CONNECTOR_ID = 'Web Search';

/**
 * Represents a connector option for selection in the UI.
 */
export interface ConnectorOption {
  id: string;
  displayName: string;
  dataSource?: string;
  /**
   * The ids the dropdown selects for this connector and writes into
   * `selectedDataStores`. Usually data store ids, but a connector without data
   * stores carries its collection's placeholder id instead (for example
   * `collections/eua_placeholder_NOTION`). Use `searchableDataStoreIds`, not
   * this, to build a search request.
   */
  entityIds: string[];
  /**
   * The subset of `entityIds` that can ground a query: data stores of
   * authorized connectors. Placeholder ids of connectors without data stores,
   * and data stores of connectors that are not authorized, are left out.
   */
  searchableDataStoreIds: string[];
}
