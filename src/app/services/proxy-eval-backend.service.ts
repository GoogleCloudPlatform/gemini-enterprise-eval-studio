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

import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {firstValueFrom} from 'rxjs';

import {Agent, ListAgentsResponse} from '../models/agent.model';
import {AppConfig, Engine, WidgetConfigResponse} from '../models/app-config.model';
import {AssistRequest, EvalBackendService, ScoreRequest} from './eval-backend.service';

/**
 * Implementation of EvalBackendService that proxies requests to the Express backend.
 */
@Injectable()
export class ProxyEvalBackendService extends EvalBackendService {

  constructor(private readonly http: HttpClient) {
    super();
  }

  override async callAssist(request: AssistRequest): Promise<Response> {
    return fetch('/api/v1/assist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  }

  override async callScore(request: ScoreRequest): Promise<Response> {
    return fetch('/api/v1/score', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  }

  override async fetchEngines(
      projectId: string,
      region: string,
      config: AppConfig
  ): Promise<Engine[]> {
    const url = `/api/v1/engines?projectId=${projectId}&region=${region}`;
    const res = await firstValueFrom(
        this.http.get<{engines?: Engine[]}>(url)
    );
    return res.engines || [];
  }

  override async fetchWidgetConfig(
      projectId: string,
      region: string,
      engineId: string,
      config: AppConfig
  ): Promise<WidgetConfigResponse | null> {
    const url = `/api/v1/widget-config?projectId=${projectId}&region=${region}&engineId=${encodeURIComponent(engineId)}`;
    try {
      const res = await firstValueFrom(
          this.http.get<WidgetConfigResponse>(url)
      );
      return res || null;
    } catch (err) {
      console.error('Error fetching widget config:', err);
      return null;
    }
  }

  override async fetchTraceId(projectId: string, assistToken: string):
      Promise<string|undefined> {
    if (!projectId || !assistToken) {
      return undefined;
    }
    const url =
        `/api/v1/trace?projectId=${encodeURIComponent(projectId)}&assistToken=${
            encodeURIComponent(assistToken)}`;
    const res = await firstValueFrom(this.http.get<{traceId?: string}>(url));
    return res?.traceId;
  }

  override async fetchAgents(
      projectId: string,
      region: string,
      engineId: string,
      config: AppConfig
  ): Promise<Agent[]> {
    const url = `/api/v1/agents?projectId=${
        encodeURIComponent(projectId)}&region=${
        encodeURIComponent(region)}&engineId=${encodeURIComponent(engineId)}`;
    const res = await firstValueFrom(this.http.get<ListAgentsResponse>(url));
    return res?.agents || [];
  }
}

