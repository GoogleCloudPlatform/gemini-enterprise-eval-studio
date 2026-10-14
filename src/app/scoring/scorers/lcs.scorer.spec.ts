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
import {ScoreResult} from '../scorer';

import {LCS_SCORER_ID, LcsScorer, MAX_LCS_WORDS, longestCommonSubsequenceLength, tokenizeWords} from './lcs.scorer';

const CONFIG: AppConfig = {
  gCloudToken: '',
  projectId: '',
  region: 'global',
  selectedEngine: '',
  selectedModel: '',
  autoRaterModel: '',
  autoRaterInstruction: '',
  selectedDataStores: [],
  enableWebSearch: false,
};

describe('LcsScorer', () => {
  let scorer: LcsScorer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    scorer = TestBed.inject(LcsScorer);
  });

  /** Scores a golden/response pair with the default config. */
  function scorePair(
      golden: string|undefined, response: string): Promise<ScoreResult> {
    return scorer.score({
      query: 'How do I reset my password?',
      response,
      golden,
      config: CONFIG,
    });
  }

  describe('PRD examples', () => {
    it('should compute the worked example score, recall, precision, and matchedWords',
       async () => {
         // In Golden: ["reset", "your", "password", "in", "settings", "under", "security"] (7 words)
         // In Response: ["go", "to", "settings", "and", "under", "security", "you", "can", "reset", "the", "password"] (11 words)
         // Since "password" precedes "settings" in Golden but follows "security" in Response,
         // the longest common subsequence in order is ["settings", "under", "security"] (3 words).
         const result = await scorePair(
             'Reset your password in Settings under Security.',
             'Go to Settings and under Security you can reset the password.');

         expect(result).toEqual({
           score: 0.33,
           details: {
             recall: 0.43,
             precision: 0.27,
             matchedWords: 3,
           },
         });
       });

    it('should compute 0.44 (recall 0.57, precision 0.36) when 4 of 7 golden words match an 11-word response in order',
       async () => {
         // Matched subsequence in order: ["settings", "under", "security", "password"] (4 words).
         const result = await scorePair(
             'Find Settings under Security to change password.',
             'Go to Settings and under Security you can reset the password.');

         expect(result).toEqual({
           score: 0.44,
           details: {
             recall: 0.57,
             precision: 0.36,
             matchedWords: 4,
           },
         });
       });

    it('should score an exact match as 1.0', async () => {
      const result = await scorePair(
          'The order ships in two business days.',
          'The order ships in two business days.');

      expect(result).toEqual({
        score: 1,
        details: {
          recall: 1,
          precision: 1,
          matchedWords: 7,
        },
      });
    });

    it('should score a detailed answer containing all golden words in order as 0.70',
       async () => {
         const result = await scorePair(
             'The order ships in two business days.',
             'Once confirmed, the order usually ships in about two business days via ground.');

         expect(result).toEqual({
           score: 0.7,
           details: {
             recall: 1,
             precision: 0.54,
             matchedWords: 7,
           },
         });
       });

    it('should penalize reordered clauses when words appear out of sequence (0.43)',
       async () => {
         const result = await scorePair(
             'Reset your password in Settings under Security.',
             'Under Security in Settings, reset your password.');

         expect(result).toEqual({
           score: 0.43,
           details: {
             recall: 0.43,
             precision: 0.43,
             matchedWords: 3,
           },
         });
       });

    it('should score an unrelated answer with no shared words as 0.0',
       async () => {
         const result = await scorePair(
             'Reset your password in Settings under Security.',
             'Please contact billing support for invoice questions.');

         expect(result).toEqual({
           score: 0,
           details: {
             recall: 0,
             precision: 0,
             matchedWords: 0,
           },
         });
       });
  });

  describe('normalization rules', () => {
    it('should ignore case differences', async () => {
      const result = await scorePair(
          'RESET YOUR PASSWORD IN SETTINGS', 'reset your password in settings');

      expect(result.score).toBe(1);
    });

    it('should strip punctuation so trailing periods, commas, or quotes do not split words',
       async () => {
         const result = await scorePair(
             '"Hello, world!" (test).', 'hello world test');

         expect(result.score).toBe(1);
         expect(result.details?.['matchedWords']).toBe(3);
       });

    it('should keep contractions intact while splitting hyphen, slash, and em-dash separated words',
       async () => {
         expect(tokenizeWords(`don't won\u2019t word-order yes/no first—second`))
             .toEqual([
               'dont',
               'wont',
               'word',
               'order',
               'yes',
               'no',
               'first',
               'second',
             ]);

         const result = await scorePair(
             `Don't change word-order or yes/no—first—second.`,
             `dont change word order or yes no first second`);

         expect(result.score).toBe(1);
         expect(result.details?.['matchedWords']).toBe(9);
       });

    it('should collapse repeated spaces, tabs, and newlines into single word boundaries',
       async () => {
         const result = await scorePair(
             'first   second\t\tthird\n\nfourth',
             'first second third fourth');

         expect(result.score).toBe(1);
         expect(result.details?.['matchedWords']).toBe(4);
       });

    it('should decompose Unicode NFD accents and strip diacritical marks',
       async () => {
         const result = await scorePair(
             'Le café résumé naïve', 'le cafe resume naive');

         expect(result.score).toBe(1);
         expect(result.details?.['matchedWords']).toBe(4);
       });
  });

  describe('divide-by-zero guard and edge cases', () => {
    it('should return 0 for an empty response', async () => {
      const result = await scorePair('Golden answer', '');

      expect(result).toEqual({
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      });
    });

    it('should return 0 for an empty or undefined golden answer', async () => {
      expect(await scorePair('', 'Fetched response')).toEqual({
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      });
      expect(await scorePair(undefined, 'Fetched response')).toEqual({
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      });
    });

    it('should return 0 when both golden and response are empty', async () => {
      const result = await scorePair('', '');

      expect(result).toEqual({
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      });
    });

    it('should return 0 for punctuation-only strings without dividing by zero',
       async () => {
         expect(await scorePair('...', 'Valid response')).toEqual({
           score: 0,
           details: {recall: 0, precision: 0, matchedWords: 0},
         });
         expect(await scorePair('Valid golden', '   ... !?! ---   ')).toEqual({
           score: 0,
           details: {recall: 0, precision: 0, matchedWords: 0},
         });
         expect(await scorePair('...', '!!!')).toEqual({
           score: 0,
           details: {recall: 0, precision: 0, matchedWords: 0},
         });
       });

    it('should score single-word matches and mismatches', async () => {
      expect((await scorePair('yes', 'Yes!')).score).toBe(1);
      expect((await scorePair('yes', 'no')).score).toBe(0);
    });

    it('should count duplicate words only up to their occurrences in both sequences',
       async () => {
         const result = await scorePair(
             'the cat sat on the mat', 'the the the');

         // 'the' appears twice in golden and three times in response -> 2 matches.
         // recall = 2/6 = 0.333..., precision = 2/3 = 0.666..., F1 = 4/9 = 0.44
         expect(result).toEqual({
           score: 0.44,
           details: {
             recall: 0.33,
             precision: 0.67,
             matchedWords: 2,
           },
         });
       });
  });

  describe('long input cap', () => {
    it('should truncate inputs exceeding MAX_LCS_WORDS (10,000 words)', () => {
      const longText =
          Array.from({length: MAX_LCS_WORDS + 500}, (_, i) => `word${i}`)
              .join(' ');
      const tokens = tokenizeWords(longText);

      expect(tokens.length).toBe(MAX_LCS_WORDS);
      expect(tokens[0]).toBe('word0');
      expect(tokens[MAX_LCS_WORDS - 1]).toBe(`word${MAX_LCS_WORDS - 1}`);
    });

    it('should ignore words beyond the 10,000-word cap when scoring',
       async () => {
         const prefix = Array.from({length: MAX_LCS_WORDS}, () => 'alpha').join(' ');
         const golden = `${prefix} trailingunique`;
         const response = `${prefix} differenttrailing`;

         const result = await scorePair(golden, response);

         expect(result.score).toBe(1);
         expect(result.details?.['matchedWords']).toBe(MAX_LCS_WORDS);
       });
  });

  describe('determinism and statelessness', () => {
    it('should return identical results across 100 repeated calls on the same input',
       async () => {
         const golden = 'Reset your password in Settings under Security.';
         const response =
             'Go to Settings and under Security you can reset the password.';

         const baseline = await scorePair(golden, response);
         for (let i = 0; i < 100; i++) {
           expect(await scorePair(golden, response)).toEqual(baseline);
         }
       });

    it('should not leak state across interleaved calls with different inputs',
       async () => {
         const [r1, r2, r3] = await Promise.all([
           scorePair('alpha beta gamma', 'alpha beta gamma'),
           scorePair('alpha beta gamma', 'delta epsilon'),
           scorePair('alpha beta gamma', 'alpha gamma'),
         ]);

         expect(r1.score).toBe(1);
         expect(r2.score).toBe(0);
         expect(r3.score).toBe(0.8);
       });

    it('should never invoke global fetch', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch');

      await scorePair('golden text', 'response text');

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('scorer contract metadata', () => {
    it('should expose stable id, displayName, golden requirement, and empty configKeys',
       () => {
         expect(scorer.id).toBe(LCS_SCORER_ID);
         expect(scorer.displayName).toBe('Longest Common Subsequence');
         expect(scorer.description).toBeTruthy();
         expect(scorer.requiresGolden).toBeTrue();
         expect(scorer.configKeys).toEqual([]);
       });

    it('should validate any configuration without requiring an auto-rater model or instruction',
       () => {
         expect(scorer.validate(CONFIG)).toBeUndefined();
       });
  });

  describe('longestCommonSubsequenceLength', () => {
    it('should return the same length regardless of argument order', () => {
      const short = ['a', 'b', 'c'];
      const long = ['x', 'a', 'y', 'b', 'z', 'c', 'w'];

      expect(longestCommonSubsequenceLength(short, long)).toBe(3);
      expect(longestCommonSubsequenceLength(long, short)).toBe(3);
    });
  });
});
