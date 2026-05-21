import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';

import {AppConfig} from '../models/app-config.model';
import {ResultRow} from '../models/result-row.model';

/**
 * Service for managing application state.
 */
@Injectable({providedIn: 'root'})
export class StateService {
  private currentTabSubject = new BehaviorSubject<string>('run');
  /** Observable of the current active tab. */
  currentTab$ = this.currentTabSubject.asObservable();

  private readonly STORAGE_KEY = 'ge_eval_studio_config';

  private loadInitialConfig(): AppConfig {
    const defaultConfig: AppConfig = {
      gCloudToken: '',
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      geminiApiKey: '',
      autoRaterInstruction:
          'You are an expert evaluator. Compare the fetched response to the golden response for the given query. Calculate a semantic similarity score between 0.0 and 1.0...'
    };

    if (typeof localStorage !== 'undefined') {
      const savedConfig = localStorage.getItem(this.STORAGE_KEY);
      if (savedConfig) {
        try {
          return {
            ...defaultConfig,
            ...(JSON.parse(savedConfig) as Partial<AppConfig>)
          };
        } catch (e) {
          console.error('Error parsing saved config from localStorage', e);
          return defaultConfig;
        }
      }
    }
    return defaultConfig;
  }

  private configSubject =
      new BehaviorSubject<AppConfig>(this.loadInitialConfig());
  /** Observable of the application configuration. */
  config$ = this.configSubject.asObservable();

  private resultsSubject = new BehaviorSubject<ResultRow[]>([]);
  /** Observable of the evaluation results. */
  results$ = this.resultsSubject.asObservable();

  /** Sets the current active tab. */
  setTab(tab: string) {
    this.currentTabSubject.next(tab);
  }

  /** Sets the application configuration. */
  setConfig(config: AppConfig) {
    this.configSubject.next(config);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
    }
  }

  /** Gets the current application configuration. */
  getCurrentConfig(): AppConfig {
    return this.configSubject.value;
  }

  /** Sets the evaluation results. */
  setResults(results: ResultRow[]) {
    this.resultsSubject.next(results);
  }
}
