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

import {Injectable} from '@angular/core';

import {AppConfig} from '../../models/app-config.model';
import {ScoreResult, Scorer, ScoringRequest} from '../scorer';

/** Identifier of the deterministic Longest Common Subsequence scorer. */
export const LCS_SCORER_ID = 'lcs';

/**
 * Maximum number of words compared per input so deeply verbose outputs do not
 * freeze the browser UI.
 */
export const MAX_LCS_WORDS = 10_000;

/**
 * Normalizes text and splits it into at most `MAX_LCS_WORDS` word tokens.
 */
export function tokenizeWords(text: string): string[] {
  const normalized = text.normalize('NFD')
                         .replace(/[\u0300-\u036f]/g, '')
                         .toLowerCase()
                         .replace(/['\u2019]+/g, '')
                         .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
                         .trim();
  if (!normalized) {
    return [];
  }
  return normalized.split(/\s+/).slice(0, MAX_LCS_WORDS);
}

/**
 * Computes the length of the longest common word subsequence between two
 * tokenized word arrays using space-optimized 1D dynamic programming.
 */
export function longestCommonSubsequenceLength(
    first: readonly string[], second: readonly string[]): number {
  if (first.length === 0 || second.length === 0) {
    return 0;
  }

  const [outer, inner] =
      first.length >= second.length ? [first, second] : [second, first];
  const dp = new Int32Array(inner.length + 1);

  for (let i = 0; i < outer.length; i++) {
    const outerWord = outer[i];
    let prevDiagonal = 0;
    for (let j = 0; j < inner.length; j++) {
      const temp = dp[j + 1];
      if (outerWord === inner[j]) {
        dp[j + 1] = prevDiagonal + 1;
      } else if (dp[j] > dp[j + 1]) {
        dp[j + 1] = dp[j];
      }
      prevDiagonal = temp;
    }
  }

  return dp[inner.length];
}

function roundTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Scores a response deterministically in the browser using word-level Longest
 * Common Subsequence (ROUGE-L F1) against the golden answer.
 */
@Injectable({providedIn: 'root'})
export class LcsScorer extends Scorer {
  readonly id = LCS_SCORER_ID;
  readonly displayName = 'Longest Common Subsequence';
  override readonly description =
      'Measures word-order overlap (ROUGE-L F1) between the response and the golden answer.';
  override readonly requiresGolden = true;
  override readonly configKeys: ReadonlyArray<keyof AppConfig> = [];

  async score({response, golden}: ScoringRequest): Promise<ScoreResult> {
    const goldenWords = tokenizeWords(golden ?? '');
    const responseWords = tokenizeWords(response ?? '');

    // Divide-by-zero guard: if either normalized text has 0 words (empty or
    // punctuation-only), immediately return 0.
    if (goldenWords.length === 0 || responseWords.length === 0) {
      return {
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      };
    }

    const matchedWords =
        longestCommonSubsequenceLength(goldenWords, responseWords);
    if (matchedWords === 0) {
      return {
        score: 0,
        details: {recall: 0, precision: 0, matchedWords: 0},
      };
    }

    const recall = matchedWords / goldenWords.length;
    const precision = matchedWords / responseWords.length;
    const f1 = (2 * recall * precision) / (recall + precision);

    return {
      score: roundTwoDecimals(f1),
      details: {
        recall: roundTwoDecimals(recall),
        precision: roundTwoDecimals(precision),
        matchedWords,
      },
    };
  }
}
