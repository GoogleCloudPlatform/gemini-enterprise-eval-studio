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

import {findScoreColumns, scoreColumnHeader, scoreErrorColumnHeader} from './score-columns';

describe('score columns', () => {
  it('should name the columns after the scorer', () => {
    expect(scoreColumnHeader('Auto Rater')).toBe('Auto Rater Score');
    expect(scoreErrorColumnHeader('Auto Rater')).toBe('Auto Rater Error');
  });

  it('should read back the score columns it names', () => {
    const headers = [
      'Query',
      scoreColumnHeader('First'),
      scoreErrorColumnHeader('First'),
      scoreColumnHeader('Second'),
      'Trace',
    ];

    expect(findScoreColumns(headers)).toEqual([
      {scorer: 'First', header: 'First Score'},
      {scorer: 'Second', header: 'Second Score'},
    ]);
  });

  it('should match score columns regardless of case', () => {
    expect(findScoreColumns(['auto rater score'])).toEqual([
      {scorer: 'auto rater', header: 'auto rater score'},
    ]);
  });

  it('should ignore a bare Score column that names no scorer', () => {
    expect(findScoreColumns(['Score', ' Score'])).toEqual([]);
  });
});
