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

import {Agent} from '../models/agent.model';
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

  describe('callAssist', () => {
    it('routes eu streamAssist requests to eu-discoveryengine.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response('[]', {status: 200})
      );
      const enginePath =
          'projects/test-project/locations/eu/collections/default_collection/engines/test-engine';

      await service.callAssist({
        selectedEngine: enginePath,
        region: 'eu',
        body: {query: {text: 'hello'}},
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://eu-discoveryengine.googleapis.com/v1/${enginePath}/assistants/default_assistant:streamAssist`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({query: {text: 'hello'}}),
        }
      );
    });

    it('routes global streamAssist requests to discoveryengine.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response('[]', {status: 200})
      );
      const enginePath =
          'projects/test-project/locations/global/collections/default_collection/engines/test-engine';

      await service.callAssist({
        selectedEngine: enginePath,
        region: 'global',
        body: {query: {text: 'hello'}},
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://discoveryengine.googleapis.com/v1/${enginePath}/assistants/default_assistant:streamAssist`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          },
          body: JSON.stringify({query: {text: 'hello'}}),
        }
      );
    });
  });

  describe('callScore', () => {
    it('routes global scoring requests to aiplatform.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );
      const body = {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]};

      await service.callScore({
        projectId: 'test-project',
        region: 'global',
        model: 'gemini-3.5-flash',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
    });

    it('routes eu multi-regional scoring requests to aiplatform.eu.rep.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );
      const body = {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]};

      await service.callScore({
        projectId: 'test-project',
        region: 'eu',
        model: 'gemini-3.5-flash',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://aiplatform.eu.rep.googleapis.com/v1/projects/test-project/locations/eu/publishers/google/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
    });

    it('routes us multi-regional scoring requests to aiplatform.us.rep.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );
      const body = {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]};

      await service.callScore({
        projectId: 'test-project',
        region: 'us',
        model: 'gemini-3.5-flash',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://aiplatform.us.rep.googleapis.com/v1/projects/test-project/locations/us/publishers/google/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
    });

    it('routes single-region scoring requests to {region}-aiplatform.googleapis.com', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );
      const body = {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]};

      await service.callScore({
        projectId: 'test-project',
        region: 'europe-west4',
        model: 'gemini-3.5-flash',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://europe-west4-aiplatform.googleapis.com/v1/projects/test-project/locations/europe-west4/publishers/google/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
    });

    it('falls back to global when region is empty', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );
      const body = {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]};

      await service.callScore({
        projectId: 'test-project',
        region: '',
        model: 'gemini-3.5-flash',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );
    });
  });

  describe('fetchEngines', () => {
    it('fetches engines from eu-discoveryengine.googleapis.com when region is eu', async () => {
      const engine = {
        name: 'projects/123/locations/eu/collections/default_collection/engines/e1',
        displayName: 'EU Engine',
      };
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({engines: [engine]}), {status: 200})
      );

      const engines = await service.fetchEngines(
          'test-project', 'eu', stateService.getCurrentConfig());

      expect(engines).toEqual([engine]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://eu-discoveryengine.googleapis.com/v1alpha/projects/test-project/locations/eu/collections/default_collection/engines',
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
          },
        }
      );
    });
  });

  describe('fetchWidgetConfig', () => {
    it('fetches widget config from eu-discoveryengine.googleapis.com when region is eu', async () => {
      const widgetConfig = {collectionComponents: []};
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify(widgetConfig), {status: 200})
      );

      const result = await service.fetchWidgetConfig(
          'test-project', 'eu', 'my-engine', stateService.getCurrentConfig());

      expect(result).toEqual(widgetConfig);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://eu-discoveryengine.googleapis.com/v1alpha/projects/test-project/locations/eu/collections/default_collection/engines/my-engine/widgetConfigs/default_search_widget_config',
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
          },
        }
      );
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

  describe('fetchAgents', () => {
    const ENGINE_PATH =
        'projects/test-project/locations/global/collections/default_collection/engines/test-engine';
    const AGENT: Agent = {
      name: `${ENGINE_PATH}/assistants/default_assistant/agents/agent-1`,
      displayName: 'Agent One',
      state: 'ENABLED',
    };

    it('lists agents under the default assistant of a bare engine ID', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({agents: [AGENT]}), {status: 200})
      );

      const agents = await service.fetchAgents(
          'test-project', 'global', 'test-engine', stateService.getCurrentConfig());

      expect(agents).toEqual([AGENT]);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://discoveryengine.googleapis.com/v1alpha/${ENGINE_PATH}/assistants/default_assistant/agents?pageSize=1000`,
        {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer test-token',
            'x-goog-user-project': 'test-project',
          },
        }
      );
    });

    it('uses a full engine resource name as is, on the regional host', async () => {
      const enginePath =
          'projects/test-project/locations/eu/collections/other_collection/engines/e1';
      const fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({agents: []}), {status: 200})
      );

      await service.fetchAgents(
          'test-project', 'eu', enginePath, stateService.getCurrentConfig());

      expect(fetchSpy.calls.mostRecent().args[0]).toBe(
          `https://eu-discoveryengine.googleapis.com/v1alpha/${enginePath}/assistants/default_assistant/agents?pageSize=1000`);
    });

    it('returns an empty list when the engine has no agents', async () => {
      spyOn(window, 'fetch').and.resolveTo(
        new Response(JSON.stringify({}), {status: 200})
      );

      expect(await service.fetchAgents(
          'test-project', 'global', 'test-engine',
          stateService.getCurrentConfig())).toEqual([]);
    });

    it('throws with the message of a Google API error body', async () => {
      spyOn(window, 'fetch').and.resolveTo(new Response(
        JSON.stringify({
          error: {code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED'},
        }),
        {status: 403}
      ));

      await expectAsync(
        service.fetchAgents(
            'test-project', 'global', 'test-engine',
            stateService.getCurrentConfig())
      ).toBeRejectedWithError('Permission denied');
    });

    it('throws with the raw upstream text when the body is not an API error', async () => {
      spyOn(window, 'fetch').and.resolveTo(
        new Response('Service Unavailable', {status: 503})
      );

      await expectAsync(
        service.fetchAgents(
            'test-project', 'global', 'test-engine',
            stateService.getCurrentConfig())
      ).toBeRejectedWithError('Service Unavailable');
    });

    it('throws with the HTTP status when the error body is empty', async () => {
      spyOn(window, 'fetch').and.resolveTo(new Response('', {status: 503}));

      await expectAsync(
        service.fetchAgents(
            'test-project', 'global', 'test-engine',
            stateService.getCurrentConfig())
      ).toBeRejectedWithError('HTTP 503');
    });
  });
});
