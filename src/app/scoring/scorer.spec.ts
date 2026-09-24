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

import {ScorerRunResult, firstScorerError} from './scorer';

/** Builds a scorer outcome with the given overrides. */
function run(
    partial: Partial<ScorerRunResult>&{scorerId: string}): ScorerRunResult {
  return {
    displayName: partial.scorerId.toUpperCase(),
    score: 0,
    ...partial
  };
}

describe('firstScorerError', () => {
  it('should return undefined when every scorer succeeded', () => {
    expect(firstScorerError([
      run({scorerId: 'first', score: 0.25}),
      run({scorerId: 'second', score: 0.75}),
    ])).toBeUndefined();
  });

  it('should report a lone scorer error unchanged', () => {
    expect(firstScorerError(
               [run({scorerId: 'only', displayName: 'Only', error: 'boom'})]))
        .toBe('boom');
  });

  it('should name the failing scorer when several ran', () => {
    expect(firstScorerError([
      run({scorerId: 'first', score: 0.5}),
      run({scorerId: 'second', displayName: 'Second', error: 'boom'}),
    ])).toBe('Second: boom');
  });

  it('should report the first failure when several scorers fail', () => {
    expect(firstScorerError([
      run({scorerId: 'first', displayName: 'First', error: 'first boom'}),
      run({scorerId: 'second', displayName: 'Second', error: 'second boom'}),
    ])).toBe('First: first boom');
  });

  it('should tolerate an empty run', () => {
    expect(firstScorerError([])).toBeUndefined();
  });
});
