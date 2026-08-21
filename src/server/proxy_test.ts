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
    it('should forward x-cloud-trace-context when present in upstream response',
       async () => {
         const router = createProxyRouter(mockConfig);
         const route =
             router.stack.find(s => s.route?.path === '/api/v1/assist');
         expect(route).toBeDefined();

         const headersMap = new Map<string, string>();
         headersMap.set('Content-Type', 'application/json');
         headersMap.set('x-cloud-trace-context', 'trace-id-123/span-id;o=1');

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
             body: {},
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

         expect(mockFetch).toHaveBeenCalled();
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'x-cloud-trace-context', 'trace-id-123/span-id;o=1');
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'Access-Control-Expose-Headers', 'x-cloud-trace-context');
       });

    it('should not set trace headers if x-cloud-trace-context is absent',
       async () => {
         const originalEnv = process.env['NODE_ENV'];
         process.env['NODE_ENV'] = 'production';
         try {
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
               body: {},
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

           expect(mockFetch).toHaveBeenCalled();
           expect(setHeaderSpy)
               .not.toHaveBeenCalledWith(
                   'x-cloud-trace-context', jasmine.any(String));
           expect(setHeaderSpy)
               .not.toHaveBeenCalledWith(
                   'Access-Control-Expose-Headers', 'x-cloud-trace-context');
         } finally {
           process.env['NODE_ENV'] = originalEnv;
         }
       });

    it('should set trace headers even if upstream response is not OK',
       async () => {
         const router = createProxyRouter(mockConfig);
         const route =
             router.stack.find(s => s.route?.path === '/api/v1/assist');
         expect(route).toBeDefined();

         const headersMap = new Map<string, string>();
         headersMap.set('Content-Type', 'application/json');
         headersMap.set(
             'x-cloud-trace-context', 'error-trace-id-123/span-id;o=1');

         const mockResponse = {
           ok: false,
           status: 500,
           headers: {
             get: (name: string) => headersMap.get(name) || null,
             has: (name: string) => headersMap.has(name),
           },
           text: async () => 'Internal Server Error',
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

         expect(mockFetch).toHaveBeenCalled();
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'x-cloud-trace-context', 'error-trace-id-123/span-id;o=1');
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'Access-Control-Expose-Headers', 'x-cloud-trace-context');
       });

    it('should set trace headers even if upstream response is 403 Forbidden',
       async () => {
         const router = createProxyRouter(mockConfig);
         const route =
             router.stack.find(s => s.route?.path === '/api/v1/assist');
         expect(route).toBeDefined();

         const headersMap = new Map<string, string>();
         headersMap.set('Content-Type', 'application/json');
         headersMap.set(
             'x-cloud-trace-context', 'forbidden-trace-id-999/span-id;o=1');

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

         expect(mockFetch).toHaveBeenCalled();
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'x-cloud-trace-context', 'forbidden-trace-id-999/span-id;o=1');
         expect(setHeaderSpy)
             .toHaveBeenCalledWith(
                 'Access-Control-Expose-Headers', 'x-cloud-trace-context');
       });
  });
});
