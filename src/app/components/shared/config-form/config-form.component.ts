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
import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {AppConfig, Engine} from '../../../models/app-config.model';
import {StateService} from '../../../services/state.service';
import {InfoTooltipComponent} from '../../shared/info-tooltip/info-tooltip.component';

/**
 * Represents a connector option for selection in the UI.
 */
export interface ConnectorOption {
  id: string;
  displayName: string;
  dataSource?: string;
  entityIds: string[];
}

interface DataStoreComponent {
  id?: string;
}

interface CollectionComponent {
  id?: string;
  displayName?: string;
  dataSource?: string;
  connectorAuthState?: {
    authState?: string;
    authorizationUri?: string;
  };
  dataStoreComponents?: DataStoreComponent[];
  federatedSearchConnectorAuthUri?: string;
}

interface WidgetConfigResponse {
  collectionComponents?: CollectionComponent[];
}

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

/**
 * Component for configuring evaluation settings.
 */
@Component({
  selector: 'app-config-form',
  standalone: true,
  imports: [CommonModule, FormsModule, InfoTooltipComponent],
  templateUrl: './config-form.component.html'
})
export class ConfigFormComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  @Output() readonly next = new EventEmitter<void>();
  @Input() isRunQueries = false;
  @ViewChild('dropdownContainer') dropdownContainer?: ElementRef;

  config: AppConfig = {
    gCloudToken: '',
    projectId: '',
    region: 'global',
    selectedEngine: '',
    selectedModel: '',
    autoRaterModel: '',
    autoRaterInstruction: '',
    selectedDataStores: [],
    enableWebSearch: false
  };

  autoRaterModels: string[] = ['gemini-3.1-pro-preview', 'gemini-3.5-flash'];
  autoRaterErrorMessage = '';

  engines: Engine[] = [];
  models: string[] = [];
  loading = false;
  errorMessage = '';

  isDropdownOpen = false;
  connectorSearchQuery = '';
  connectors: ConnectorOption[] = [];

  constructor(
      private stateService: StateService, private cdr: ChangeDetectorRef,
      private http: HttpClient) {}

  ngOnInit() {
    this.stateService.config$.pipe(takeUntil(this.destroy$))
        .subscribe((c: AppConfig) => {
          this.config = structuredClone(c);
          if (this.engines.length > 0) {
            this.updateModelsForSelectedEngine();
          }
          if (this.autoRaterModels.length > 0 && (!this.config.autoRaterModel || !this.autoRaterModels.includes(this.config.autoRaterModel))) {
            this.config.autoRaterModel = this.autoRaterModels[0];
            this.onConfigChange();
          }
        });

    this.stateService.engines$.pipe(takeUntil(this.destroy$))
        .subscribe((engines: Engine[]) => {
          this.engines = engines;
          if (this.config.selectedEngine && this.engines.length > 0) {
            this.updateModelsForSelectedEngine();
            this.fetchConnectorsForSelectedEngine();
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
    if (!this.config.gCloudToken || !this.config.projectId) {
      this.errorMessage = 'Please provide gCloud Token and Project ID';
      return;
    }
    this.loading = true;
    const baseUrl = this.config.region === 'global' ?
        'discoveryengine.googleapis.com' :
        `${this.config.region}-discoveryengine.googleapis.com`;
    const url = `https://${baseUrl}/v1alpha/projects/${
        this.config.projectId}/locations/${
        this.config.region}/collections/default_collection/engines`;

    this.http
        .get<EnginesResponse>(url, {
          headers: {
            'Authorization': `Bearer ${this.config.gCloudToken}`,
            'x-goog-user-project': this.config.projectId
          }
        })
        .subscribe({
          next: (data) => {
            this.loading = false;
            if (data.engines) {
              this.engines =
                  data.engines.map((e: Engine) => ({
                                     name: e.name,
                                     displayName: e.displayName || e.name,
                                     modelConfigs: e.modelConfigs,
                                     dataStoreIds: e.dataStoreIds
                                   }));

              this.stateService.setEngines(this.engines);

              if (this.config.selectedEngine) {
                const exists = this.engines.some(
                    e => e.name === this.config.selectedEngine);
                if (exists) {
                  this.onEngineChange();
                } else if (this.engines.length > 0) {
                  this.config.selectedEngine = this.engines[0].name;
                  this.onEngineChange();
                }
              } else if (this.engines.length > 0) {
                this.config.selectedEngine = this.engines[0].name;
                this.onEngineChange();
              }

              this.cdr.detectChanges();
            } else {
              this.engines = [];
              this.stateService.setEngines([]);
              this.errorMessage = 'No engines found.';
              this.cdr.detectChanges();
            }
          },
          error: (error: unknown) => {
            this.loading = false;
            this.engines = [];
            this.stateService.setEngines([]);
            console.error('Error fetching engines:', error);
            let details = 'See console for details.';
            if (error instanceof HttpErrorResponse) {
              details = error.error?.error?.message || error.message || details;
            } else if (error instanceof Error) {
              details = error.message;
            } else if (typeof error === 'string') {
              details = error;
            }
            this.errorMessage = `Error fetching engines: ${details}`;
            this.cdr.detectChanges();
          }
        });
  }

  /**
   * Handles engine selection change, updating available models.
   */
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

  onEngineChange() {
    this.config.selectedDataStores = [];
    this.updateModelsForSelectedEngine();
    this.fetchConnectorsForSelectedEngine();
    this.onConfigChange();
  }

  fetchConnectorsForSelectedEngine() {
    if (!this.config.gCloudToken || !this.config.projectId || !this.config.selectedEngine) {
      this.connectors = this.buildFallbackConnectors(this.getSelectedEngine());
      this.validateAndSyncSelectedDataStores();
      return;
    }

    const baseUrl = this.config.region === 'global' ?
        'discoveryengine.googleapis.com' :
        `${this.config.region}-discoveryengine.googleapis.com`;
    const widgetConfigId = 'default_search_widget_config';
    const enginePath = this.config.selectedEngine.startsWith('projects/') ?
        this.config.selectedEngine :
        `projects/${this.config.projectId}/locations/${
            this.config.region}/collections/default_collection/engines/${
            this.config.selectedEngine}`;
    const url = `https://${baseUrl}/v1alpha/${enginePath}/widgetConfigs/${
        widgetConfigId}`;


    this.http
        .get<WidgetConfigResponse>(url, {
          headers: {
            'Authorization': `Bearer ${this.config.gCloudToken}`,
            'x-goog-user-project': this.config.projectId
          }
        })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (widgetData) => {
            const parsed = this.parseWidgetDataForConnectors(widgetData, this.getSelectedEngine());
            if (parsed.length > 0) {
              this.connectors = parsed;
            } else {
              this.connectors = this.buildFallbackConnectors(this.getSelectedEngine());
            }
            this.validateAndSyncSelectedDataStores();
            this.cdr.detectChanges();
          },
          error: (error) => {
            this.connectors = this.buildFallbackConnectors(this.getSelectedEngine());
            this.validateAndSyncSelectedDataStores();
            this.cdr.detectChanges();
          }
        });
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

  private upsertConnector(
      connectorsMap: Map<string, ConnectorOption>,
      meta: {key: string; displayName: string; dataSource?: string},
      entityIds: string[], fallbackDataSource?: string): void {
    const existing = connectorsMap.get(meta.key);
    if (existing) {
      for (const id of entityIds) {
        if (!existing.entityIds.includes(id)) {
          existing.entityIds.push(id);
        }
      }
    } else {
      const option: ConnectorOption = {
        id: meta.key,
        displayName: meta.displayName,
        entityIds: [...entityIds]
      };
      const ds = meta.dataSource || fallbackDataSource;
      if (ds) {
        option.dataSource = ds;
      }
      connectorsMap.set(meta.key, option);
    }
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

          const effectiveIds = entityIds.length > 0 ? entityIds : (component.id ? [component.id] : []);
          effectiveIds.forEach(id => coveredEntityIds.add(id));
          const meta = this.inferConnectorMetadata(component);
          this.upsertConnector(
              connectorsMap, meta, effectiveIds, component.dataSource);
        }
      }
    }

    if (engine && engine.dataStoreIds) {
      for (const ds of engine.dataStoreIds) {
        if (!coveredEntityIds.has(ds)) {
          const meta = this.inferConnectorMetadata(ds);
          this.upsertConnector(connectorsMap, meta, [ds]);
        }
      }
    }

    const list = Array.from(connectorsMap.values());
    list.push({
      id: 'Web Search',
      displayName: 'Web Search',
      entityIds: []
    });

    return list;
  }

  buildFallbackConnectors(engine: Engine | undefined): ConnectorOption[] {
    const connectorsMap = new Map<string, ConnectorOption>();
    if (engine && engine.dataStoreIds) {
      engine.dataStoreIds.forEach(ds => {
        const meta = this.inferConnectorMetadata(ds);
        this.upsertConnector(connectorsMap, meta, [ds]);
      });
    }
    const list = Array.from(connectorsMap.values());
    list.push({
      id: 'Web Search',
      displayName: 'Web Search',
      entityIds: []
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
   * Checks if a connector is selected (all of its entityIds must be in selectedDataStores).
   */
  isConnectorSelected(connector: ConnectorOption): boolean {
    if (connector.id === 'Web Search') {
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
    if (connector.id === 'Web Search') {
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
    this.stateService.setConfig(this.config);
  }

  @HostListener('document:click', ['$event'])
  clickout(event: Event) {
    if (this.isDropdownOpen && this.dropdownContainer &&
        !this.dropdownContainer.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
    }
  }

  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
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

  /**
   * Checks if the form is valid and user can proceed to next step.
   * @returns True if form is valid, false otherwise.
   */
  canProceed() {
    const baseValid = this.config.gCloudToken && this.config.projectId &&
        this.config.selectedEngine && this.config.selectedModel;
    if (this.isRunQueries) {
      return baseValid;
    }
    return baseValid && this.config.autoRaterModel;
  }

  /**
   * Saves config and emits next event.
   */
  onNext() {
    this.stateService.setConfig(this.config);
    this.next.emit();
  }
}
