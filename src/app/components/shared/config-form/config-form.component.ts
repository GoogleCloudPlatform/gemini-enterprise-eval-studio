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
import {HttpClient} from '@angular/common/http';
import {ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {AppConfig, Engine} from '../../../models/app-config.model';
import {StateService} from '../../../services/state.service';
import {InfoTooltipComponent} from '../../shared/info-tooltip/info-tooltip.component';

interface EnginesResponse {
  engines?: Engine[];
}

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
  @Input() isGetGolden = false;
  @ViewChild('dropdownContainer') dropdownContainer?: ElementRef;

  config: AppConfig = {
    gCloudToken: '',
    projectId: '',
    region: 'global',
    selectedEngine: '',
    selectedModel: '',
    geminiApiKey: '',
    autoRaterInstruction: '',
    selectedDataStores: [],
    enableWebSearch: false
  };

  engines: Engine[] = [];
  models: string[] = [];
  loading = false;
  errorMessage = '';

  isDropdownOpen = false;
  connectorSearchQuery = '';

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
        });

    this.stateService.engines$.pipe(takeUntil(this.destroy$))
        .subscribe((engines: Engine[]) => {
          this.engines = engines;
          if (this.config.selectedEngine && this.engines.length > 0) {
            this.updateModelsForSelectedEngine();
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
          error: (error) => {
            this.loading = false;
            this.engines = [];
            this.stateService.setEngines([]);
            this.errorMessage =
                'Error fetching engines. See console for details.';
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
      const defaultModels = ['auto', 'gemini-2.5-pro', 'gemini-3.5-flash'];
      this.models = [...defaultModels];

      if (selected.modelConfigs) {
        for (const [model, status] of Object.entries(selected.modelConfigs)) {
          if (status === 'MODEL_ENABLED' && !this.models.includes(model)) {
            this.models.push(model);
          }
        }
      }

      // Only overwrite if current model is not valid for this engine
      if (!this.config.selectedModel || !this.models.includes(this.config.selectedModel)) {
        this.config.selectedModel = this.models[0] || '';
      }

      // Filter selected data stores to only include those belonging to the selected engine.
      const validDataStores = selected.dataStoreIds || [];
      if (this.config.selectedDataStores) {
        this.config.selectedDataStores = this.config.selectedDataStores.filter(
            ds => validDataStores.includes(ds));
      }
    }
  }

  onEngineChange() {
    this.updateModelsForSelectedEngine();
    this.onConfigChange();
  }

  /**
   * Gets the currently selected engine.
   */
  getSelectedEngine(): Engine|undefined {
    return this.engines.find(e => e.name === this.config.selectedEngine);
  }

  /**
   * Checks if a data store is selected.
   */
  isSelected(ds: string): boolean {
    if (ds === 'Web Search') {
      return this.config.enableWebSearch;
    }
    return this.config.selectedDataStores &&
        this.config.selectedDataStores.includes(ds);
  }

  /**
   * Toggles the selection of a data store.
   */
  toggleDataStore(ds: string) {
    if (ds === 'Web Search') {
      this.config.enableWebSearch = !this.config.enableWebSearch;
    } else {
      if (!this.config.selectedDataStores) {
        this.config.selectedDataStores = [];
      }
      const index = this.config.selectedDataStores.indexOf(ds);
      if (index > -1) {
        this.config.selectedDataStores.splice(index, 1);
      } else {
        this.config.selectedDataStores.push(ds);
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
  clickout(event: any) {
    if (this.isDropdownOpen && this.dropdownContainer &&
        !this.dropdownContainer.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
    }
  }

  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  getAllAvailableConnectors(): {id: string, label: string}[] {
    const engine = this.getSelectedEngine();
    const list: {id: string, label: string}[] = [];
    if (engine && engine.dataStoreIds) {
      engine.dataStoreIds.forEach(ds => {
        list.push({id: ds, label: ds});
      });
    }
    list.push({id: 'Web Search', label: 'Web Search'});
    return list;
  }

  filteredConnectors(): {id: string, label: string}[] {
    const all = this.getAllAvailableConnectors();
    if (!this.connectorSearchQuery) {
      return all;
    }
    const q = this.connectorSearchQuery.toLowerCase();
    return all.filter(c => c.label.toLowerCase().includes(q));
  }

  getSelectedConnectorsSummary(): string {
    const count = (this.config.selectedDataStores?.length || 0) +
        (this.config.enableWebSearch ? 1 : 0);
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
    if (this.isGetGolden) {
      return baseValid;
    }
    return baseValid && this.config.geminiApiKey;
  }

  /**
   * Saves config and emits next event.
   */
  onNext() {
    this.stateService.setConfig(this.config);
    this.next.emit();
  }
}
