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

import {Config} from './config';
import {createProxyRouter} from './proxy';

describe('proxy module', () => {
  const mockConfig: Config = {
    session_config: {encryption_key_secret: 'dummy-secret'},
    auth_providers: [],
  };

  describe('/api/v1/assist', () => {
    it('should forward request to Discovery Engine with Bearer token and stream response',
       async () => {
         const router = createProxyRouter(mockConfig);
         const route =
             router.stack.find(s => s.route?.path === '/api/v1/assist');
         expect(route).toBeDefined();

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

         await route!.route!.stack[0].handle(req, res, () => {});

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
         const router = createProxyRouter(mockConfig);
         const route =
             router.stack.find(s => s.route?.path === '/api/v1/assist');
         expect(route).toBeDefined();

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

         await route!.route!.stack[0].handle(req, res, () => {});

         expect(mockFetch).toHaveBeenCalled();
         expect(statusSpy).toHaveBeenCalledWith(403);
         expect(sendSpy).toHaveBeenCalledWith('Forbidden');
       });
  });
});
