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

import {CommonModule} from '@angular/common';
import {HttpErrorResponse} from '@angular/common/http';
import {ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {Agent, agentDisplayName} from '../../../models/agent.model';
import {AppConfig, CollectionComponent, ConnectorAuthStateValue, DataStoreComponent, Engine, WidgetConfigResponse} from '../../../models/app-config.model';
import {ConnectorOption, WEB_SEARCH_CONNECTOR_ID} from '../../../models/connector.model';
import {ScorerSelection} from '../../../scoring/scorer-selection';
import {listAutoRaterModels, resolveAutoRaterLocation} from '../../../scoring/scorers/auto-rater.scorer';
import {AgentListService, AgentListState} from '../../../services/agent-list.service';
import {apiErrorMessage} from '../../../services/api-error';
import {AuthService} from '../../../services/auth.service';
import {EvalBackendService} from '../../../services/eval-backend.service';
import {StateService} from '../../../services/state.service';
import {CONNECTORS_OVERRIDE_COLUMN, connectorOverrideId} from '../../../utils/row-config.util';
import {InfoTooltipComponent} from '../../shared/info-tooltip/info-tooltip.component';
import {ScoringSetupComponent} from '../../shared/scoring-setup/scoring-setup.component';


interface EnginesResponse {
  engines?: Engine[];
}


interface ConnectorRule {
  readonly key: string;
  readonly displayName: string;
  readonly dataSource: string;
  readonly matchers: readonly string[];
}

const CONNECTOR_RULES: readonly ConnectorRule[] = [
  {
    key: 'NOTION',
    displayName: 'Notion',
    dataSource: 'NOTION',
    matchers: ['notion']
  },
  {key: 'JIRA', displayName: 'Jira', dataSource: 'JIRA', matchers: ['jira']},
  {
    key: 'CONFLUENCE',
    displayName: 'Confluence',
    dataSource: 'CONFLUENCE',
    matchers: ['confluence']
  },
  {
    key: 'SALESFORCE',
    displayName: 'Salesforce',
    dataSource: 'SALESFORCE',
    matchers: ['salesforce']
  },
  {
    key: 'SHAREPOINT',
    displayName: 'SharePoint',
    dataSource: 'SHAREPOINT',
    matchers: ['sharepoint']
  },
  {
    key: 'SERVICENOW',
    displayName: 'ServiceNow',
    dataSource: 'SERVICENOW',
    matchers: ['servicenow', 'service-now', 'service now']
  },
  {
    key: 'BIG_QUERY',
    displayName: 'BigQuery',
    dataSource: 'BIG_QUERY',
    matchers: ['bigquery', 'bq-']
  },
  {
    key: 'GCS',
    displayName: 'Cloud Storage',
    dataSource: 'GCS',
    matchers: ['gcs', 'cloud-storage', 'cloud storage']
  },
];

const DATA_SOURCE_DISPLAY_NAMES: Record<string, string> =
    Object.fromEntries(CONNECTOR_RULES.map(r => [r.dataSource, r.displayName]));

/** Ends a message with a period unless it already ends a sentence. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Auth states whose connector can serve search requests for the user. */
const SEARCHABLE_AUTH_STATES: ReadonlySet<ConnectorAuthStateValue> =
    new Set(['AUTHORIZED', 'NO_AUTH', 'ACTIONS_DISABLED']);

/**
 * Returns whether a connector's data stores can be searched by the current
 * user.
 *
 * A component without `connectorAuthState` involves no end-user
 * authorization, so it is searchable. Otherwise only `AUTHORIZED`, `NO_AUTH`
 * and `ACTIONS_DISABLED` (search works, actions do not) are searchable. A
 * missing `authState` is the proto default `AUTH_STATE_UNSPECIFIED`, which the
 * API returns for a connector the user has not signed in to; it and `EXPIRED`
 * are not searchable. Data stores of connectors that are not searchable are
 * kept out of the per-row lookup so that a row naming them is flagged
 * `(not found)` rather than looking like a grounded run.
 */
function isAuthorized(component: CollectionComponent): boolean {
  const authState = component.connectorAuthState;
  if (authState == null) {
    return true;
  }
  return authState.authState != null &&
      SEARCHABLE_AUTH_STATES.has(authState.authState);
}

/**
 * Component for configuring evaluation settings.
 */
@Component({
  selector: 'app-config-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InfoTooltipComponent,
    ScoringSetupComponent,
  ],
  templateUrl: './config-form.component.html'
})
export class ConfigFormComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  @Output() readonly next = new EventEmitter<void>();
  @Input() isRunQueries = false;
  /**
   * Whether a run is in progress. Every row of a run uses the settings
   * captured when it started, so the form is made read-only meanwhile rather
   * than accepting edits that would not apply until the next run.
   */
  @Input() locked = false;
  @ViewChild('dropdownContainer') dropdownContainer?: ElementRef;

  config: AppConfig = {
    projectId: '',
    region: 'global',
    selectedEngine: '',
    selectedModel: '',
    selectedAgent: '',
    autoRaterModel: '',
    autoRaterInstruction: '',
    selectedDataStores: [],
    enableWebSearch: false
  };

  /**
   * The auto-rater models on offer. Rendered by `ScoringSetupComponent`; kept
   * here so an incoming configuration that names no model, or one this auth
   * mode or location cannot use, is defaulted and persisted before a run
   * starts.
   */
  autoRaterModels: string[] = listAutoRaterModels(true);
  private currentAutoRaterLocation = 'global';

  engines: Engine[] = [];
  models: string[] = [];
  loading = false;
  errorMessage = '';

  /**
   * The agent list of the selected engine, shared with the settings form of
   * the other tab through `AgentListService`.
   */
  private agentList: AgentListState = {status: 'idle', agents: []};

  isDropdownOpen = false;
  connectorSearchQuery = '';
  connectors: ConnectorOption[] = [];

  constructor(
      private readonly stateService: StateService,
      private readonly cdr: ChangeDetectorRef,
      readonly authService: AuthService,
      private readonly evalBackendService: EvalBackendService,
      private readonly scorerSelection: ScorerSelection,
      private readonly agentListService: AgentListService,
  ) {}

  /** The agents of the selected engine that can serve a query. */
  get agents(): Agent[] {
    return this.agentList.agents;
  }

  /** Whether the agent list of the selected engine is loading. */
  get agentsLoading(): boolean {
    return this.agentList.status === 'loading';
  }

  /**
   * Why the agent list is empty when the cause is a failed lookup rather than
   * an engine with no agents. It is shown beside the picker instead of in
   * `errorMessage`, which belongs to the engine fetch, because an engine whose
   * agents cannot be listed can still be evaluated with its default assistant.
   */
  get agentsErrorMessage(): string {
    if (this.agentList.status !== 'failed') {
      return '';
    }
    return asSentence(
        `Could not list agents: ${this.describeError(this.agentList.error)}`);
  }

  ngOnInit() {
    if (!this.authService.showCredentialInputs) {
      this.autoRaterModels = listAutoRaterModels(false);
    }

    this.stateService.config$.pipe(takeUntil(this.destroy$))
        .subscribe((c: AppConfig) => {
          const engineChanged = this.config.selectedEngine !== c.selectedEngine;
          this.config = structuredClone(c);
          // Reconcile everything before persisting once: `setConfig` emits
          // synchronously back into this subscriber.
          const scorersChanged = this.scorerSelection.normalize(this.config);
          if (this.engines.length > 0) {
            this.updateModelsForSelectedEngine();
            if (engineChanged) {
              this.fetchConnectorsForSelectedEngine();
              this.fetchAgentsForSelectedEngine();
            }
          }
          this.syncAutoRaterModelsForLocation();
          const autoRaterModelChanged = this.normalizeAutoRaterModel();
          if (scorersChanged || autoRaterModelChanged) {
            this.onConfigChange();
          }
        });

    this.stateService.engines$.pipe(takeUntil(this.destroy$))
        .subscribe((engines: Engine[]) => {
          this.engines = engines;
          if (this.config.selectedEngine && this.engines.length > 0) {
            this.updateModelsForSelectedEngine();
            this.fetchConnectorsForSelectedEngine();
            this.fetchAgentsForSelectedEngine();
          }
        });

    this.stateService.errorMessage$.pipe(takeUntil(this.destroy$))
        .subscribe((errorMessage: string) => {
          this.errorMessage = errorMessage;
        });

    this.agentListService.state$.pipe(takeUntil(this.destroy$))
        .subscribe((agentList: AgentListState) => {
          this.agentList = agentList;
          if (agentList.status === 'loaded' || agentList.status === 'failed') {
            this.dropUnofferedSelectedAgent();
            this.cdr.detectChanges();
          }
        });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Fetches engines from the discovery engine API.
   */
  fetchEngines() {
    this.errorMessage = '';
    this.stateService.setErrorMessage('');
    if (!this.config.projectId) {
      this.errorMessage = 'Please provide Project ID';
      return;
    }
    this.loading = true;

    this.evalBackendService.fetchEngines(this.config.projectId, this.config.region, this.config)
        .then((engines) => {
          this.loading = false;
          if (engines && engines.length > 0) {
            this.engines = engines.map((e: Engine) => ({
              name: e.name,
              displayName: e.displayName || e.name,
              modelConfigs: e.modelConfigs,
              dataStoreIds: e.dataStoreIds
            }));

            const keepsEngine =
                this.engines.some(e => e.name === this.config.selectedEngine);
            if (!keepsEngine) {
              this.config.selectedEngine = this.engines[0].name;
            }
            // Reloading the engines reloads their agents too. The selection is
            // settled before the engines are published, so that every form
            // asks for the same engine's agents and shares one request.
            this.agentListService.clear();
            this.onEngineChange(/* engineChanged= */ !keepsEngine);
            this.stateService.setEngines(this.engines);
          } else {
            this.engines = [];
            this.stateService.setEngines([]);
            this.errorMessage = 'No engines found.';
          }
          this.cdr.detectChanges();
        })
        .catch((error: unknown) => {
          this.loading = false;
          this.engines = [];
          this.stateService.setEngines([]);
          
          console.error('Error fetching engines:', error);
          this.errorMessage =
              `Error fetching engines: ${this.describeError(error)}`;
          this.cdr.detectChanges();
        });
  }

  /** Reduces a caught error to the message worth showing the user. */
  private describeError(error: unknown): string {
    const fallback = 'See console for details.';
    if (error instanceof HttpErrorResponse) {
      // The proxy answers some failures with a plain-text body rather than a
      // JSON error.
      const body: unknown = error.error;
      const bodyMessage = typeof body === 'string' ?
          apiErrorMessage(body) :
          (body as {error?: {message?: string}} | null)?.error?.message;
      return bodyMessage || error.message || fallback;
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return fallback;
  }

  /** Populates models list based on selected engine, without resetting selectedModel if it's valid. */
  updateModelsForSelectedEngine() {
    const selected =
        this.engines.find(e => e.name === this.config.selectedEngine);
    if (selected) {
      // TODO b/514218151 - Fix hardcoded default models
      const defaultModels = ['auto'];
      this.models = [...defaultModels];

      if (selected.modelConfigs) {
        for (const [model, status] of Object.entries(selected.modelConfigs)) {
          if (status === 'MODEL_ENABLED' && !this.models.includes(model)) {
            this.models.push(model);
          }
        }
      }

      const fallbackModels = ['gemini-2.5-pro', 'gemini-3.5-flash'];
      for (const model of fallbackModels) {
        if (!selected.modelConfigs || !(model in selected.modelConfigs)) {
          if (!this.models.includes(model)) {
            this.models.push(model);
          }
        }
      }

      // Only overwrite if current model is not valid for this engine
      if (!this.config.selectedModel || !this.models.includes(this.config.selectedModel)) {
        this.config.selectedModel = this.models[0] || '';
      }
    }
  }

  /**
   * Refreshes everything that depends on the selected engine.
   *
   * @param engineChanged Whether a different engine is now selected. False when
   *     the engines were reloaded and still offer the selected one, in which
   *     case the selected agent is kept.
   */
  onEngineChange(engineChanged = true) {
    this.config.selectedDataStores = [];
    if (engineChanged) {
      // Agents belong to a single engine, so a selection cannot survive a
      // switch.
      this.config.selectedAgent = '';
    }
    this.updateModelsForSelectedEngine();
    this.fetchConnectorsForSelectedEngine();
    this.fetchAgentsForSelectedEngine();
    this.onConfigChange();
  }

  /**
   * Loads the runnable agents published under the selected engine into the
   * picker. The list is shared with the other tab's form, so asking for a list
   * that is already loading or loaded sends no request.
   *
   * A failure is reported beside the picker and leaves the run on the default
   * assistant rather than blocking it: listing agents needs a permission that
   * running queries does not, so an engine whose agents cannot be listed can
   * still be evaluated.
   */
  fetchAgentsForSelectedEngine() {
    this.agentListService.load(this.config);
  }

  /**
   * Points the run back at the default assistant if the freshly loaded list no
   * longer offers the selected agent, so a run never targets an agent that is
   * gone or cannot answer.
   *
   * A selection the list still offers is kept. Both the Run Queries and the Run
   * Evaluation forms load the list and share one config, so clearing it on
   * every load would let one form silently undo a choice made in the other.
   */
  private dropUnofferedSelectedAgent() {
    const selected = this.config.selectedAgent;
    if (selected && !this.agents.some(a => a.name === selected)) {
      this.config.selectedAgent = '';
      this.onConfigChange();
    }
  }

  /**
   * The label shown for an agent in the picker. A suspended agent is marked,
   * since the API describes it as temporarily unavailable and only its owners
   * (and, in Enterprise edition, admins) can run it.
   */
  agentLabel(agent: Agent): string {
    const name = agentDisplayName(agent);
    return agent.state === 'SUSPENDED' ? `${name} (suspended)` : name;
  }

  /** The agent the run targets, or undefined for the default assistant. */
  getSelectedAgent(): Agent|undefined {
    return this.agents.find(a => a.name === this.config.selectedAgent);
  }

  fetchConnectorsForSelectedEngine() {
    const engine = this.getSelectedEngine();
    const requestedEngine = this.config.selectedEngine;
    if (!this.config.projectId || !requestedEngine) {
      this.showConnectors(this.buildFallbackConnectors(engine));
      return;
    }

    // A slow response for a previously selected engine must not replace the
    // connectors of the engine selected now.
    const isStale = () => this.config.selectedEngine !== requestedEngine;
    this.evalBackendService.fetchWidgetConfig(
        this.config.projectId,
        this.config.region,
        requestedEngine,
        this.config
    ).then((widgetData) => {
      if (isStale()) return;
      const parsed =
          widgetData ? this.parseWidgetDataForConnectors(widgetData, engine) : [];
      if (parsed.length > 0) {
        this.showConnectors(parsed);
        this.stateService.setConnectors(requestedEngine, parsed);
      } else {
        this.showConnectors(this.buildFallbackConnectors(engine));
      }
      this.cdr.detectChanges();
    }).catch((error) => {
      if (isStale()) return;
      console.error('Error fetching widget config:', error);
      this.showConnectors(this.buildFallbackConnectors(engine));
      this.cdr.detectChanges();
    });
  }

  /**
   * Shows `connectors` in the dropdown.
   *
   * Only lists parsed from a widget config response are also shared through
   * `StateService` (by the caller): a fallback list has no auth states, so
   * sharing it would make unauthorized connectors searchable per row, and could
   * replace a parsed list another form already shared for the same engine.
   *
   * @param connectors The connectors to show.
   */
  private showConnectors(connectors: ConnectorOption[]) {
    this.connectors = connectors;
    this.validateAndSyncSelectedDataStores();
  }

  /**
   * Filters selectedDataStores to only retain IDs present in `this.connectors`.
   * If any invalid data stores were removed, triggers `onConfigChange()` to sync state.
   */
  private validateAndSyncSelectedDataStores() {
    if (!this.config.selectedDataStores || this.config.selectedDataStores.length === 0) {
      return;
    }
    const validIds = new Set(this.connectors.flatMap(c => c.entityIds));
    const initialLength = this.config.selectedDataStores.length;
    this.config.selectedDataStores = this.config.selectedDataStores.filter(
        id => validIds.has(id));

    if (this.config.selectedDataStores.length !== initialLength) {
      this.onConfigChange();
    }
  }

  /**
   * Infers normalized connector metadata (key, display name, and data source) from a component or ID string.
   */
  inferConnectorMetadata(componentOrId: { id?: string, displayName?: string, dataSource?: string } | string): { key: string, displayName: string, dataSource?: string } {
    if (typeof componentOrId === 'object') {
      if (componentOrId.dataSource) {
        let name = componentOrId.displayName || componentOrId.dataSource;
        if (!componentOrId.displayName || componentOrId.displayName === componentOrId.dataSource) {
          name = DATA_SOURCE_DISPLAY_NAMES[componentOrId.dataSource] || name;
        }
        return { key: componentOrId.dataSource, displayName: name, dataSource: componentOrId.dataSource };
      }
      const lowerId = (componentOrId.id || '').toLowerCase();
      const lowerName = (componentOrId.displayName || '').toLowerCase();
      const matchedRule = CONNECTOR_RULES.find(rule =>
          rule.matchers.some(m => lowerId.includes(m) || lowerName.includes(m)));
      if (matchedRule) {
        return {
          key: matchedRule.key,
          displayName: matchedRule.displayName,
          dataSource: matchedRule.dataSource
        };
      }
      return { key: componentOrId.id || 'unknown', displayName: componentOrId.displayName || componentOrId.id || 'Connector' };
    } else {
      const lower = componentOrId.toLowerCase();
      const matchedRule = CONNECTOR_RULES.find(rule =>
          rule.matchers.some(m => lower.includes(m)));
      if (matchedRule) {
        return {
          key: matchedRule.key,
          displayName: matchedRule.displayName,
          dataSource: matchedRule.dataSource
        };
      }
      return { key: componentOrId, displayName: componentOrId };
    }
  }

  private isValidConnector(component: CollectionComponent): boolean {
    return !!(
        component.connectorAuthState ||
        component.federatedSearchConnectorAuthUri ||
        (component.dataStoreComponents &&
         component.dataStoreComponents.length > 0) ||
        component.dataSource || component.id);
  }

  /**
   * Adds `candidate` to `connectorsMap`, merging its ids into any option that
   * already has the same id.
   */
  private mergeConnector(
      connectorsMap: Map<string, ConnectorOption>,
      candidate: ConnectorOption): void {
    const existing = connectorsMap.get(candidate.id);
    if (existing == null) {
      connectorsMap.set(candidate.id, candidate);
      return;
    }
    for (const id of candidate.entityIds) {
      if (!existing.entityIds.includes(id)) {
        existing.entityIds.push(id);
      }
    }
    for (const id of candidate.searchableDataStoreIds) {
      if (!existing.searchableDataStoreIds.includes(id)) {
        existing.searchableDataStoreIds.push(id);
      }
    }
  }

  /** Builds the option for a data store that belongs to the engine itself. */
  private engineDataStoreConnector(dataStoreId: string): ConnectorOption {
    const meta = this.inferConnectorMetadata(dataStoreId);
    const option: ConnectorOption = {
      id: meta.key,
      displayName: meta.displayName,
      entityIds: [dataStoreId],
      searchableDataStoreIds: [dataStoreId],
    };
    if (meta.dataSource) {
      option.dataSource = meta.dataSource;
    }
    return option;
  }

  parseWidgetDataForConnectors(widgetData: WidgetConfigResponse, engine: Engine | undefined): ConnectorOption[] {
    const connectorsMap = new Map<string, ConnectorOption>();
    const coveredEntityIds = new Set<string>();

    if (widgetData?.collectionComponents) {
      for (const component of widgetData.collectionComponents) {
        if (this.isValidConnector(component)) {
          const entityIds: string[] = (component.dataStoreComponents || [])
              .map((ds: DataStoreComponent) => ds.id)
              .filter((id: string | undefined): id is string => !!id);

          // A connector without data stores (such as one awaiting
          // authorization) is still listed under its own id, but that id is
          // a placeholder that cannot be searched.
          const effectiveIds = entityIds.length > 0 ? entityIds : (component.id ? [component.id] : []);
          effectiveIds.forEach(id => coveredEntityIds.add(id));
          const meta = this.inferConnectorMetadata(component);
          const option: ConnectorOption = {
            id: meta.key,
            displayName: meta.displayName,
            entityIds: [...effectiveIds],
            searchableDataStoreIds: isAuthorized(component) ? entityIds : [],
          };
          const dataSource = meta.dataSource || component.dataSource;
          if (dataSource) {
            option.dataSource = dataSource;
          }
          this.mergeConnector(connectorsMap, option);
        }
      }
    }

    if (engine && engine.dataStoreIds) {
      for (const ds of engine.dataStoreIds) {
        if (!coveredEntityIds.has(ds)) {
          this.mergeConnector(connectorsMap, this.engineDataStoreConnector(ds));
        }
      }
    }

    const list = Array.from(connectorsMap.values());
    list.push({
      id: WEB_SEARCH_CONNECTOR_ID,
      displayName: 'Web Search',
      entityIds: [],
      searchableDataStoreIds: [],
    });

    return list;
  }

  buildFallbackConnectors(engine: Engine | undefined): ConnectorOption[] {
    const connectorsMap = new Map<string, ConnectorOption>();
    if (engine && engine.dataStoreIds) {
      engine.dataStoreIds.forEach(ds => {
        this.mergeConnector(connectorsMap, this.engineDataStoreConnector(ds));
      });
    }
    const list = Array.from(connectorsMap.values());
    list.push({
      id: WEB_SEARCH_CONNECTOR_ID,
      displayName: 'Web Search',
      entityIds: [],
      searchableDataStoreIds: [],
    });
    return list;
  }

  /**
   * Gets the currently selected engine.
   */
  getSelectedEngine(): Engine|undefined {
    return this.engines.find(e => e.name === this.config.selectedEngine);
  }

  /**
   * Builds the tooltip for a connector in the dropdown, naming the entry to
   * use in a CSV `connectors_override` column.
   *
   * @param connector The dropdown option.
   * @returns The tooltip text.
   */
  connectorIdHint(connector: ConnectorOption): string {
    const id = connectorOverrideId(connector);
    return id == null ?
        `${CONNECTORS_OVERRIDE_COLUMN}: not available (not authorized)` :
        `${CONNECTORS_OVERRIDE_COLUMN} id: ${id}`;
  }

  /**
   * Checks if a connector is selected (all of its entityIds must be in selectedDataStores).
   */
  isConnectorSelected(connector: ConnectorOption): boolean {
    if (connector.id === WEB_SEARCH_CONNECTOR_ID) {
      return this.config.enableWebSearch;
    }
    if (!this.config.selectedDataStores || connector.entityIds.length === 0) {
      return false;
    }
    return connector.entityIds.every(id => this.config.selectedDataStores.includes(id));
  }

  /**
   * Toggles the selection of a connector and all its entityIds.
   */
  toggleConnector(connector: ConnectorOption) {
    if (connector.id === WEB_SEARCH_CONNECTOR_ID) {
      this.config.enableWebSearch = !this.config.enableWebSearch;
    } else {
      if (!this.config.selectedDataStores) {
        this.config.selectedDataStores = [];
      }
      const currentlySelected = this.isConnectorSelected(connector);
      if (currentlySelected) {
        this.config.selectedDataStores = this.config.selectedDataStores.filter(
            id => !connector.entityIds.includes(id));
      } else {
        for (const id of connector.entityIds) {
          if (!this.config.selectedDataStores.includes(id)) {
            this.config.selectedDataStores.push(id);
          }
        }
      }
    }
    this.onConfigChange();
  }

  /**
   * Updates the global state with the current configuration.
   */
  onConfigChange() {
    if (this.syncAutoRaterModelsForLocation()) {
      this.normalizeAutoRaterModel();
    }
    this.stateService.setConfig(this.config);
  }

  /**
   * Syncs the auto-rater location to the newly selected engine region,
   * reconciles the auto-rater model for that location, and resets engines.
   */
  onRegionChange() {
    const location = resolveAutoRaterLocation({region: this.config.region});
    this.currentAutoRaterLocation = location;
    this.autoRaterModels =
        listAutoRaterModels(this.authService.showCredentialInputs, location);
    // Replace `config` so the OnPush `ScoringSetupComponent` picks up the new
    // location and reconciled model even before `config$` emits back.
    this.config = {
      ...this.config,
      autoRaterLocation: location,
    };
    this.normalizeAutoRaterModel();
    this.changeConfigAndResetEngines();
  }

  /**
   * Resets the engines list when the token, project ID, or region is changed.
   */
  changeConfigAndResetEngines() {
    this.config.selectedEngine = '';
    this.config.selectedModel = '';
    this.config.selectedAgent = '';
    this.config.selectedDataStores = [];
    this.config.enableWebSearch = false;
    this.stateService.setConfig(this.config);

    this.engines = [];
    this.agentListService.clear();
    this.stateService.setEngines([]);
    this.cdr.detectChanges();
  }
  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  @HostListener('document:click', ['$event'])
  clickout(event: Event) {
    if (this.isDropdownOpen && this.dropdownContainer &&
        !this.dropdownContainer.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
    }
  }

  getAllAvailableConnectors(): ConnectorOption[] {
    return this.connectors.length > 0
        ? this.connectors
        : this.buildFallbackConnectors(this.getSelectedEngine());
  }

  filteredConnectors(): ConnectorOption[] {
    const all = this.getAllAvailableConnectors();
    if (!this.connectorSearchQuery) {
      return all;
    }
    const q = this.connectorSearchQuery.toLowerCase();
    return all.filter(c => c.displayName.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }

  getSelectedConnectorsSummary(): string {
    const allConnectors = this.getAllAvailableConnectors();
    let count = 0;
    for (const connector of allConnectors) {
      if (this.isConnectorSelected(connector)) {
        count++;
      }
    }
    if (count === 0) {
      return 'Select Connectors';
    }
    return `${count} Connector${count > 1 ? 's' : ''} Selected`;
  }

  private syncAutoRaterModelsForLocation(): boolean {
    const nextLocation = resolveAutoRaterLocation(this.config);
    if (nextLocation === this.currentAutoRaterLocation) {
      return false;
    }
    this.currentAutoRaterLocation = nextLocation;
    this.autoRaterModels = listAutoRaterModels(
        this.authService.showCredentialInputs, nextLocation);
    return true;
  }

  /**
   * Reconciles the auto-rater model with the models this auth mode offers. A
   * missing model, or one not on offer, becomes the first model offered. When
   * no model is offered at all, the model is cleared instead, so validation
   * flags it rather than a run using a model the user can neither see nor
   * change. Like `ScorerSelection.normalize`, edits the configuration in place
   * and leaves persistence to the caller.
   * @returns Whether the model changed and is worth persisting.
   */
  private normalizeAutoRaterModel(): boolean {
    const models = this.autoRaterModels;
    if (models.includes(this.config.autoRaterModel)) {
      return false;
    }
    const fallback = models.length > 0 ? models[0] : '';
    if (this.config.autoRaterModel === fallback) {
      return false;
    }
    this.config.autoRaterModel = fallback;
    return true;
  }

  /**
   * Checks if the form is valid and user can proceed to next step.
   * @returns True if form is valid, false otherwise.
   */
  canProceed(): boolean {
    const baseValid = !!this.config.projectId &&
        !!this.config.selectedEngine && !!this.config.selectedModel &&
        this.engines.length > 0;

    if (!baseValid) {
      return false;
    }

    if (this.isRunQueries) {
      return !this.authService.showCredentialInputs || !!this.config.gCloudToken;
    }

    // Covers both an empty selection and a selected scorer whose own settings
    // are incomplete, such as the auto rater without a model.
    if (this.scorerSelection.validate(this.config)) {
      return false;
    }

    if (this.authService.showCredentialInputs) {
      return !!this.config.gCloudToken;
    }

    return true;
  }

  /**
   * Saves config and emits next event.
   */
  onNext() {
    this.stateService.setConfig(this.config);
    this.next.emit();
  }
}
