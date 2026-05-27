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
import {AppConfig} from '../models/app-config.model';
import {EvalService} from './eval.service';
import {StateService} from './state.service';

describe('EvalService', () => {
  let service: EvalService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EvalService, StateService]
    });
    service = TestBed.inject(EvalService);
  });

  describe('scoreResponse parsing', () => {
    const config: AppConfig = {
      gCloudToken: 'token',
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      geminiApiKey: 'key',
      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false
    };

    it('should parse a clean float score', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse a score wrapped in markdown fences', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '```\n0.85\n```' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse a score with conversational text', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'The semantic similarity score is 0.9.' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.9);
    });

    it('should parse score with prefix', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Score: 0.75' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.75);
    });
    it('should parse score when range instruction 0.0-1.0 is mentioned at the end', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'The score is 0.85, which is between 0.0 and 1.0.' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with scale suffix', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85 (scale 0-1)' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with fraction suffix', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85/1.0' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with "out of" suffix', async () => {
      spyOn(globalThis, 'fetch').and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85 out of 1' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });
  });
});
