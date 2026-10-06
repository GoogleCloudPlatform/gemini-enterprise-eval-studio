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

import {AppConfig, Engine, WidgetConfigResponse} from '../models/app-config.model';

/**
 * Request body for callAssist.
 */
export interface AssistRequest {
  selectedEngine: string;
  region: string;
  body: any;
}

/**
 * Request body for callScore.
 */
export interface ScoreRequest {
  projectId: string;
  region: string;
  model: string;
  body: any;
}

/**
 * Abstract class for Evaluation Backend Service.
 * Serves as a Dependency Injection token.
 */
export abstract class EvalBackendService {
  abstract callAssist(request: AssistRequest): Promise<Response>;
  abstract callScore(request: ScoreRequest): Promise<Response>;
  abstract fetchEngines(projectId: string, region: string, config: AppConfig): Promise<Engine[]>;
  abstract fetchWidgetConfig(
      projectId: string,
      region: string,
      engineId: string,
      config: AppConfig
  ): Promise<WidgetConfigResponse | null>;
  abstract fetchTraceId(
      projectId: string,
      assistToken: string
  ): Promise<string | undefined>;
}

