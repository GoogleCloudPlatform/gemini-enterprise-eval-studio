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

import {CSVRow, extraColumns} from './csv-row.model';

describe('extraColumns', () => {
  it('should keep only the columns Eval Studio does not interpret', () => {
    expect(extraColumns({
      query: 'q',
      golden: 'g',
      conversationId: 'c',
      turn: '1',
      expected_sources: 'dataStores:jira-prod',
      owner: '',
    })).toEqual({expected_sources: 'dataStores:jira-prod', owner: ''});
  });

  it('should drop values that are not strings', () => {
    // Papa Parse adds `__parsed_extra` as a list for a line with more fields
    // than headers.
    const row = {
      query: 'q',
      golden: 'g',
      expected_sources: 'sources:Runbook',
      __parsed_extra: ['stray', 'fields'],
    } as unknown as CSVRow;

    expect(extraColumns(row)).toEqual({expected_sources: 'sources:Runbook'});
  });

  it('should return nothing for a row with only known columns', () => {
    expect(extraColumns({query: 'q', golden: 'g'})).toEqual({});
  });
});
