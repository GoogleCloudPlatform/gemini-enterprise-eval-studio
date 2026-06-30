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

import {Injectable} from '@angular/core';
import {BehaviorSubject, Subject} from 'rxjs';
import {debounceTime, map} from 'rxjs/operators';

import {AppConfig, Engine} from '../models/app-config.model';
import {ResultRow} from '../models/result-row.model';

/**
 * Service for managing application state.
 */
@Injectable({providedIn: 'root'})
export class StateService {
  private currentTabSubject = new BehaviorSubject<string>('queries');
  /** Observable of the current active tab. */
  currentTab$ = this.currentTabSubject.asObservable();

  private readonly STORAGE_KEY = 'ge_eval_studio_config';
  private storageWrite$ = new Subject<any>();

  constructor() {
    // Debounce localStorage writes to prevent I/O blocking during rapid user
    // input
    this.storageWrite$.pipe(debounceTime(300)).subscribe(localConfig => {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(localConfig));
        } catch (e) {
          console.warn('localStorage write failed:', e);
        }
      }
    });


  }

  private loadInitialConfig(): AppConfig {
    const defaultConfig: AppConfig = {
      gCloudToken: '',
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      autoRaterModel: '',
      autoRaterInstruction:
          'You are an expert evaluator. Compare the fetched response to the golden response for the given query. Calculate a semantic similarity score between 0.0 and 1.0...',
      selectedDataStores: [],
      enableWebSearch: false
    };

    let savedConfig: Partial<AppConfig> = {};

    if (typeof localStorage !== 'undefined') {
      try {
        const localData = localStorage.getItem(this.STORAGE_KEY);
        if (localData) {
          savedConfig = JSON.parse(localData) as Partial<AppConfig>;
        }
      } catch (e) {
        console.warn(
            'localStorage is available but could not be read (maybe blocked by sandbox/policy):',
            e);
      }
    }

    const {gCloudToken, ...safeConfig} = savedConfig;

    return {
      ...defaultConfig,
      ...safeConfig,
      gCloudToken: '',
    };
  }

  private configSubject =
      new BehaviorSubject<AppConfig>(this.loadInitialConfig());
  /** Observable of the application configuration. */
  config$ =
      this.configSubject.asObservable().pipe(map(c => structuredClone(c)));

  private resultsSubject = new BehaviorSubject<ResultRow[]>([]);
  /** Observable of the evaluation results. */
  results$ =
      this.resultsSubject.asObservable().pipe(map(r => structuredClone(r)));

  private enginesSubject = new BehaviorSubject<Engine[]>([]);
  /** Observable of the fetched engines. */
  engines$ =
      this.enginesSubject.asObservable().pipe(map(e => structuredClone(e)));


  /** Sets the current active tab. */
  setTab(tab: string) {
    this.currentTabSubject.next(tab);
  }

  /** Sets the application configuration. */
  setConfig(config: AppConfig) {
    const clonedConfig = structuredClone(config);
    this.configSubject.next(clonedConfig);

    const {gCloudToken, ...localConfig} = clonedConfig;

    this.storageWrite$.next(localConfig);
  }

  /** Gets the current application configuration. */
  getCurrentConfig(): AppConfig {
    return structuredClone(this.configSubject.value);
  }

  /** Sets the evaluation results. */
  setResults(results: ResultRow[]) {
    this.resultsSubject.next(structuredClone(results));
  }

  /** Sets the fetched engines. */
  setEngines(engines: Engine[]) {
    this.enginesSubject.next(structuredClone(engines));
  }

  /** Gets the currently fetched engines. */
  getEngines(): Engine[] {
    return structuredClone(this.enginesSubject.value);
  }
}

