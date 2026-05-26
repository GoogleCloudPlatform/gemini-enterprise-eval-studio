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
import {ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output} from '@angular/core';
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

  constructor(
      private stateService: StateService, private cdr: ChangeDetectorRef,
      private http: HttpClient) {}

  ngOnInit() {
    this.stateService.config$.pipe(takeUntil(this.destroy$))
        .subscribe((c: AppConfig) => this.config = structuredClone(c));
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
              this.errorMessage = 'No engines found.';
              this.cdr.detectChanges();
            }
          },
          error: (error) => {
            this.loading = false;
            this.errorMessage =
                'Error fetching engines. See console for details.';
            this.cdr.detectChanges();
          }
        });
  }

  /**
   * Handles engine selection change, updating available models.
   */
  onEngineChange() {
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
      this.config.selectedModel = this.models[0] || '';

      // Filter selected data stores to only include those belonging to the selected engine.
      const validDataStores = selected.dataStoreIds || [];
      if (this.config.selectedDataStores) {
        this.config.selectedDataStores = this.config.selectedDataStores.filter(
            ds => validDataStores.includes(ds));
      }
    }
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
