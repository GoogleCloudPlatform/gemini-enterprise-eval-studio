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
 * Configuration for the evaluation application.
 */
export interface AppConfig {
  projectId: string;
  region: string;
  selectedEngine: string;
  selectedModel: string;
  /**
   * Identifiers of the scoring strategies to run against every row, in the
   * order they are applied. Falls back to the first registered scorer when
   * empty or unset. See scoring/scorer.registry.ts.
   */
  selectedScorers?: string[];
  autoRaterModel: string;
  autoRaterInstruction: string;
  selectedDataStores: string[];
  enableWebSearch: boolean;
  // Restored for no-auth mode
  gCloudToken?: string;
}

/**
 * Represents an evaluation engine.
 */
export interface Engine {
  name: string;
  displayName: string;
  modelConfigs?: {[key: string]: string};
  dataStoreIds?: string[];
}

export interface DataStoreComponent {
  id?: string;
  displayName?: string;
}

export interface CollectionComponent {
  id?: string;
  displayName?: string;
  dataSource?: string;
  connectorAuthState?: any;
  federatedSearchConnectorAuthUri?: string;
  dataStoreComponents?: DataStoreComponent[];
}

export interface WidgetConfigResponse {
  collectionComponents?: CollectionComponent[];
}

