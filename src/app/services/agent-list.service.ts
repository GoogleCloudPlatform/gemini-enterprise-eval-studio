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
import {BehaviorSubject} from 'rxjs';

import {Agent, isRunnableAgent} from '../models/agent.model';
import {AppConfig} from '../models/app-config.model';

import {EvalBackendService} from './eval-backend.service';

/** The agents of the selected engine, and how far loading them has got. */
export interface AgentListState {
  /**
   * `idle` before any list is requested, `loading` while the latest request is
   * in flight, then `loaded` or `failed`.
   */
  status: 'idle'|'loading'|'loaded'|'failed';
  /** The runnable agents. Empty unless `status` is `loaded`. */
  agents: Agent[];
  /** Why the list could not be loaded, when `status` is `failed`. */
  error?: unknown;
}

const IDLE: AgentListState = {status: 'idle', agents: []};

/**
 * Holds the agent list of the selected engine, shared by every settings form.
 *
 * The Run Queries and Run Evaluation tabs each mount a settings form, and both
 * share one config, so both ask for the list whenever the engine changes. This
 * service sends one ListAgents request per engine and gives both forms the same
 * result, so the forms cannot disagree about which agents exist.
 */
@Injectable({providedIn: 'root'})
export class AgentListService {
  private readonly stateSubject = new BehaviorSubject<AgentListState>(IDLE);
  /** The current agent list. Emits on every change. */
  readonly state$ = this.stateSubject.asObservable();

  /**
   * Identifies the list most recently requested. A request for the same list
   * is not repeated while that list is loading or loaded.
   */
  private requestKey = '';
  /**
   * Incremented by every request and reset, so that only the outcome of the
   * latest request is applied, even when an earlier request for the same
   * engine is still in flight.
   */
  private requestId = 0;

  constructor(private readonly evalBackendService: EvalBackendService) {}

  /** The current agent list. */
  get state(): AgentListState {
    return this.stateSubject.value;
  }

  /**
   * Loads the agents of the engine `config` selects, unless that list is
   * already loading or loaded. A failed list is requested again.
   *
   * @param config The settings naming the project, region and engine, and
   *     carrying the credentials.
   */
  load(config: AppConfig): void {
    const {projectId, region, selectedEngine} = config;
    if (!projectId || !selectedEngine) {
      this.clear();
      return;
    }
    // The token is part of the key so that new credentials fetch the list
    // again rather than reusing one loaded, or refused, under the old ones.
    const key =
        JSON.stringify([projectId, region, selectedEngine, config.gCloudToken]);
    if (key === this.requestKey) {
      return;
    }
    this.requestKey = key;
    const requestId = ++this.requestId;
    this.stateSubject.next({status: 'loading', agents: []});

    this.evalBackendService
        .fetchAgents(projectId, region, selectedEngine, config)
        .then((agents) => {
          if (requestId !== this.requestId) {
            return;
          }
          this.stateSubject.next(
              {status: 'loaded', agents: (agents || []).filter(isRunnableAgent)});
        })
        .catch((error: unknown) => {
          if (requestId !== this.requestId) {
            return;
          }
          console.error('Error fetching agents:', error);
          // Forgotten so that the next request for this engine tries again.
          this.requestKey = '';
          this.stateSubject.next({status: 'failed', agents: [], error});
        });
  }

  /**
   * Empties the list and discards any request still in flight, so that the
   * next `load` fetches afresh.
   */
  clear(): void {
    this.requestId++;
    this.requestKey = '';
    this.stateSubject.next(IDLE);
  }
}
