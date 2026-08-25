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
import {EvalBackendService} from './eval-backend.service';
import {EvalService} from './eval.service';
import {StateService} from './state.service';
import {MockEvalBackendService} from '../testing/mocks';

describe('EvalService', () => {
  let service: EvalService;
  let mockBackendService: MockEvalBackendService;

  beforeEach(() => {
    mockBackendService = new MockEvalBackendService();
    TestBed.configureTestingModule({
      providers: [
        EvalService,
        StateService,
        {provide: EvalBackendService, useValue: mockBackendService}
      ]
    });
    service = TestBed.inject(EvalService);
  });

  describe('scoreResponse parsing', () => {
    const config: AppConfig = {
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      autoRaterModel: 'gemini-3.5-flash',      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false
    };

    it('should parse a clean float score', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse a score wrapped in markdown fences', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '```\n0.85\n```' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse a score with conversational text', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'The semantic similarity score is 0.9.' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.9);
    });

    it('should parse score with prefix', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Score: 0.75' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.75);
    });

    it('should parse score when range instruction 0.0-1.0 is mentioned at the end', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'The score is 0.85, which is between 0.0 and 1.0.' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with scale suffix', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85 (scale 0-1)' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with fraction suffix', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85/1.0' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });

    it('should parse score with "out of" suffix', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85 out of 1' }] } }]
      }))));

      const score = await service.scoreResponse('query', 'response', 'golden', config);
      expect(score).toBe(0.85);
    });
  });

  describe('scoreResponse error handling', () => {
    const config: AppConfig = {
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      autoRaterModel: 'gemini-3.5-flash',
      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false
    };

    it('should throw an error if the response is not ok', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response('', {
        status: 500,
        statusText: 'Internal Server Error'
      })));

      await expectAsync(service.scoreResponse('query', 'response', 'golden', config))
          .toBeRejectedWithError(/HTTP error! status: 500/);
    });

    it('should throw detailed error message from JSON response if available', async () => {
      const errorResponse = {
        error: {
          message: 'Detailed error from API'
        }
      };
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify(errorResponse), {
        status: 400,
        statusText: 'Bad Request'
      })));

      await expectAsync(service.scoreResponse('query', 'response', 'golden', config))
          .toBeRejectedWithError('Detailed error from API');
    });

    it('should throw permission denied error for 403 status if JSON parsing fails', async () => {
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response('Not JSON', {
        status: 403,
        statusText: 'Forbidden'
      })));

      await expectAsync(service.scoreResponse('query', 'response', 'golden', config))
          .toBeRejectedWithError('Permission denied. Please check your Google Cloud access token.');
    });
  });

  describe('scoreResponse model selection', () => {
    const config: AppConfig = {
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'some-other-model',      autoRaterModel: 'gemini-3.5-flash',
      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false
    };

    it('should call callScore with autoRaterModel regardless of selectedModel', async () => {
      const customConfig = { ...config, autoRaterModel: 'my-custom-model' };
      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.85' }] } }]
      }))));

      await service.scoreResponse('query', 'response', 'golden', customConfig);

      expect(mockBackendService.callScoreSpy).toHaveBeenCalledWith(jasmine.objectContaining({
        model: 'my-custom-model'
      }));
    });
  });

  describe('processRow', () => {
    const config: AppConfig = {
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      autoRaterModel: 'gemini-3.5-flash',      autoRaterInstruction: 'instructions',
      selectedDataStores: [],
      enableWebSearch: false
    };

    it('should preserve the fetched text if scoring throws an error', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {
          replies: [{
            groundedContent: {
              content: {
                text: 'Fetched response text'
              }
            }
          }]
        }
      }]))));

      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response('', {
        status: 500,
        statusText: 'Internal Server Error'
      })));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result = await service.processRow({
        query: 'my query',
        golden: 'my golden'
      });

      expect(result.fetched).toBe('Fetched response text');
      expect(result.score).toBe(0);
      expect(result.scoreError).toContain('HTTP error! status: 500');
    });

    it('should extract citations from groundingAttributions and embed in fetched text', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {
          replies: [{
            groundedContent: {
              content: {
                text: 'Here is the answer.'
              }
            }
          }],
          groundingAttributions: [{
            web: {
              title: 'Doc 1',
              uri: 'https://example.com/1'
            }
          }]
        }
      }]))));

      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.9' }] } }]
      }))));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result = await service.processRow({
        query: 'my query',
        golden: 'my golden'
      });

      expect(result.fetched).toContain('Here is the answer.');
      expect(result.fetched).toContain('Sources:');
      expect(result.fetched).toContain('[1] Doc 1 - https://example.com/1');
      expect(result.score).toBe(0.9);
    });

    it('should extract citations from textGroundingMetadata references and deduplicate', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {
          replies: [{
            groundedContent: {
              content: {
                text: 'Here is the answer.'
              },
              textGroundingMetadata: {
                references: [
                  {
                    documentMetadata: {
                      title: 'Ref 1',
                      uri: 'https://example.com/ref1'
                    }
                  },
                  {
                    documentMetadata: {
                      title: 'Ref 1',
                      uri: 'https://example.com/ref1'
                    }
                  }
                ]
              }
            }
          }]
        }
      }]))));

      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '1.0' }] } }]
      }))));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result = await service.processRow({
        query: 'my query',
        golden: 'my golden'
      });

      expect(result.fetched).toContain('[1] Ref 1 - https://example.com/ref1');
      expect(result.fetched).not.toContain('[2]');
    });

    it('should format citations when only title or uri is present or when equal', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {
          replies: [{
            groundedContent: {
              content: {
                text: 'Answer.'
              }
            }
          }],
          groundingAttributions: [
            { title: 'Only Title' },
            { uri: 'https://only-uri.com' },
            { title: 'https://same-uri.com', uri: 'https://same-uri.com' }
          ]
        }
      }]))));

      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.8' }] } }]
      }))));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result = await service.processRow({
        query: 'my query',
        golden: 'my golden'
      });

      expect(result.fetched).toContain('[1] Only Title');
      expect(result.fetched).toContain('[2] https://only-uri.com');
      expect(result.fetched).toContain('[3] https://same-uri.com');
      expect(result.fetched).not.toContain('https://same-uri.com - https://same-uri.com');
    });

    it('should extract citations when grounding metadata arrives in a later streaming chunk', async () => {
      const stream = new ReadableStream({
        start(controller) {
          const chunk1 = '[{"answer":{"replies":[{"groundedContent":{"content":{"text":"First part."}}}]}}';
          const chunk2 = ',{"answer":{"replies":[{"groundedContent":{"textGroundingMetadata":{"references":[{"documentMetadata":{"title":"Doc 2","uri":"https://example.com/2"}}]}}}]}}]';
          controller.enqueue(new TextEncoder().encode(chunk1));
          controller.enqueue(new TextEncoder().encode(chunk2));
          controller.close();
        }
      });

      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(stream)));

      mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '0.9' }] } }]
      }))));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result = await service.processRow({
        query: 'my query',
        golden: 'my golden'
      });

      expect(result.fetched).toContain('First part.');
      expect(result.fetched).toContain('[1] Doc 2 - https://example.com/2');
    });
  });
});

