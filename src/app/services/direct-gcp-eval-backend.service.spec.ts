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

import {TestBed} from '@angular/core/testing';
import {DirectGcpEvalBackendService} from './direct-gcp-eval-backend.service';
import {StateService} from './state.service';

describe('DirectGcpEvalBackendService', () => {
  let service: DirectGcpEvalBackendService;
  let stateService: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DirectGcpEvalBackendService,
        StateService,
      ],
    });
    service = TestBed.inject(DirectGcpEvalBackendService);
    stateService = TestBed.inject(StateService);
    stateService.setConfig({
      projectId: 'test-project',
      region: 'global',
      selectedEngine: 'test-engine',
      selectedModel: 'test-model',
      autoRaterModel: 'gemini-3.5-flash',
      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false,
      gCloudToken: 'test-token',
    });
  });

  describe('fetchTraceId', () => {
    it('passes Authorization and x-goog-user-project headers and returns traceId', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({traces: [{traceId: 'trace-123'}]}), {
          status: 200,
        })
      );

      const traceId = await service.fetchTraceId('test-project', 'assist-abc');

      expect(traceId).toBe('trace-123');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://cloudtrace.googleapis.com/v1/projects/test-project/traces?filter=%2Bgemini_enterprise.assist_token%3Aassist-abc',
        {
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
        }
      );
    });

    it('returns undefined when projectId or assistToken is empty', async () => {
      const fetchSpy = spyOn(window, 'fetch');

      expect(await service.fetchTraceId('', 'assist-abc')).toBeUndefined();
      expect(await service.fetchTraceId('test-project', '')).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns undefined when 200 OK response has no matching traces', async () => {
      spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );

      expect(
        await service.fetchTraceId('test-project', 'assist-abc')
      ).toBeUndefined();
    });

    it('throws an error with status when response is not ok', async () => {
      spyOn(window, 'fetch').and.resolveTo(
        new Response('Forbidden', {status: 403})
      );

      await expectAsync(
        service.fetchTraceId('test-project', 'assist-abc')
      ).toBeRejectedWithError('Failed to fetch trace ID: HTTP 403');
    });
  });
});
