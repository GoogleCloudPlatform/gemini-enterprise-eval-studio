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

import { BehaviorSubject } from 'rxjs';
import { Engine } from '../models/app-config.model';
import { AuthProvider, AuthService } from '../services/auth.service';
import { AssistRequest, EvalBackendService, ScoreRequest } from '../services/eval-backend.service';

/**
 * Mock implementation of AuthService for testing.
 */
export class MockAuthService extends AuthService {
  override showCredentialInputs = false; // Default to false to keep existing tests green
  override isAuthenticated$ = new BehaviorSubject<boolean>(true);
  override isAuthChecked$ = new BehaviorSubject<boolean>(true);
  override isLoadingProviders$ = new BehaviorSubject<boolean>(false);
  override providers$ = new BehaviorSubject<AuthProvider[]>([]);

  override checkAuth = jasmine.createSpy('checkAuth');
  override loadProviders = jasmine.createSpy('loadProviders');
  override loginWithProvider = jasmine.createSpy('loginWithProvider');
  override logout = jasmine.createSpy('logout');
}

import {WidgetConfigResponse} from '../models/app-config.model';

/**
 * Mock implementation of EvalBackendService for testing.
 */
export class MockEvalBackendService extends EvalBackendService {
  callAssistSpy = jasmine.createSpy('callAssist').and.returnValue(Promise.resolve(new Response('[]')));
  callScoreSpy = jasmine.createSpy('callScore').and.returnValue(Promise.resolve(new Response('{}')));
  fetchEnginesSpy = jasmine.createSpy('fetchEngines').and.returnValue(Promise.resolve([]));
  fetchWidgetConfigSpy = jasmine.createSpy('fetchWidgetConfig').and.returnValue(Promise.resolve(null));
  fetchTraceIdSpy = jasmine.createSpy('fetchTraceId').and.resolveTo(undefined);


  override callAssist(request: AssistRequest): Promise<Response> {
    return this.callAssistSpy(request);
  }

  override callScore(request: ScoreRequest): Promise<Response> {
    return this.callScoreSpy(request);
  }

  override fetchEngines(projectId: string, region: string, config: any): Promise<Engine[]> {
    return this.fetchEnginesSpy(projectId, region, config);
  }

  override fetchWidgetConfig(projectId: string, region: string, engineId: string, config: any): Promise<WidgetConfigResponse | null> {
    return this.fetchWidgetConfigSpy(projectId, region, engineId, config);
  }

  override fetchTraceId(projectId: string, assistToken: string): Promise<string | undefined> {
    return this.fetchTraceIdSpy(projectId, assistToken);
  }
}
