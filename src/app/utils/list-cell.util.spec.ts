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

import {parseListCell} from './list-cell.util';

describe('parseListCell', () => {
  it('returns undefined for a missing cell', () => {
    expect(parseListCell(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty cell', () => {
    expect(parseListCell('')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only cell', () => {
    expect(parseListCell('   ')).toBeUndefined();
  });

  it('returns a single entry when there is no separator', () => {
    expect(parseListCell('jira-connector')).toEqual(['jira-connector']);
  });

  it('splits entries on semicolons', () => {
    expect(parseListCell('jira-connector;web_search')).toEqual([
      'jira-connector', 'web_search'
    ]);
  });

  it('trims entries and drops empty ones', () => {
    expect(parseListCell(' jira-connector ; ;web_search; ')).toEqual([
      'jira-connector', 'web_search'
    ]);
  });

  it('returns undefined when the cell only holds separators', () => {
    expect(parseListCell(' ; ; ')).toBeUndefined();
    expect(parseListCell(';')).toBeUndefined();
  });

  it('keeps spaces inside an entry', () => {
    expect(parseListCell('Google Calendar;Runbook v2')).toEqual([
      'Google Calendar', 'Runbook v2'
    ]);
  });

  it('does not split on commas or pipes', () => {
    expect(parseListCell('a,b|c')).toEqual(['a,b|c']);
  });

  it('keeps each repeated entry once, in first-seen order', () => {
    expect(parseListCell('jira;web_search; jira ;web_search')).toEqual([
      'jira', 'web_search'
    ]);
  });

  it('does not split on line breaks', () => {
    expect(parseListCell('jira\nconfluence')).toEqual(['jira\nconfluence']);
    expect(parseListCell('jira\r\nconfluence;web_search')).toEqual([
      'jira\r\nconfluence', 'web_search'
    ]);
  });

  it('reads malformed input as-is', () => {
    expect(parseListCell('["jira-connector";web_search')).toEqual([
      '["jira-connector"', 'web_search'
    ]);
  });
});
