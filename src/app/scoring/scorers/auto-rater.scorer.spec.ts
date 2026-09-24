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

import {AppConfig} from '../../models/app-config.model';
import {EvalBackendService} from '../../services/eval-backend.service';
import {MockEvalBackendService} from '../../testing/mocks';

import {AutoRaterScorer, MIN_AUTO_RATER_INSTRUCTION_LENGTH} from './auto-rater.scorer';

const CONFIG: AppConfig = {
  gCloudToken: 'token',
  projectId: 'project',
  region: 'global',
  selectedEngine: 'engine',
  selectedModel: 'model',
  autoRaterModel: 'gemini-3.5-flash',
  autoRaterInstruction: 'Rate the response against the golden answer.',
  selectedDataStores: [],
  enableWebSearch: false
};

/** Builds a successful auto rater response carrying the given raw text. */
function ratedWith(text: string): Promise<Response> {
  return Promise.resolve(new Response(
      JSON.stringify({candidates: [{content: {parts: [{text}]}}]})));
}

describe('AutoRaterScorer', () => {
  let scorer: AutoRaterScorer;
  let backend: MockEvalBackendService;

  beforeEach(() => {
    backend = new MockEvalBackendService();
    TestBed.configureTestingModule({
      providers: [{provide: EvalBackendService, useValue: backend}],
    });
    scorer = TestBed.inject(AutoRaterScorer);
  });

  /** Makes the next scoring call resolve with the given response. */
  function respondWith(response: Promise<Response>) {
    backend.callScoreSpy.and.returnValue(response);
  }

  /** Scores a fixed query/response pair with the default config. */
  async function score(config: AppConfig = CONFIG): Promise<number> {
    const result = await scorer.score(
        {query: 'query', response: 'response', golden: 'golden', config});
    return result.score;
  }

  describe('score parsing', () => {
    it('should parse a clean float score', async () => {
      respondWith(ratedWith('0.85'));

      expect(await score()).toBe(0.85);
    });

    it('should parse a score wrapped in markdown fences', async () => {
      respondWith(ratedWith('```\n0.85\n```'));

      expect(await score()).toBe(0.85);
    });

    it('should parse a score with conversational text', async () => {
      respondWith(ratedWith('The semantic similarity score is 0.9.'));

      expect(await score()).toBe(0.9);
    });

    it('should parse score with prefix', async () => {
      respondWith(ratedWith('Score: 0.75'));

      expect(await score()).toBe(0.75);
    });

    it('should parse score with filler before the prefix', async () => {
      respondWith(ratedWith('Here is my evaluation:\nScore: 0.75'));

      expect(await score()).toBe(0.75);
    });

    it('should parse score when range instruction 0.0-1.0 is mentioned at the end',
       async () => {
         respondWith(
             ratedWith('The score is 0.85, which is between 0.0 and 1.0.'));

         expect(await score()).toBe(0.85);
       });

    it('should parse score with scale suffix', async () => {
      respondWith(ratedWith('0.85 (scale 0-1)'));

      expect(await score()).toBe(0.85);
    });

    it('should parse score with fraction suffix', async () => {
      respondWith(ratedWith('0.85/1.0'));

      expect(await score()).toBe(0.85);
    });

    it('should parse score with "out of" suffix', async () => {
      respondWith(ratedWith('0.85 out of 1'));

      expect(await score()).toBe(0.85);
    });

    it('should reject an answer holding no number', async () => {
      respondWith(ratedWith('I cannot rate this response.'));

      // A parse failure is an evaluation error, not a score of 0.
      await expectAsync(score()).toBeRejectedWithError(
          /Failed to parse a numeric score/);
    });

    it('should reject an empty answer', async () => {
      respondWith(Promise.resolve(new Response(JSON.stringify({}))));

      await expectAsync(score()).toBeRejectedWithError(
          /Failed to parse a numeric score/);
    });
  });

  describe('error handling', () => {
    it('should throw an error if the response is not ok', async () => {
      respondWith(Promise.resolve(
          new Response('', {status: 500, statusText: 'Internal Server Error'})));

      await expectAsync(score()).toBeRejectedWithError(
          /HTTP error! status: 500/);
    });

    it('should throw detailed error message from JSON response if available',
       async () => {
         const errorResponse = {error: {message: 'Detailed error from API'}};
         respondWith(Promise.resolve(new Response(
             JSON.stringify(errorResponse),
             {status: 400, statusText: 'Bad Request'})));

         await expectAsync(score()).toBeRejectedWithError(
             'Detailed error from API');
       });

    it('should throw permission denied error for 403 status if JSON parsing fails',
       async () => {
         respondWith(Promise.resolve(
             new Response('Not JSON', {status: 403, statusText: 'Forbidden'})));

         await expectAsync(score()).toBeRejectedWithError(
             'Permission denied. Please check your Google Cloud access token.');
       });
  });

  describe('backend request', () => {
    it('should score through the backend service rather than calling the model directly',
       async () => {
         const fetchSpy = spyOn(globalThis, 'fetch');
         respondWith(ratedWith('0.85'));

         await score();

         expect(backend.callScoreSpy).toHaveBeenCalled();
         expect(fetchSpy).not.toHaveBeenCalled();
       });

    it('should ask for the project and region the evaluation runs in',
       async () => {
         respondWith(ratedWith('0.85'));

         await score({...CONFIG, projectId: 'my-project', region: 'us-central1'});

         expect(backend.callScoreSpy)
             .toHaveBeenCalledWith(jasmine.objectContaining(
                 {projectId: 'my-project', region: 'us-central1'}));
       });

    it('should score with autoRaterModel regardless of selectedModel',
       async () => {
         respondWith(ratedWith('0.85'));

         await score({
           ...CONFIG,
           selectedModel: 'some-other-model',
           autoRaterModel: 'my-custom-model'
         });

         expect(backend.callScoreSpy)
             .toHaveBeenCalledWith(
                 jasmine.objectContaining({model: 'my-custom-model'}));
       });

    it('should prompt with the configured instruction', async () => {
      respondWith(ratedWith('0.85'));

      await score();

      const {body} = backend.callScoreSpy.calls.mostRecent().args[0];
      expect(body.contents[0].parts[0].text)
          .toContain(CONFIG.autoRaterInstruction);
    });
  });

  describe('configuration', () => {
    it('should require a golden answer', () => {
      expect(scorer.requiresGolden).toBeTrue();
    });

    it('should reject a config without an auto rater model', () => {
      expect(scorer.validate({...CONFIG, autoRaterModel: ''})).toBeTruthy();
      expect(scorer.validate(CONFIG)).toBeUndefined();
    });

    it('should reject a missing or blank instruction', () => {
      expect(scorer.validate({...CONFIG, autoRaterInstruction: ''}))
          .toContain('instruction');
      expect(scorer.validate({...CONFIG, autoRaterInstruction: ' '.repeat(40)}))
          .toContain('instruction');
    });

    it('should enforce the minimum instruction length', () => {
      const atLimit = 'x'.repeat(MIN_AUTO_RATER_INSTRUCTION_LENGTH);

      expect(scorer.validate({...CONFIG, autoRaterInstruction: atLimit.slice(1)}))
          .toContain('instruction');
      expect(scorer.validate({...CONFIG, autoRaterInstruction: atLimit}))
          .toBeUndefined();
    });

    it('should report the missing model before the instruction', () => {
      expect(scorer.validate(
                 {...CONFIG, autoRaterModel: '', autoRaterInstruction: ''}))
          .toBe('Select an auto rater model.');
    });
  });
});
