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

import {Agent, ListAgentsResponse} from '../models/agent.model';
import {AppConfig, Engine, WidgetConfigResponse} from '../models/app-config.model';
import {apiErrorMessage} from './api-error';
import {AssistRequest, EvalBackendService, ScoreRequest} from './eval-backend.service';
import {StateService} from './state.service';

/** The assistant every engine exposes, and the one the studio queries. */
const DEFAULT_ASSISTANT_ID = 'default_assistant';

/**
 * The largest page size that ListAgents accepts. A single page is requested,
 * which covers any realistic number of agents under one assistant.
 */
const MAX_AGENT_PAGE_SIZE = 1000;

// Keep Discovery Engine and Vertex AI endpoint routing in sync with
// src/server/proxy.ts.

/** Multi-regional locations that use Vertex AI `.rep.googleapis.com` endpoints. */
const VERTEX_MULTI_REGIONAL_LOCATIONS: ReadonlySet<string> =
    new Set(['us', 'eu']);

/** The Discovery Engine host serving the given region. */
function discoveryEngineBaseUrl(region: string): string {
  return region === 'global'
    ? 'discoveryengine.googleapis.com'
    : `${region}-discoveryengine.googleapis.com`;
}

/**
 * Returns the Vertex AI host serving the given region. Multi-regional locations
 * (`us`, `eu`) use `.rep.googleapis.com` endpoints.
 */
function vertexAiBaseUrl(region: string): string {
  if (region === 'global') {
    return 'aiplatform.googleapis.com';
  }
  if (VERTEX_MULTI_REGIONAL_LOCATIONS.has(region)) {
    return `aiplatform.${region}.rep.googleapis.com`;
  }
  return `${region}-aiplatform.googleapis.com`;
}

/**
 * Direct GCP implementation of EvalBackendService.
 * Used in no-auth mode to make direct calls to GCP APIs from the browser.
 */
@Injectable()
export class DirectGcpEvalBackendService extends EvalBackendService {

  constructor(private readonly stateService: StateService) {
    super();
  }

  override async callAssist(request: AssistRequest): Promise<Response> {
    const {selectedEngine, region, body} = request;
    const url = `https://${discoveryEngineBaseUrl(region)}/v1/${
        selectedEngine}/assistants/${DEFAULT_ASSISTANT_ID}:streamAssist`;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.getGCloudToken()}`
      },
      body: JSON.stringify(body)
    });
  }

  override async callScore(request: ScoreRequest): Promise<Response> {
    const {body, model, projectId, region} = request;
    const location = region.length > 0 ? region : 'global';
    const url = `https://${vertexAiBaseUrl(location)}/v1/projects/${
        projectId}/locations/${location}/publishers/google/models/${
        model}:generateContent`;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.getGCloudToken()}`,
        'x-goog-user-project': projectId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  }

  override async fetchEngines(projectId: string, region: string, config: AppConfig): Promise<Engine[]> {
    const url = `https://${discoveryEngineBaseUrl(region)}/v1alpha/projects/${projectId}/locations/${region}/collections/default_collection/engines`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.gCloudToken}`,
        'x-goog-user-project': projectId
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch engines: ${errorText}`);
    }

    const data = await response.json();
    return data.engines || [];
  }

  override async fetchWidgetConfig(
      projectId: string,
      region: string,
      engineId: string,
      config: AppConfig
  ): Promise<WidgetConfigResponse | null> {
    if (!config.gCloudToken || !projectId || !engineId) {
      return null;
    }
    const url = `https://${discoveryEngineBaseUrl(region)}/v1alpha/${
        this.enginePath(projectId, region, engineId)}/widgetConfigs/default_search_widget_config`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.gCloudToken}`,
        'x-goog-user-project': projectId
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json() as WidgetConfigResponse;
  }

  override async fetchTraceId(
      projectId: string,
      assistToken: string
  ): Promise<string | undefined> {
    if (!projectId || !assistToken) {
      return undefined;
    }
    const token = this.getGCloudToken();
    const filter = encodeURIComponent(
        `+gemini_enterprise.assist_token:${assistToken}`);
    const url = `https://cloudtrace.googleapis.com/v1/projects/${
        encodeURIComponent(projectId)}/traces?filter=${filter}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-goog-user-project': projectId,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const error =
          new Error(`Failed to fetch trace ID: HTTP ${response.status}`);
      (error as {status?: number}).status = response.status;
      throw error;
    }
    const data = await response.json();
    return data.traces?.[0]?.traceId;
  }

  override async fetchAgents(
      projectId: string,
      region: string,
      engineId: string,
      config: AppConfig
  ): Promise<Agent[]> {
    const url = `https://${discoveryEngineBaseUrl(region)}/v1alpha/${
        this.enginePath(projectId, region, engineId)}/assistants/${
        DEFAULT_ASSISTANT_ID}/agents?pageSize=${MAX_AGENT_PAGE_SIZE}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.gCloudToken}`,
        'x-goog-user-project': projectId
      }
    });

    if (!response.ok) {
      // The caller adds its own context, so the message is just the reason.
      const errorText = await response.text();
      throw new Error(
          apiErrorMessage(errorText) || `HTTP ${response.status}`);
    }

    const data = await response.json() as ListAgentsResponse;
    return data.agents || [];
  }

  /**
   * The engine resource name for a full `projects/.../engines/{id}` path or a
   * bare engine id, which is assumed to live in the default collection.
   */
  private enginePath(projectId: string, region: string, engineId: string): string {
    return engineId.startsWith('projects/')
      ? engineId
      : `projects/${projectId}/locations/${region}/collections/default_collection/engines/${engineId}`;
  }

  private getGCloudToken(): string {
    return this.stateService.getCurrentConfig().gCloudToken || '';
  }
}

