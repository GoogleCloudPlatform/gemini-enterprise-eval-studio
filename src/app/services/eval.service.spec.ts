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
import {ScoreResult, Scorer, ScoringRequest} from '../scoring/scorer';
import {SCORERS} from '../scoring/scorer.registry';
import {AUTO_RATER_SCORER_ID} from '../scoring/scorers/auto-rater.scorer';
import {LCS_SCORER_ID} from '../scoring/scorers/lcs.scorer';
import {MockEvalBackendService} from '../testing/mocks';

import {EvalBackendService} from './eval-backend.service';
import {EvalService} from './eval.service';
import {StateService} from './state.service';

const CONFIG: AppConfig = {
  gCloudToken: 'token',
  projectId: 'project',
  region: 'global',
  selectedEngine: 'engine',
  selectedModel: 'model',
  autoRaterModel: 'gemini-3.5-flash',
  autoRaterInstruction: 'instructions',
  selectedDataStores: [],
  enableWebSearch: false
};

const config: AppConfig = CONFIG;

/** A scorer whose behaviour and golden requirement the test controls. */
class FakeScorer extends Scorer {
  override readonly requiresGolden: boolean;
  readonly requests: ScoringRequest[] = [];

  constructor(
      readonly id: string, readonly displayName: string,
      private readonly behavior: () => Promise<ScoreResult>,
      requiresGolden = false) {
    super();
    this.requiresGolden = requiresGolden;
  }

  async score(request: ScoringRequest): Promise<ScoreResult> {
    this.requests.push(request);
    return this.behavior();
  }
}

describe('EvalService', () => {
  let service: EvalService;
  let mockBackendService: MockEvalBackendService;

  /**
   * Builds the injector, optionally replacing the registered scorers.
   * @param scorers The scorers to register, or none to keep the built-ins.
   */
  function setUp(scorers?: Scorer[]): EvalService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EvalService,
        StateService,
        {provide: EvalBackendService, useValue: mockBackendService},
        ...(scorers ? [{provide: SCORERS, useValue: scorers}] : []),
      ]
    });
    const evalService = TestBed.inject(EvalService);
    evalService.traceRetryDelayMs = 0;
    return evalService;
  }

  beforeEach(() => {
    mockBackendService = new MockEvalBackendService();
    service = setUp([new FakeScorer(
        AUTO_RATER_SCORER_ID, 'Auto Rater', async () => ({score: 0.9}))]);
  });

  describe('scoreAll', () => {
    it('should run every selected scorer and report them in run order',
       async () => {
         const first = new FakeScorer(
             'first', 'First', async () => ({score: 0.25}));
         const second = new FakeScorer(
             'second', 'Second', async () => ({score: 0.75}));
         const service = setUp([first, second]);

         const results = await service.scoreAll({
           query: 'q',
           response: 'r',
           golden: 'g',
           config: {...CONFIG, selectedScorers: ['first', 'second']}
         });

         expect(results).toEqual([
           {scorerId: 'first', displayName: 'First', score: 0.25},
           {scorerId: 'second', displayName: 'Second', score: 0.75},
         ]);
       });

    it('should run the scorers one after another rather than concurrently',
       async () => {
         const events: string[] = [];
         const trace = (id: string) => async () => {
           events.push(`start:${id}`);
           await new Promise(resolve => setTimeout(resolve, 0));
           events.push(`end:${id}`);
           return {score: 1};
         };
         const service = setUp([
           new FakeScorer('first', 'First', trace('first')),
           new FakeScorer('second', 'Second', trace('second')),
         ]);

         await service.scoreAll({
           query: 'q',
           response: 'r',
           golden: 'g',
           config: {...CONFIG, selectedScorers: ['first', 'second']}
         });

         expect(events).toEqual(
             ['start:first', 'end:first', 'start:second', 'end:second']);
       });

    it('should keep running the remaining scorers after one throws',
       async () => {
         const service = setUp([
           new FakeScorer(
               'broken', 'Broken',
               async () => {
                 throw new Error('scorer exploded');
               }),
           new FakeScorer('working', 'Working', async () => ({score: 0.5})),
         ]);

         const results = await service.scoreAll({
           query: 'q',
           response: 'r',
           golden: 'g',
           config: {...CONFIG, selectedScorers: ['broken', 'working']}
         });

         expect(results[0].error).toBe('scorer exploded');
         expect(results[0].score).toBe(0);
         expect(results[1].score).toBe(0.5);
         expect(results[1].error).toBeUndefined();
       });

    it('should record a readable message when a scorer rejects with a non-Error',
       async () => {
         const service = setUp([new FakeScorer(
             'broken', 'Broken',
             async () => {
               // A backend client can reject with a bare string, which has no
               // `message` to read.
               throw 'Quota Exceeded';
             })]);

         const results = await service.scoreAll({
           query: 'q',
           response: 'r',
           golden: 'g',
           config: {...CONFIG, selectedScorers: ['broken']}
         });

         expect(results[0].error).toBe('Quota Exceeded');
       });

    it('should skip a scorer that needs a golden answer when there is none',
       async () => {
         const needsGolden = new FakeScorer(
             'needs-golden', 'Needs Golden', async () => ({score: 1}), true);
         const referenceFree = new FakeScorer(
             'free', 'Reference Free', async () => ({score: 0.4}));
         const service = setUp([needsGolden, referenceFree]);

         const results = await service.scoreAll({
           query: 'q',
           response: 'r',
           config: {...CONFIG, selectedScorers: ['needs-golden', 'free']}
         });

         expect(results[0].skipped).toBeTrue();
         expect(results[0].score).toBe(0);
         expect(needsGolden.requests).toEqual([]);
         expect(results[1].score).toBe(0.4);
         expect(referenceFree.requests.length).toBe(1);
       });

    it('should fall back to the default scorer when none is selected',
       async () => {
         const first = new FakeScorer(
             'first', 'First', async () => ({score: 0.1}));
         const service = setUp([
           first,
           new FakeScorer('second', 'Second', async () => ({score: 0.2}))
         ]);

         const results = await service.scoreAll(
             {query: 'q', response: 'r', golden: 'g', config: CONFIG});

         expect(results.map(result => result.scorerId)).toEqual(['first']);
       });

    it('should ignore unknown scorer ids', async () => {
      const service = setUp([
        new FakeScorer('first', 'First', async () => ({score: 0.1}))
      ]);

      const results = await service.scoreAll({
        query: 'q',
        response: 'r',
        golden: 'g',
        config: {...CONFIG, selectedScorers: ['nope', 'first']}
      });

      expect(results.map(result => result.scorerId)).toEqual(['first']);
    });

    it('should log scorer details when a scorer returns them and stay silent otherwise',
       async () => {
         const debugSpy = spyOn(console, 'debug');
         const withDetails = new FakeScorer(
             'with-details', 'With Details',
             async () => ({
               score: 0.5,
               details: {recall: 0.6, precision: 0.4},
             }));
         const withoutDetails = new FakeScorer(
             'without-details', 'Without Details', async () => ({score: 0.8}));
         const service = setUp([withDetails, withoutDetails]);

         await service.scoreAll({
           query: 'q',
           response: 'r',
           golden: 'g',
           config: {
             ...CONFIG,
             selectedScorers: ['with-details', 'without-details'],
           },
         });

         expect(debugSpy).toHaveBeenCalledTimes(1);
         expect(debugSpy).toHaveBeenCalledWith(
             `Scorer 'with-details' details:`,
             {query: 'q', recall: 0.6, precision: 0.4});
       });

    it('should score with the built-in LCS scorer without calling the backend and log its details',
       async () => {
         const debugSpy = spyOn(console, 'debug');
         const builtInService = setUp();

         const results = await builtInService.scoreAll({
           query: 'How do I reset my password?',
           response:
               'Go to Settings and under Security you can reset the password.',
           golden: 'Reset your password in Settings under Security.',
           config: {...CONFIG, selectedScorers: [LCS_SCORER_ID]},
         });

         expect(mockBackendService.callScoreSpy).not.toHaveBeenCalled();
         expect(results).toEqual([{
           scorerId: LCS_SCORER_ID,
           displayName: 'Longest Common Subsequence',
           score: 0.33,
         }]);
         expect(debugSpy).toHaveBeenCalledWith(
             `Scorer '${LCS_SCORER_ID}' details:`, {
               query: 'How do I reset my password?',
               recall: 0.43,
               precision: 0.27,
               matchedWords: 3,
             });
       });

    it('should still record the built-in LCS score when the Auto Rater fails',
       async () => {
         const builtInService = setUp();
         mockBackendService.callScoreSpy.and.returnValue(Promise.resolve(
             new Response('', {status: 500, statusText: 'Server Error'})));

         const results = await builtInService.scoreAll({
           query: 'How do I reset my password?',
           response:
               'Go to Settings and under Security you can reset the password.',
           golden: 'Reset your password in Settings under Security.',
           config: {
             ...CONFIG,
             selectedScorers: [AUTO_RATER_SCORER_ID, LCS_SCORER_ID],
           },
         });

         expect(results.length).toBe(2);
         expect(results[0].scorerId).toBe(AUTO_RATER_SCORER_ID);
         expect(results[0].score).toBe(0);
         expect(results[0].error).toContain('HTTP error! status: 500');
         expect(results[1]).toEqual({
           scorerId: LCS_SCORER_ID,
           displayName: 'Longest Common Subsequence',
           score: 0.33,
         });
       });
  });

  describe('processRow', () => {
    /** A streamed assist response carrying a single reply. */
    function fetched(text: string): Promise<Response> {
      return Promise.resolve(new Response(JSON.stringify(
          [{answer: {replies: [{groundedContent: {content: {text}}}]}}])));
    }

    /**
     * A streamed assist response carrying one reply per given content, so a
     * test can interleave thought and answer fragments the way the API does.
     */
    function streamed(...contents: Array<Record<string, unknown>>):
        Promise<Response> {
      return Promise.resolve(new Response(JSON.stringify(contents.map(
          content => ({answer: {replies: [{groundedContent: {content}}]}})))));
    }

    it('should run against the settings it is given rather than the current ones',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(fetched('hi'));
         const getCurrentConfig =
             spyOn(service['stateService'], 'getCurrentConfig')
                 .and.returnValue({...config, selectedEngine: 'edited'});

         const result = await service.processRow(
             {query: 'q', golden: ''}, undefined, undefined,
             {...config, selectedEngine: 'pinned', selectedModel: 'm1'});

         const request = mockBackendService.callAssistSpy.calls.mostRecent().args[0];
         expect(request.selectedEngine).toBe('pinned');
         expect(request.body.generationSpec).toEqual({modelId: 'm1'});
         expect(result.engineId).toBe('pinned');
         expect(getCurrentConfig).not.toHaveBeenCalled();
       });

    it('should fall back to the current settings when none are given',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(fetched('hi'));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue({...config, selectedEngine: 'current'});

         const result = await service.processRow({query: 'q', golden: ''});

         expect(mockBackendService.callAssistSpy.calls.mostRecent()
                    .args[0].selectedEngine)
             .toBe('current');
         expect(result.engineId).toBe('current');
       });

    it('should collect the thinking trace one thought per line, keeping it out of the fetched answer',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(streamed(
             {text: '**Calculating Server Costs**\n', thought: true},
             {text: '**Summing Server Rates**\n', thought: true},
             {text: 'The total is '},
             {text: '$1093.50.'},
             ));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts)
             .toBe('**Calculating Server Costs**\n**Summing Server Rates**');
         expect(result.fetched).toBe('The total is $1093.50.');
       });

    it('should keep thoughts on their own line when they arrive after answer text',
       async () => {
         // The API documents no ordering between thought and answer replies,
         // so the trace must not depend on thoughts arriving first.
         mockBackendService.callAssistSpy.and.returnValue(streamed(
             {text: 'first ', thought: true},
             {text: 'answer'},
             {text: 'second\nwrapped', thought: true},
             ));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts).toBe('first\nsecond wrapped');
         expect(result.fetched).toBe('answer');
       });

    it('should trim and fold multiple combined newlines from the start, middle, and end of a thought',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(streamed(
             {
               text: '\n\n\n**Step 1:**\n\n\nAnalyzing   query\n\n\tdetails\n\n\n',
               thought: true,
             },
             {text: '\n\n   \n\n', thought: true},
             {
               text: '\r\n\r\n**Step 2:**\n\nSynthesizing\r\n\r\nresults\n\n',
               thought: true,
             },
             {text: 'Final answer.'},
             ));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts)
             .toBe(
                 '**Step 1:** Analyzing query details\n**Step 2:** Synthesizing results');
         expect(result.fetched).toBe('Final answer.');
       });

    it('should safely ignore non-string text values in thought and answer replies',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(streamed(
             {text: 12345, thought: true},
             {text: {unexpected: 'object'}, thought: true},
             {text: '**Valid Thought**\n', thought: true},
             {text: 67890},
             {text: 'Valid answer.'},
             ));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts).toBe('**Valid Thought**');
         expect(result.fetched).toBe('Valid answer.');
       });

    it('should set an empty thinking trace when the model emits no thoughts',
       async () => {
         // Required so the CSV export, whose header comes from the first row
         // alone, still emits the column for a run on a non-thinking model.
         mockBackendService.callAssistSpy.and.returnValue(
             streamed({text: 'answer'}));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts).toBe('');
       });

    it('should keep the thinking trace collected before a failure', async () => {
      let chunkSent = false;
      const stream = new ReadableStream({
        pull(controller) {
          if (!chunkSent) {
            chunkSent = true;
            const chunk =
                '[{"answer":{"replies":[{"groundedContent":{"content":{"text":"**Analyzing Request**\\n","thought":true}}}]}}';
            controller.enqueue(new TextEncoder().encode(chunk));
          } else {
            controller.error(new Error('Stream disconnected'));
          }
        }
      });
      mockBackendService.callAssistSpy.and.returnValue(
          Promise.resolve(new Response(stream)));
      spyOn(service['stateService'], 'getCurrentConfig')
          .and.returnValue(config);

      const result = await service.processRow({query: 'q', golden: 'g'});

      expect(result.thoughts).toBe('**Analyzing Request**');
      expect(result.fetched).toContain('Error:');
    });

    it('should initialize an empty thinking trace when HTTP request fails immediately',
       async () => {
         mockBackendService.callAssistSpy.and.returnValue(
             Promise.resolve(new Response('', {status: 500})));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.thoughts).toBe('');
         expect(result.fetched).toContain('Error:');
       });

    it('should preserve the fetched text if scoring throws an error',
       async () => {
         const service = setUp([new FakeScorer(
             AUTO_RATER_SCORER_ID, 'Auto Rater', async () => {
               throw new Error('HTTP error! status: 500');
             })]);
         mockBackendService.callAssistSpy.and.returnValue(
             fetched('Fetched response text'));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(CONFIG);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(result.fetched).toBe('Fetched response text');
         expect(result.scorerResults).toEqual([{
           scorerId: AUTO_RATER_SCORER_ID,
           displayName: 'Auto Rater',
           score: 0,
           error: 'HTTP error! status: 500'
         }]);
       });

    it('should record every scorer on the row', async () => {
      const service = setUp([
        new FakeScorer('first', 'First', async () => ({score: 0.25})),
        new FakeScorer('second', 'Second', async () => ({score: 0.75})),
      ]);
      mockBackendService.callAssistSpy.and.returnValue(fetched('answer'));
      spyOn(service['stateService'], 'getCurrentConfig')
          .and.returnValue({...CONFIG, selectedScorers: ['first', 'second']});

      const result = await service.processRow({query: 'q', golden: 'g'});

      expect(result.scorerResults).toEqual([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {scorerId: 'second', displayName: 'Second', score: 0.75},
      ]);
    });

    it('should keep the other scores when one scorer fails', async () => {
      const service = setUp([
        new FakeScorer('first', 'First', async () => ({score: 0.25})),
        new FakeScorer(
            'second', 'Second',
            async () => {
              throw new Error('quota exceeded');
            }),
      ]);
      mockBackendService.callAssistSpy.and.returnValue(fetched('answer'));
      spyOn(service['stateService'], 'getCurrentConfig')
          .and.returnValue({...CONFIG, selectedScorers: ['first', 'second']});

      const result = await service.processRow({query: 'q', golden: 'g'});

      expect(result.scorerResults).toEqual([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {
          scorerId: 'second',
          displayName: 'Second',
          score: 0,
          error: 'quota exceeded'
        },
      ]);
    });

    it('should record no scores when the response cannot be fetched',
       async () => {
         const service = setUp([new FakeScorer(
             AUTO_RATER_SCORER_ID, 'Auto Rater', async () => ({score: 1}))]);
         mockBackendService.callAssistSpy.and.returnValue(
             Promise.resolve(new Response('', {status: 500})));
         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(CONFIG);

         const result = await service.processRow({query: 'q', golden: 'g'});

         expect(result.fetched).toContain('HTTP error! status: 500');
         expect(result.scorerResults).toEqual([]);
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
      expect(result.scorerResults[0].score).toBe(0.9);
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

    it('should construct traceUrl when assistToken is returned and fetchTraceId succeeds',
       async () => {
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(JSON.stringify([{
               assistToken: 'my-assist-token-123',
               answer: {
                 replies: [{
                   groundedContent:
                       {content: {text: 'Response from assist'}}
                 }]
               }
             }])));
         mockBackendService.callScoreSpy.and.resolveTo(
             new Response(JSON.stringify({
               candidates: [{content: {parts: [{text: '0.9'}]}}],
             })));
         mockBackendService.fetchTraceIdSpy.and.resolveTo(
             '0123456789abcdef0123456789abcdef');

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(mockBackendService.fetchTraceIdSpy)
             .toHaveBeenCalledWith('project', 'my-assist-token-123');
         expect(result.traceId).toBe('0123456789abcdef0123456789abcdef');
         expect(result.traceUrl)
             .toBe(
                 'https://console.cloud.google.com/traces/explorer;traceId=0123456789abcdef0123456789abcdef;duration=P30D?project=project');
       });

    it('should retry fetchTraceId and construct traceUrl when traceId is resolved on a subsequent attempt',
       async () => {
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(JSON.stringify([{
               assistToken: 'my-assist-token-123',
               answer: {
                 replies: [
                   {groundedContent: {content: {text: 'Response from assist'}}}
                 ]
               }
             }])));
         mockBackendService.callScoreSpy.and.resolveTo(
             new Response(JSON.stringify({
               candidates: [{content: {parts: [{text: '0.9'}]}}],
             })));
         let calls = 0;
         mockBackendService.fetchTraceIdSpy.and.callFake(async () => {
           calls++;
           return calls === 3 ? '0123456789abcdef0123456789abcdef' : undefined;
         });

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(calls).toBe(3);
         expect(result.traceId).toBe('0123456789abcdef0123456789abcdef');
         expect(result.traceUrl)
             .toBe(
                 'https://console.cloud.google.com/traces/explorer;traceId=0123456789abcdef0123456789abcdef;duration=P30D?project=project');
       });

    it('should URL-encode traceId and trimmed projectId in traceUrl',
       async () => {
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(JSON.stringify([{
               assistToken: 'my-assist-token-123',
               answer: {
                 replies: [
                   {groundedContent: {content: {text: 'Response from assist'}}}
                 ]
               }
             }])));
         mockBackendService.callScoreSpy.and.resolveTo(
             new Response(JSON.stringify({
               candidates: [{content: {parts: [{text: '0.9'}]}}],
             })));
         mockBackendService.fetchTraceIdSpy.and.resolveTo(
             'trace/id?with=special&chars');

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue({...config, projectId: '  my-org:my-project  '});

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(result.traceUrl)
             .toBe(
                 'https://console.cloud.google.com/traces/explorer;traceId=trace%2Fid%3Fwith%3Dspecial%26chars;duration=P30D?project=my-org%3Amy-project');
       });

    it('should return undefined traceUrl when fetchTraceId returns undefined after retries',
       async () => {
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(JSON.stringify([{
               assistToken: 'my-assist-token-123',
               answer: {
                 replies: [
                   {groundedContent: {content: {text: 'Response from assist'}}}
                 ]
               }
             }])));
         mockBackendService.callScoreSpy.and.resolveTo(
             new Response(JSON.stringify({
               candidates: [{content: {parts: [{text: '0.9'}]}}],
             })));
         mockBackendService.fetchTraceIdSpy.and.resolveTo(undefined);

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(mockBackendService.fetchTraceIdSpy)
             .toHaveBeenCalledTimes(service.traceRetryMaxAttempts);
         expect(result.traceId).toBeUndefined();
         expect(result.traceUrl).toBeUndefined();
       });

    it('should fail fast without retrying and preserve fetched text and score when fetchTraceId rejects',
       async () => {
         const service = setUp([new FakeScorer(
             AUTO_RATER_SCORER_ID, 'Auto Rater', async () => ({score: 0.95}))]);
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(JSON.stringify([{
               assistToken: 'my-assist-token-123',
               answer: {
                 replies: [
                   {groundedContent: {content: {text: 'Response from assist'}}}
                 ]
               }
             }])));
         mockBackendService.fetchTraceIdSpy.and.rejectWith(
             new Error('Failed to fetch trace ID: HTTP 403'));

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(result.fetched).toBe('Response from assist');
         expect(result.scorerResults[0].score).toBe(0.95);
         expect(mockBackendService.fetchTraceIdSpy).toHaveBeenCalledTimes(1);
         expect(result.traceId).toBeUndefined();
         expect(result.traceUrl).toBeUndefined();
       });

    it('should attempt fetchTraceId at most once without polling when callAssist fails with 429',
       async () => {
         mockBackendService.callAssistSpy.and.resolveTo(
             new Response(
                 JSON.stringify({
                   details: [{
                     assistToken: 'rate-limited-token',
                     reason: 'Quota exceeded',
                   }],
                 }),
                 {status: 429}));
         mockBackendService.fetchTraceIdSpy.and.resolveTo(undefined);

         spyOn(service['stateService'], 'getCurrentConfig')
             .and.returnValue(config);

         const result =
             await service.processRow({query: 'my query', golden: 'my golden'});

         expect(result.fetched).toContain('Rate limited: Quota exceeded');
         expect(mockBackendService.fetchTraceIdSpy).toHaveBeenCalledTimes(1);
       });

    it('should handle gracefully when assist token is missing', async () => {
      mockBackendService.callAssistSpy.and.resolveTo(
          new Response(JSON.stringify([{
            answer: {
              replies:
                  [{groundedContent: {content: {text: 'Response from assist'}}}],
            },
          }])));

      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);

      const result =
          await service.processRow({query: 'my query', golden: 'my golden'});

      expect(result.traceId).toBeUndefined();
      expect(result.traceUrl).toBeUndefined();
    });

    it('should throw an error when projectId is empty', async () => {
      spyOn(service['stateService'], 'getCurrentConfig')
          .and.returnValue({...config, projectId: '   '});

      await expectAsync(
          service.processRow({query: 'my query', golden: 'my golden'}))
          .toBeRejectedWithError('Project ID is required.');
    });
  });

  describe('processRow session handling', () => {
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

    beforeEach(() => {
      spyOn(service['stateService'], 'getCurrentConfig').and.returnValue(config);
    });

    it('should omit the session field entirely for a standalone query (no session)', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {replies: [{groundedContent: {content: {text: 'hi'}}}]}
      }]))));

      await service.processRow({query: 'q', golden: ''});

      const request = mockBackendService.callAssistSpy.calls.mostRecent().args[0];
      expect(request.body.session).toBeUndefined();
      // isSessionLess is not recognized by the v1 streamAssist REST surface
      // ("Unknown name \"isSessionLess\"": 400) and must never be sent.
      expect(request.body.isSessionLess).toBeUndefined();
    });

    it('should thread a given session into the request', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {replies: [{groundedContent: {content: {text: 'hi'}}}]}
      }]))));

      await service.processRow(
          {query: 'q', golden: ''}, undefined,
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');

      const request = mockBackendService.callAssistSpy.calls.mostRecent().args[0];
      expect(request.body.session).toBe(
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');
    });

    it('should capture sessionInfo from the response so the caller can continue the conversation', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([{
        answer: {replies: [{groundedContent: {content: {text: 'hi'}}}]},
        sessionInfo: {
          session: 'projects/p/locations/global/collections/default_collection/engines/e/sessions/123',
          turnId: 'turn-1'
        }
      }]))));

      const result = await service.processRow({query: 'q', golden: ''});

      expect(result.session).toBe(
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');
      expect(result.turnId).toBe('turn-1');
    });

    it('should accumulate session and turnId across separate stream chunks', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response(JSON.stringify([
        {
          answer: {replies: [{groundedContent: {content: {text: 'hi '}}}]},
          sessionInfo: {
            session: 'projects/p/locations/global/collections/default_collection/engines/e/sessions/123'
          }
        },
        {
          answer: {replies: [{groundedContent: {content: {text: 'there'}}}]},
          sessionInfo: {
            turnId: 'turn-1'
          }
        }
      ]))));

      const result = await service.processRow({query: 'q', golden: ''});

      expect(result.session).toBe(
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');
      expect(result.turnId).toBe('turn-1');
    });

    it('should preserve session when stream omits sessionInfo or when an error occurs', async () => {
      mockBackendService.callAssistSpy.and.returnValue(Promise.resolve(new Response('', {
        status: 500,
        statusText: 'Internal Server Error'
      })));

      const result = await service.processRow(
          {query: 'follow up', golden: ''},
          undefined,
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');

      expect(result.session).toBe(
          'projects/p/locations/global/collections/default_collection/engines/e/sessions/123');
    });
  });
});
