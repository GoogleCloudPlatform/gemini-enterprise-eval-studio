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

import {AppConfig, CollectionComponent, DataStoreComponent, Engine, WidgetConfigResponse} from '../../../models/app-config.model';
import {ScorerSelection} from '../../../scoring/scorer-selection';
import {listAutoRaterModels} from '../../../scoring/scorers/auto-rater.scorer';
import {AuthService} from '../../../services/auth.service';
import {EvalBackendService} from '../../../services/eval-backend.service';
import {StateService} from '../../../services/state.service';
import {InfoTooltipComponent} from '../../shared/info-tooltip/info-tooltip.component';
import {ScoringSetupComponent} from '../../shared/scoring-setup/scoring-setup.component';


/**
 * Represents a connector option for selection in the UI.
 */
export interface ConnectorOption {
  id: string;
  displayName: string;
  dataSource?: string;
  entityIds: string[];
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
  @ViewChild('dropdownContainer') dropdownContainer?: ElementRef;

  config: AppConfig = {
    projectId: '',
    region: 'global',
    selectedEngine: '',
    selectedModel: '',
    autoRaterModel: '',
    autoRaterInstruction: '',
    selectedDataStores: [],
    enableWebSearch: false
  };

  /**
   * The auto-rater models on offer. Rendered by `ScoringSetupComponent`; kept
   * here so an incoming configuration that names no model, or one this auth
   * mode cannot use, is defaulted and persisted before a run starts.
   */
  autoRaterModels: string[] = listAutoRaterModels(true);

  engines: Engine[] = [];
  models: string[] = [];
  loading = false;
  errorMessage = '';

  isDropdownOpen = false;
  connectorSearchQuery = '';
  connectors: ConnectorOption[] = [];

  constructor(
      private readonly stateService: StateService,
      private readonly cdr: ChangeDetectorRef,
      readonly authService: AuthService,
      private readonly evalBackendService: EvalBackendService,
      private readonly scorerSelection: ScorerSelection,
  ) {}

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
            }
          }
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
          }
        });

    this.stateService.errorMessage$.pipe(takeUntil(this.destroy$))
        .subscribe((errorMessage: string) => {
          this.errorMessage = errorMessage;
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
        });
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

  onEngineChange() {
    this.config.selectedDataStores = [];
    this.updateModelsForSelectedEngine();
    this.fetchConnectorsForSelectedEngine();
    this.onConfigChange();
  }

  fetchConnectorsForSelectedEngine() {
    const engine = this.getSelectedEngine();
    if (!this.config.projectId || !this.config.selectedEngine) {
      this.connectors = this.buildFallbackConnectors(engine);
      this.validateAndSyncSelectedDataStores();
      return;
    }

    this.evalBackendService.fetchWidgetConfig(
        this.config.projectId,
        this.config.region,
        this.config.selectedEngine,
        this.config
    ).then((widgetData) => {
      if (widgetData) {
        const parsed = this.parseWidgetDataForConnectors(widgetData, engine);
        if (parsed.length > 0) {
          this.connectors = parsed;
        } else {
          this.connectors = this.buildFallbackConnectors(engine);
        }
      } else {
        this.connectors = this.buildFallbackConnectors(engine);
      }
      this.validateAndSyncSelectedDataStores();
      this.cdr.detectChanges();
    }).catch((error) => {
      console.error('Error fetching widget config:', error);
      this.connectors = this.buildFallbackConnectors(engine);
      this.validateAndSyncSelectedDataStores();
      this.cdr.detectChanges();
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

  /**
   * Resets the engines list when the token, project ID, or region is changed.
   */
  changeConfigAndResetEngines() {
    this.config.selectedEngine = '';
    this.config.selectedModel = '';
    this.config.selectedDataStores = [];
    this.config.enableWebSearch = false;
    this.stateService.setConfig(this.config);

    this.engines = [];
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
