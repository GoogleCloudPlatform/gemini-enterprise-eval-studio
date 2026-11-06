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
   * Resource name of the agent every query in the run is sent to, or empty to
   * let the engine's default assistant answer. Chosen from the agents
   * published under the selected engine, so it is cleared whenever the engine
   * changes, and never persisted. See models/agent.model.ts.
   */
  selectedAgent?: string;
  /**
   * Identifiers of the scoring strategies to run against every row, in
   * registry order, which is the order they are applied. Unset means the first
   * registered scorer is used. An empty list means the user cleared the
   * selection, which `ScorerSelection.validate` rejects because a run needs at
   * least one scoring method. See scoring/scorer.registry.ts.
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

/**
 * Authorization state of a connector, as returned by the widget config API.
 * `AUTH_STATE_UNSPECIFIED` is the proto default, so REST responses usually
 * omit `authState` instead of sending it.
 */
export type ConnectorAuthStateValue =
    'AUTH_STATE_UNSPECIFIED'|'AUTHORIZED'|'EXPIRED'|'ACTIONS_DISABLED'|'NO_AUTH';

/** Read-only auth state of a connector in a collection component. */
export interface ConnectorAuthState {
  authState?: ConnectorAuthStateValue;
  authorizationUri?: string;
}

export interface CollectionComponent {
  id?: string;
  displayName?: string;
  dataSource?: string;
  connectorAuthState?: ConnectorAuthState;
  federatedSearchConnectorAuthUri?: string;
  dataStoreComponents?: DataStoreComponent[];
}

export interface WidgetConfigResponse {
  collectionComponents?: CollectionComponent[];
}

