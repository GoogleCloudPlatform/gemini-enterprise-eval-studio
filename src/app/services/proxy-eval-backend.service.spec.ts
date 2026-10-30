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

import {HttpClientTestingModule, HttpTestingController} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';

import {Agent} from '../models/agent.model';
import {AppConfig} from '../models/app-config.model';

import {ProxyEvalBackendService} from './proxy-eval-backend.service';

const CONFIG: AppConfig = {
  projectId: 'my-project',
  region: 'global',
  selectedEngine: '',
  selectedModel: '',
  autoRaterModel: '',
  autoRaterInstruction: '',
  selectedDataStores: [],
  enableWebSearch: false,
};

describe('ProxyEvalBackendService', () => {
  let service: ProxyEvalBackendService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ProxyEvalBackendService],
    });
    service = TestBed.inject(ProxyEvalBackendService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  describe('fetchAgents', () => {
    const ENGINE_PATH =
        'projects/my-project/locations/global/collections/default_collection/engines/my-engine';

    it('should URL-encode a full engine path and return the agents', async () => {
      const agents: Agent[] = [{name: `${ENGINE_PATH}/assistants/default_assistant/agents/a1`}];

      const result =
          service.fetchAgents('my-project', 'global', ENGINE_PATH, CONFIG);
      const request = httpTesting.expectOne(
          '/api/v1/agents?projectId=my-project&region=global&engineId=' +
          'projects%2Fmy-project%2Flocations%2Fglobal%2Fcollections%2F' +
          'default_collection%2Fengines%2Fmy-engine');
      expect(request.request.method).toBe('GET');
      request.flush({agents});

      expect(await result).toEqual(agents);
    });

    it('should return an empty list when the response has no agents', async () => {
      const result =
          service.fetchAgents('my-project', 'global', 'my-engine', CONFIG);
      httpTesting
          .expectOne(
              '/api/v1/agents?projectId=my-project&region=global&engineId=my-engine')
          .flush({});

      expect(await result).toEqual([]);
    });

    it('should return an empty list when the response body is empty', async () => {
      const result =
          service.fetchAgents('my-project', 'global', 'my-engine', CONFIG);
      httpTesting
          .expectOne(
              '/api/v1/agents?projectId=my-project&region=global&engineId=my-engine')
          .flush(null);

      expect(await result).toEqual([]);
    });
  });
});
