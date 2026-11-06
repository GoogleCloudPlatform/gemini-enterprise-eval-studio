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

import {CitedSource} from '../../models/answer-trace.model';
import {AppConfig} from '../../models/app-config.model';
import {ScoringRequest} from '../scorer';

import {SourceAttributionScorer, isSatisfied, parseExpectedSources} from './source-attribution.scorer';

const CONFIG: AppConfig = {
  gCloudToken: '',
  projectId: 'project',
  region: 'global',
  selectedEngine: 'engine',
  selectedModel: 'model',
  autoRaterModel: '',
  autoRaterInstruction: '',
  selectedDataStores: [],
  enableWebSearch: false,
};

/** A cited source with the given fields and the rest left empty. */
function cited(fields: Partial<CitedSource>): CitedSource {
  return {
    title: '',
    uri: '',
    document: '',
    dataStore: '',
    connector: '',
    ...fields
  };
}

const RUNBOOK = cited({
  title: 'Runbook v2',
  uri: 'https://wiki.example.com/ops/runbook-v2',
  document:
      'projects/p/locations/global/collections/confluence-ops/dataStores/ops-pages/branches/0/documents/runbook',
  dataStore: 'ops-pages',
  connector: 'confluence-ops',
});

const BILLING_TICKET = cited({
  title: 'BILL-42 Billing service ownership',
  uri: 'https://jira.example.com/browse/BILL-42',
  dataStore: 'jira-prod',
  connector: 'jira',
});

describe('parseExpectedSources', () => {
  it('should read each level prefix, ignoring its case', () => {
    expect(parseExpectedSources(
               'dataStores:jira-prod;CONNECTORS:jira;sources:Runbook v2'))
        .toEqual([
          {level: 'dataStores', value: 'jira-prod'},
          {level: 'connectors', value: 'jira'},
          {level: 'sources', value: 'Runbook v2'},
        ]);
  });

  it('should read an entry without a known prefix as a source', () => {
    expect(parseExpectedSources('confluence-policies;https://wiki/a'))
        .toEqual([
          {level: 'sources', value: 'confluence-policies'},
          {level: 'sources', value: 'https://wiki/a'},
        ]);
  });

  it('should trim entries and drop blank and repeated ones', () => {
    expect(parseExpectedSources(
               ' dataStores : jira-prod ; ;dataStores:jira-prod; sources: ;'))
        .toEqual([{level: 'dataStores', value: 'jira-prod'}]);
  });

  it('should find no expectations in an empty or absent cell', () => {
    expect(parseExpectedSources('')).toEqual([]);
    expect(parseExpectedSources('  ;  ')).toEqual([]);
    expect(parseExpectedSources(undefined)).toEqual([]);
  });
});

describe('isSatisfied', () => {
  it('should match data stores and connectors exactly', () => {
    expect(isSatisfied({level: 'dataStores', value: 'jira-prod'}, [BILLING_TICKET]))
        .toBeTrue();
    expect(isSatisfied({level: 'connectors', value: 'jira'}, [BILLING_TICKET]))
        .toBeTrue();
    expect(isSatisfied({level: 'dataStores', value: 'jira'}, [BILLING_TICKET]))
        .toBeFalse();
    expect(isSatisfied(
               {level: 'connectors', value: 'sales'},
               [cited({connector: 'salesforce-crm'})]))
        .toBeFalse();
    expect(isSatisfied({level: 'connectors', value: 'JIRA'}, [BILLING_TICKET]))
        .toBeFalse();
  });

  it('should match a source anywhere in a uri, resource name or title, ignoring case',
     () => {
       expect(isSatisfied({level: 'sources', value: 'runbook v2'}, [RUNBOOK]))
           .toBeTrue();
       expect(isSatisfied({level: 'sources', value: '/ops/runbook'}, [RUNBOOK]))
           .toBeTrue();
       expect(isSatisfied(
                  {level: 'sources', value: 'documents/runbook'}, [RUNBOOK]))
           .toBeTrue();
       expect(isSatisfied({level: 'sources', value: 'Runbook v1'}, [RUNBOOK]))
           .toBeFalse();
     });

  it('should not let a source expectation match a data store or connector id',
     () => {
       // The collision namespacing prevents: a document titled "sales" must
       // not satisfy a connector expectation, and vice versa.
       expect(isSatisfied(
                  {level: 'connectors', value: 'sales'},
                  [cited({title: 'sales playbook'})]))
           .toBeFalse();
       expect(isSatisfied(
                  {level: 'sources', value: 'jira-prod'}, [BILLING_TICKET]))
           .toBeFalse();
     });

  it('should not match anything when nothing was cited', () => {
    expect(isSatisfied({level: 'sources', value: 'Runbook'}, [])).toBeFalse();
  });
});

describe('SourceAttributionScorer', () => {
  let scorer: SourceAttributionScorer;

  beforeEach(() => {
    scorer = new SourceAttributionScorer();
  });

  /** A request for a row citing the given sources and expecting `cell`. */
  function request(
      cell: string|undefined, citedSources: CitedSource[]): ScoringRequest {
    return {
      query: 'q',
      response: 'r',
      config: CONFIG,
      trace: {citedSources},
      expectedSources: cell,
    };
  }

  it('should score 1 when every expected source is cited, ignoring extra citations',
     async () => {
       const result = await scorer.score(request(
           'dataStores:jira-prod;sources:Runbook v2',
           [cited({title: 'Unrelated'}), RUNBOOK, BILLING_TICKET]));

       expect(result.score).toBe(1);
       expect(result.details).toEqual({expected: 2, matched: 2, cited: 3});
     });

  it('should score the share of expected sources that were cited', async () => {
    // C and D of C, D, E were cited: 2 of 3.
    const result = await scorer.score(request(
        'sources:C;sources:D;sources:E',
        [
          cited({title: 'A'}), cited({title: 'B'}), cited({title: 'C'}),
          cited({title: 'D'})
        ]));

    expect(result.score).toBe(0.67);
    expect(result.details).toEqual({expected: 3, matched: 2, cited: 4});
  });

  it('should score 0 when none of the expected sources is cited', async () => {
    const result = await scorer.score(
        request('sources:Runbook v2', [cited({title: 'Runbook v1'})]));

    expect(result.score).toBe(0);
  });

  it('should score 0 when the agent cited nothing', async () => {
    expect((await scorer.score(request('connectors:jira', []))).score)
        .toBe(0);
    expect((await scorer.score({
             query: 'q',
             response: 'r',
             config: CONFIG,
             expectedSources: 'connectors:jira'
           })).score)
        .toBe(0);
  });

  it('should only score rows that set an expectation', () => {
    expect(scorer.canScore(request('connectors:jira', []))).toBeTrue();
    expect(scorer.canScore(request('', [RUNBOOK]))).toBeFalse();
    expect(scorer.canScore(request(' ; ', [RUNBOOK]))).toBeFalse();
    expect(scorer.canScore(request(undefined, [RUNBOOK]))).toBeFalse();
  });

  it('should not need a golden answer', () => {
    expect(scorer.requiresGolden).toBeFalse();
  });
});
