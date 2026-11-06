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

import {Request, Response} from 'express';
import {google} from 'googleapis';

import {Config} from './config';
import {createProxyRouter, parseEngineQuery, resolveEnginePath} from './proxy';

describe('proxy module', () => {
  const mockConfig: Config = {
    session_config: {encryption_key_secret: 'dummy-secret'},
    auth_providers: [],
  };

  function findRouteHandler(path: string) {
    const router = createProxyRouter(mockConfig);
    const route = router.stack.find(s => s.route?.path === path);
    expect(route).toBeDefined();
    return route!.route!.stack[0];
  }

  function stubOAuthRequest(responseData: unknown) {
    const requestSpy =
        jasmine.createSpy('request').and.resolveTo({data: responseData});
    spyOn(google.auth, 'OAuth2').and.returnValue({
      setCredentials: jasmine.createSpy('setCredentials'),
      request: requestSpy,
    } as unknown as InstanceType<typeof google.auth.OAuth2>);
    return requestSpy;
  }

  describe('/api/v1/assist', () => {
    it('should forward request to Discovery Engine with Bearer token and stream response',
       async () => {
         const headersMap = new Map<string, string>();
         headersMap.set('Content-Type', 'application/json');

         const mockResponse = {
           ok: true,
           status: 200,
           headers: {
             get: (name: string) => headersMap.get(name) || null,
             has: (name: string) => headersMap.has(name),
           },
           body: {
             getReader: () => ({
               read: async () => ({done: true, value: undefined}),
             }),
           },
         };

         const mockFetch =
             spyOn(globalThis as any, 'fetch')
                 .and.returnValue(Promise.resolve(mockResponse as any));

         const req = {
           body: {
             selectedEngine:
                 'projects/p1/locations/l1/collections/c1/engines/e1',
             region: 'us-central1',
             body: {query: {text: 'hello'}},
           },
           session: {
             token: {
               access_token: 'mock-access-token',
             },
           },
         } as unknown as Request;

         const setHeaderSpy = jasmine.createSpy('setHeader');
         const res = {
           status: jasmine.createSpy('status').and.returnValue({
             send: jasmine.createSpy('send'),
           }),
           setHeader: setHeaderSpy,
           write: jasmine.createSpy('write'),
           end: jasmine.createSpy('end'),
         } as unknown as Response;

         await findRouteHandler('/api/v1/assist').handle(req, res, () => {});

         expect(mockFetch).toHaveBeenCalledWith(
             'https://us-central1-discoveryengine.googleapis.com/v1/projects/p1/locations/l1/collections/c1/engines/e1/assistants/default_assistant:streamAssist',
             {
               method: 'POST',
               headers: {
                 'Authorization': 'Bearer mock-access-token',
                 'Content-Type': 'application/json',
               },
               body: JSON.stringify({query: {text: 'hello'}}),
             });
         expect(setHeaderSpy)
             .toHaveBeenCalledWith('Content-Type', 'application/json');
       });

    it('should forward upstream error status and text when response is not OK',
       async () => {
         const headersMap = new Map<string, string>();
         headersMap.set('Content-Type', 'application/json');

         const mockResponse = {
           ok: false,
           status: 403,
           headers: {
             get: (name: string) => headersMap.get(name) || null,
             has: (name: string) => headersMap.has(name),
           },
           text: async () => 'Forbidden',
         };

         const mockFetch =
             spyOn(globalThis as any, 'fetch')
                 .and.returnValue(Promise.resolve(mockResponse as any));

         const req = {
           body: {
             selectedEngine:
                 'projects/p1/locations/l1/collections/c1/engines/e1',
             region: 'us-central1',
             body: {},
           },
           session: {
             token: {
               access_token: 'mock-access-token',
             },
           },
         } as unknown as Request;

         const sendSpy = jasmine.createSpy('send');
         const statusSpy =
             jasmine.createSpy('status').and.returnValue({send: sendSpy});
         const res = {
           status: statusSpy,
           setHeader: jasmine.createSpy('setHeader'),
           write: jasmine.createSpy('write'),
           end: jasmine.createSpy('end'),
         } as unknown as Response;

         await findRouteHandler('/api/v1/assist').handle(req, res, () => {});

         expect(mockFetch).toHaveBeenCalled();
         expect(statusSpy).toHaveBeenCalledWith(403);
         expect(sendSpy).toHaveBeenCalledWith('Forbidden');
       });

    it('routes eu requests to eu-discoveryengine.googleapis.com', async () => {
      const headersMap = new Map<string, string>([
        ['Content-Type', 'application/json'],
      ]);
      const mockFetch = spyOn(globalThis, 'fetch').and.resolveTo({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => headersMap.get(name) || null,
          has: (name: string) => headersMap.has(name),
        },
        body: {
          getReader: () => ({
            read: async () => ({done: true, value: undefined}),
          }),
        },
      } as unknown as globalThis.Response);
      const enginePath =
          'projects/p1/locations/eu/collections/default_collection/engines/e1';
      const req = {
        body: {
          selectedEngine: enginePath,
          region: 'eu',
          body: {query: {text: 'hello'}},
        },
        session: {token: {access_token: 'mock-access-token'}},
      } as unknown as Request;
      const endSpy = jasmine.createSpy('end');
      const res = {
        status: jasmine.createSpy('status'),
        setHeader: jasmine.createSpy('setHeader'),
        write: jasmine.createSpy('write'),
        end: endSpy,
      } as unknown as Response;

      await findRouteHandler('/api/v1/assist').handle(req, res, () => {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
          `https://eu-discoveryengine.googleapis.com/v1/${enginePath}/assistants/default_assistant:streamAssist`,
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer mock-access-token',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({query: {text: 'hello'}}),
          });
      expect(endSpy).toHaveBeenCalled();
    });

    it('routes global requests to discoveryengine.googleapis.com', async () => {
      const headersMap = new Map<string, string>([
        ['Content-Type', 'application/json'],
      ]);
      const mockFetch = spyOn(globalThis, 'fetch').and.resolveTo({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => headersMap.get(name) || null,
          has: (name: string) => headersMap.has(name),
        },
        body: {
          getReader: () => ({
            read: async () => ({done: true, value: undefined}),
          }),
        },
      } as unknown as globalThis.Response);
      const enginePath =
          'projects/p1/locations/global/collections/default_collection/engines/e1';
      const req = {
        body: {
          selectedEngine: enginePath,
          region: 'global',
          body: {query: {text: 'hello'}},
        },
        session: {token: {access_token: 'mock-access-token'}},
      } as unknown as Request;
      const endSpy = jasmine.createSpy('end');
      const res = {
        status: jasmine.createSpy('status'),
        setHeader: jasmine.createSpy('setHeader'),
        write: jasmine.createSpy('write'),
        end: endSpy,
      } as unknown as Response;

      await findRouteHandler('/api/v1/assist').handle(req, res, () => {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
          `https://discoveryengine.googleapis.com/v1/${enginePath}/assistants/default_assistant:streamAssist`,
          {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer mock-access-token',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({query: {text: 'hello'}}),
          });
      expect(endSpy).toHaveBeenCalled();
    });
  });

  describe('/api/v1/score', () => {
    function createScoreResponse() {
      const sendSpy = jasmine.createSpy('send');
      const statusSpy =
          jasmine.createSpy('status').and.returnValue({send: sendSpy});
      const jsonSpy = jasmine.createSpy('json');
      const res = {status: statusSpy, json: jsonSpy} as unknown as Response;
      return {res, statusSpy, sendSpy, jsonSpy};
    }

    it('routes global requests to aiplatform.googleapis.com', async () => {
      const scorePayload = {
        candidates: [{content: {parts: [{text: '0.9'}]}}],
      };
      const requestSpy = stubOAuthRequest(scorePayload);
      const {res, jsonSpy} = createScoreResponse();
      const req = {
        body: {
          projectId: 'my-project',
          region: 'global',
          model: 'gemini-3.5-flash',
          body: {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]},
        },
        session: {token: {access_token: 'mock-access-token'}},
      } as unknown as Request;

      await findRouteHandler('/api/v1/score').handle(req, res, () => {});

      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
        url:
            'https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
        method: 'POST',
        data: {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]},
        headers: jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
      }));
      expect(jsonSpy).toHaveBeenCalledTimes(1);
      expect(jsonSpy).toHaveBeenCalledWith(scorePayload);
    });

    it('routes eu multi-regional requests to aiplatform.eu.rep.googleapis.com',
       async () => {
         const scorePayload = {
           candidates: [{content: {parts: [{text: '0.85'}]}}],
         };
         const requestSpy = stubOAuthRequest(scorePayload);
         const {res, jsonSpy} = createScoreResponse();
         const req = {
           body: {
             projectId: 'my-project',
             region: 'eu',
             model: 'gemini-3.5-flash',
             body: {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]},
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/score').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://aiplatform.eu.rep.googleapis.com/v1/projects/my-project/locations/eu/publishers/google/models/gemini-3.5-flash:generateContent',
           method: 'POST',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(scorePayload);
       });

    it('routes us multi-regional requests to aiplatform.us.rep.googleapis.com',
       async () => {
         const scorePayload = {
           candidates: [{content: {parts: [{text: '0.75'}]}}],
         };
         const requestSpy = stubOAuthRequest(scorePayload);
         const {res, jsonSpy} = createScoreResponse();
         const req = {
           body: {
             projectId: 'my-project',
             region: 'us',
             model: 'gemini-3.5-flash',
             body: {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]},
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/score').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://aiplatform.us.rep.googleapis.com/v1/projects/my-project/locations/us/publishers/google/models/gemini-3.5-flash:generateContent',
           method: 'POST',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(scorePayload);
       });

    it('routes single-region requests to {region}-aiplatform.googleapis.com',
       async () => {
         const scorePayload = {
           candidates: [{content: {parts: [{text: '1.0'}]}}],
         };
         const requestSpy = stubOAuthRequest(scorePayload);
         const {res, jsonSpy} = createScoreResponse();
         const req = {
           body: {
             projectId: 'my-project',
             region: 'europe-west4',
             model: 'gemini-3.5-flash',
             body: {contents: [{role: 'user', parts: [{text: 'Rate this'}]}]},
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/score').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west4/publishers/google/models/gemini-3.5-flash:generateContent',
           method: 'POST',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(scorePayload);
       });

    it('returns 400 when region is invalid', async () => {
      const requestSpy = stubOAuthRequest({});
      const {res, statusSpy, sendSpy} = createScoreResponse();
      const req = {
        body: {
          projectId: 'my-project',
          region: 'eu/../bad',
          model: 'gemini-3.5-flash',
          body: {},
        },
        session: {token: {access_token: 'mock-access-token'}},
      } as unknown as Request;

      await findRouteHandler('/api/v1/score').handle(req, res, () => {});

      expect(statusSpy).toHaveBeenCalledTimes(1);
      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
          'Invalid or missing region parameter.');
      expect(requestSpy).not.toHaveBeenCalled();
    });
  });

  describe('/api/v1/engines', () => {
    it('lists engines from eu-discoveryengine.googleapis.com when region is eu',
       async () => {
         const enginesPayload = {
           engines: [{
             name:
                 'projects/123/locations/eu/collections/default_collection/engines/e1',
           }],
         };
         const requestSpy = stubOAuthRequest(enginesPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {projectId: 'my-project', region: 'eu'},
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/engines').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://eu-discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/eu/collections/default_collection/engines',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(enginesPayload);
       });

    it('lists engines from discoveryengine.googleapis.com when region is global',
       async () => {
         const enginesPayload = {engines: []};
         const requestSpy = stubOAuthRequest(enginesPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {projectId: 'my-project', region: 'global'},
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/engines').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/global/collections/default_collection/engines',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(enginesPayload);
       });

    it('lists engines from us-discoveryengine.googleapis.com when region is us',
       async () => {
         const enginesPayload = {engines: []};
         const requestSpy = stubOAuthRequest(enginesPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {projectId: 'my-project', region: 'us'},
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/engines').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://us-discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/us/collections/default_collection/engines',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(enginesPayload);
       });

    it('lists engines from {region}-discoveryengine.googleapis.com for single regions',
       async () => {
         const enginesPayload = {engines: []};
         const requestSpy = stubOAuthRequest(enginesPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {projectId: 'my-project', region: 'europe-west4'},
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/engines').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://europe-west4-discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/europe-west4/collections/default_collection/engines',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(enginesPayload);
       });
  });

  describe('/api/v1/widget-config', () => {
    it('fetches widget config from eu-discoveryengine.googleapis.com for a bare engine ID',
       async () => {
         const widgetPayload = {collectionComponents: []};
         const requestSpy = stubOAuthRequest(widgetPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {
             projectId: 'my-project',
             region: 'eu',
             engineId: 'my-engine',
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/widget-config')
             .handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://eu-discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/eu/collections/default_collection/engines/my-engine/widgetConfigs/default_search_widget_config',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(widgetPayload);
       });

    it('fetches widget config from eu-discoveryengine.googleapis.com for a full engine path',
       async () => {
         const enginePath =
             'projects/123456/locations/eu/collections/default_collection/engines/my-engine';
         const widgetPayload = {collectionComponents: []};
         const requestSpy = stubOAuthRequest(widgetPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {
             projectId: 'my-project',
             region: 'eu',
             engineId: enginePath,
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/widget-config')
             .handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               `https://eu-discoveryengine.googleapis.com/v1alpha/${enginePath}/widgetConfigs/default_search_widget_config`,
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(widgetPayload);
       });

    it('fetches widget config from discoveryengine.googleapis.com when region is global',
       async () => {
         const widgetPayload = {collectionComponents: []};
         const requestSpy = stubOAuthRequest(widgetPayload);
         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;
         const req = {
           query: {
             projectId: 'my-project',
             region: 'global',
             engineId: 'my-engine',
           },
           session: {token: {access_token: 'mock-access-token'}},
         } as unknown as Request;

         await findRouteHandler('/api/v1/widget-config')
             .handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledTimes(1);
         expect(requestSpy).toHaveBeenCalledWith(jasmine.objectContaining({
           url:
               'https://discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/global/collections/default_collection/engines/my-engine/widgetConfigs/default_search_widget_config',
           method: 'GET',
           headers:
               jasmine.objectContaining({'x-goog-user-project': 'my-project'}),
         }));
         expect(jsonSpy).toHaveBeenCalledTimes(1);
         expect(jsonSpy).toHaveBeenCalledWith(widgetPayload);
       });
  });

  describe('/api/v1/trace', () => {
    it('should return 400 when projectId or assistToken is missing or not a string',
       async () => {
         const routeHandler = findRouteHandler('/api/v1/trace');

         const sendSpy = jasmine.createSpy('send');
         const statusSpy =
             jasmine.createSpy('status').and.returnValue({send: sendSpy});
         const res = {
           status: statusSpy,
           json: jasmine.createSpy('json'),
         } as unknown as Response;

         await routeHandler.handle(
             {query: {projectId: 'p1'}} as unknown as Request, res, () => {});
         expect(statusSpy).toHaveBeenCalledWith(400);

         statusSpy.calls.reset();
         await routeHandler.handle(
             {query: {projectId: ['p1', 'p2'], assistToken: 'token-xyz'}} as
                 unknown as Request,
             res, () => {});
         expect(statusSpy).toHaveBeenCalledWith(400);
       });

    it('should call Cloud Trace API and return the first matching traceId',
       async () => {
         const requestSpy =
             stubOAuthRequest({traces: [{traceId: 'trace-abc-123'}]});

         const req = {
           query: {
             projectId: 'my-project',
             assistToken: 'token-xyz',
           },
           session: {
             token: {
               access_token: 'mock-access-token',
             },
           },
         } as unknown as Request;

         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;

         await findRouteHandler('/api/v1/trace').handle(req, res, () => {});

         expect(requestSpy).toHaveBeenCalledWith({
           url:
               'https://cloudtrace.googleapis.com/v1/projects/my-project/traces?filter=%2Bgemini_enterprise.assist_token%3Atoken-xyz&pageSize=1',
           headers: {
             'x-goog-user-project': 'my-project',
           },
         });
         expect(jsonSpy).toHaveBeenCalledWith({traceId: 'trace-abc-123'});
       });

    it('should return undefined traceId when Cloud Trace API returns empty data',
       async () => {
         stubOAuthRequest({});

         const req = {
           query: {
             projectId: 'my-project',
             assistToken: 'token-xyz',
           },
           session: {
             token: {
               access_token: 'mock-access-token',
             },
           },
         } as unknown as Request;

         const jsonSpy = jasmine.createSpy('json');
         const res = {
           status: jasmine.createSpy('status'),
           json: jsonSpy,
         } as unknown as Response;

         await findRouteHandler('/api/v1/trace').handle(req, res, () => {});

         expect(jsonSpy).toHaveBeenCalledWith({traceId: undefined});
       });

    it('should forward upstream error status and message on failure',
       async () => {
         const upstreamError =
             Object.assign(new Error('Permission denied'), {
               response: {status: 403},
             });
         stubOAuthRequest({}).and.rejectWith(upstreamError);

         const req = {
           query: {
             projectId: 'my-project',
             assistToken: 'token-xyz',
           },
           session: {
             token: {
               access_token: 'mock-access-token',
             },
           },
         } as unknown as Request;

         const sendSpy = jasmine.createSpy('send');
         const statusSpy =
             jasmine.createSpy('status').and.returnValue({send: sendSpy});
         const res = {
           status: statusSpy,
           json: jasmine.createSpy('json'),
         } as unknown as Response;

         await findRouteHandler('/api/v1/trace').handle(req, res, () => {});

         expect(statusSpy).toHaveBeenCalledWith(403);
         expect(sendSpy).toHaveBeenCalledWith(
             'Proxy request failed: Permission denied');
       });
  });

  describe('/api/v1/agents', () => {
    const ENGINE_PATH =
        'projects/my-project/locations/global/collections/default_collection/engines/my-engine';

    function createRequest(query: Record<string, unknown>): Request {
      return {
        query,
        session: {token: {access_token: 'mock-access-token'}},
      } as unknown as Request;
    }

    function createResponse() {
      const sendSpy = jasmine.createSpy('send');
      const statusSpy =
          jasmine.createSpy('status').and.returnValue({send: sendSpy});
      const jsonSpy = jasmine.createSpy('json');
      const res = {status: statusSpy, json: jsonSpy} as unknown as Response;
      return {res, statusSpy, sendSpy, jsonSpy};
    }

    it('should list agents under the default assistant of the engine',
       async () => {
         const agents = {
           agents: [
             {name: `${ENGINE_PATH}/assistants/default_assistant/agents/a1`},
           ],
         };
         const mockFetch = spyOn(globalThis, 'fetch').and.resolveTo({
           ok: true,
           status: 200,
           json: async () => agents,
         } as unknown as globalThis.Response);
         const {res, jsonSpy} = createResponse();

         await findRouteHandler('/api/v1/agents')
             .handle(
                 createRequest({
                   projectId: 'my-project',
                   region: 'global',
                   engineId: 'my-engine',
                 }),
                 res, () => {});

         expect(mockFetch).toHaveBeenCalledWith(
             `https://discoveryengine.googleapis.com/v1alpha/${ENGINE_PATH}/assistants/default_assistant/agents?pageSize=1000`,
             {
               method: 'GET',
               headers: {
                 'Authorization': 'Bearer mock-access-token',
                 'x-goog-user-project': 'my-project',
               },
             });
         expect(jsonSpy).toHaveBeenCalledWith(agents);
       });

    it('should use the regional endpoint for a non-global region',
       async () => {
         const mockFetch = spyOn(globalThis, 'fetch').and.resolveTo({
           ok: true,
           status: 200,
           json: async () => ({}),
         } as unknown as globalThis.Response);
         const {res} = createResponse();

         await findRouteHandler('/api/v1/agents')
             .handle(
                 createRequest({
                   projectId: 'my-project',
                   region: 'eu',
                   engineId: 'my-engine',
                 }),
                 res, () => {});

         expect(mockFetch.calls.mostRecent().args[0])
             .toBe(
                 'https://eu-discoveryengine.googleapis.com/v1alpha/projects/my-project/locations/eu/collections/default_collection/engines/my-engine/assistants/default_assistant/agents?pageSize=1000');
       });

    it('should accept a full engine resource name, which carries the project number',
       async () => {
         const enginePath =
             'projects/123456789/locations/eu/collections/my-collection/engines/my-engine';
         const mockFetch = spyOn(globalThis, 'fetch').and.resolveTo({
           ok: true,
           status: 200,
           json: async () => ({}),
         } as unknown as globalThis.Response);
         const {res} = createResponse();

         await findRouteHandler('/api/v1/agents')
             .handle(
                 createRequest({
                   projectId: 'my-project',
                   region: 'eu',
                   engineId: enginePath,
                 }),
                 res, () => {});

         expect(mockFetch.calls.mostRecent().args[0])
             .toBe(`https://eu-discoveryengine.googleapis.com/v1alpha/${
                 enginePath}/assistants/default_assistant/agents?pageSize=1000`);
         expect(mockFetch.calls.mostRecent().args[1]?.headers)
             .toEqual(jasmine.objectContaining(
                 {'x-goog-user-project': 'my-project'}));
       });

    it('should return 401 without calling upstream when the session has no token',
       async () => {
         const mockFetch = spyOn(globalThis, 'fetch');
         const {res, statusSpy, sendSpy} = createResponse();
         const req = {
           query: {projectId: 'my-project', region: 'global', engineId: 'e'},
           session: {},
         } as unknown as Request;

         await findRouteHandler('/api/v1/agents').handle(req, res, () => {});

         expect(statusSpy).toHaveBeenCalledWith(401);
         expect(sendSpy).toHaveBeenCalledWith('Not authenticated.');
         expect(mockFetch).not.toHaveBeenCalled();
       });

    it('should forward upstream error status and text when response is not OK',
       async () => {
         spyOn(globalThis, 'fetch').and.resolveTo({
           ok: false,
           status: 403,
           text: async () => 'Forbidden',
         } as unknown as globalThis.Response);
         const {res, statusSpy, sendSpy} = createResponse();

         await findRouteHandler('/api/v1/agents')
             .handle(
                 createRequest({
                   projectId: 'my-project',
                   region: 'global',
                   engineId: 'my-engine',
                 }),
                 res, () => {});

         expect(statusSpy).toHaveBeenCalledWith(403);
         expect(sendSpy).toHaveBeenCalledWith('Forbidden');
       });

    it('should return 500 when the upstream request throws', async () => {
      spyOn(globalThis, 'fetch').and.rejectWith(new Error('network down'));
      const {res, statusSpy, sendSpy} = createResponse();

      await findRouteHandler('/api/v1/agents')
          .handle(
              createRequest({
                projectId: 'my-project',
                region: 'global',
                engineId: 'my-engine',
              }),
              res, () => {});

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(sendSpy).toHaveBeenCalledWith(
          'Proxy request failed: network down');
    });

    it('should return 400 without calling upstream for invalid parameters',
       async () => {
         const mockFetch = spyOn(globalThis, 'fetch');
         const invalidProject = 'Invalid or missing projectId parameter.';
         const invalidRegion = 'Invalid or missing region parameter.';
         const invalidEngine = 'Invalid or missing engineId parameter.';
         const cases: Array<[Record<string, unknown>, string]> = [
           [{region: 'global', engineId: 'my-engine'}, invalidProject],
           [
             {projectId: 'BAD/project', region: 'global', engineId: 'my-engine'},
             invalidProject,
           ],
           [
             {projectId: ['p1', 'p2'], region: 'global', engineId: 'my-engine'},
             invalidProject,
           ],
           [{projectId: 'my-project', engineId: 'my-engine'}, invalidRegion],
           [
             {projectId: 'my-project', region: 'us/../x', engineId: 'my-engine'},
             invalidRegion,
           ],
           [{projectId: 'my-project', region: 'global'}, invalidEngine],
           [
             {projectId: 'my-project', region: 'global', engineId: ['e1', 'e2']},
             invalidEngine,
           ],
           [
             {projectId: 'my-project', region: 'global', engineId: '../other'},
             invalidEngine,
           ],
           [
             {
               projectId: 'my-project',
               region: 'global',
               engineId:
                   'projects/my-project/locations/eu/collections/c/engines/e',
             },
             invalidEngine,
           ],
         ];

         const routeHandler = findRouteHandler('/api/v1/agents');
         for (const [query, message] of cases) {
           const {res, statusSpy, sendSpy} = createResponse();
           await routeHandler.handle(createRequest(query), res, () => {});
           expect(statusSpy)
               .withContext(JSON.stringify(query))
               .toHaveBeenCalledWith(400);
           expect(sendSpy)
               .withContext(JSON.stringify(query))
               .toHaveBeenCalledWith(message);
         }
         expect(mockFetch).not.toHaveBeenCalled();
       });
  });

  describe('parseEngineQuery', () => {
    it('should return the validated engine', () => {
      expect(parseEngineQuery({
        projectId: 'my-project',
        region: 'eu',
        engineId: 'my-engine',
      })).toEqual({
        projectId: 'my-project',
        region: 'eu',
        enginePath:
            'projects/my-project/locations/eu/collections/default_collection/engines/my-engine',
      });
    });

    it('should name the first invalid parameter', () => {
      expect(parseEngineQuery({region: 'eu', engineId: 'e'}))
          .toEqual({error: 'Invalid or missing projectId parameter.'});
      expect(parseEngineQuery({projectId: 'my-project', engineId: 'e'}))
          .toEqual({error: 'Invalid or missing region parameter.'});
      expect(parseEngineQuery({projectId: 'my-project', region: 'eu'}))
          .toEqual({error: 'Invalid or missing engineId parameter.'});
      expect(parseEngineQuery(
                 {projectId: 'my-project', region: 'eu', engineId: '../x'}))
          .toEqual({error: 'Invalid or missing engineId parameter.'});
    });

    it('should reject a missing query rather than throw', () => {
      expect(parseEngineQuery(undefined as unknown as Request['query']))
          .toEqual({error: 'Invalid or missing projectId parameter.'});
    });
  });

  describe('resolveEnginePath', () => {
    const FULL_PATH =
        'projects/my-project/locations/global/collections/default_collection/engines/my-engine';

    it('should expand a bare engine ID under the default collection', () => {
      expect(resolveEnginePath('my-project', 'global', 'my-engine'))
          .toBe(FULL_PATH);
    });

    it('should pass through a well-formed full engine path', () => {
      expect(resolveEnginePath('my-project', 'global', FULL_PATH))
          .toBe(FULL_PATH);
    });

    it('should keep the collection named in a full path', () => {
      const otherCollection =
          FULL_PATH.replace('default_collection', 'other_collection');
      expect(resolveEnginePath('my-project', 'global', otherCollection))
          .toBe(otherCollection);
    });

    it('should reject a full path that is not an engine resource', () => {
      expect(resolveEnginePath(
                 'my-project', 'global',
                 'projects/p/locations/global/collections/c/dataStores/d'))
          .toBeNull();
      expect(resolveEnginePath(
                 'my-project', 'global', `${FULL_PATH}/assistants/x`))
          .toBeNull();
    });

    it('should reject a full path in a different region than the request',
       () => {
         expect(resolveEnginePath('my-project', 'eu', FULL_PATH)).toBeNull();
       });

    it('should not compare the project of a full path, which may be a number',
       () => {
         const byNumber = FULL_PATH.replace('my-project', '123456789');
         expect(resolveEnginePath('my-project', 'global', byNumber))
             .toBe(byNumber);
       });

    it('should reject a full path with segments that could escape it', () => {
      expect(resolveEnginePath(
                 'my-project', 'global',
                 'projects/../locations/global/collections/c/engines/e'))
          .toBeNull();
      expect(resolveEnginePath(
                 'my-project', 'global', `${FULL_PATH}?alt=media`))
          .toBeNull();
    });

    it('should reject a bare ID that could escape the resource path', () => {
      expect(resolveEnginePath('my-project', 'global', '../../other'))
          .toBeNull();
      expect(resolveEnginePath('my-project', 'global', 'engine/assistants/x'))
          .toBeNull();
      expect(resolveEnginePath('my-project', 'global', 'engine?alt=media'))
          .toBeNull();
      expect(resolveEnginePath('my-project', 'global', '')).toBeNull();
    });
  });
});
