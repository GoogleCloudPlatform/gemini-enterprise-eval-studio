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

import {CitedSource, parseDocumentResource, traceCells} from './answer-trace.model';

/** A cited source with the given fields and the rest left empty. */
function source(fields: Partial<CitedSource>): CitedSource {
  return {
    title: '',
    uri: '',
    document: '',
    dataStore: '',
    connector: '',
    ...fields
  };
}

describe('traceCells', () => {
  it('should list each source and the distinct data stores and connectors',
     () => {
       expect(traceCells({
         citedSources: [
           source({
             title: 'Refund Policy',
             uri: 'https://wiki/refund',
             dataStore: 'policies',
             connector: 'confluence'
           }),
           source({
             title: 'Refund FAQ',
             dataStore: 'policies',
             connector: 'confluence'
           }),
           source({uri: 'https://jira/1', dataStore: 'issues'}),
         ],
       })).toEqual({
         citedSources:
             'Refund Policy - https://wiki/refund\nRefund FAQ\nhttps://jira/1',
         citedDataStores: 'policies, issues',
         citedConnectors: 'confluence',
       });
     });

  it('should give empty cells when nothing was cited', () => {
    const empty = {citedSources: '', citedDataStores: '', citedConnectors: ''};
    expect(traceCells({citedSources: []})).toEqual(empty);
    expect(traceCells(undefined)).toEqual(empty);
  });
});

describe('parseDocumentResource', () => {
  it('should read the data store and the connector collection', () => {
    expect(
        parseDocumentResource(
            'projects/p/locations/global/collections/jira-prod/dataStores/jira-prod_issue/branches/0/documents/42'))
        .toEqual({dataStore: 'jira-prod_issue', connector: 'jira-prod'});
  });

  it('should report no connector for a data store in default_collection',
     () => {
       expect(
           parseDocumentResource(
               'projects/p/locations/global/collections/default_collection/dataStores/uploads/branches/0/documents/1'))
           .toEqual({dataStore: 'uploads', connector: ''});
     });

  it('should read a data store named without a collection', () => {
    expect(
        parseDocumentResource(
            'projects/p/locations/us/dataStores/kb/branches/0/documents/1'))
        .toEqual({dataStore: 'kb', connector: ''});
  });

  it('should report nothing for an empty or unrelated name', () => {
    expect(parseDocumentResource(''))
        .toEqual({dataStore: '', connector: ''});
    expect(parseDocumentResource('https://example.com/dataStoresX/y'))
        .toEqual({dataStore: '', connector: ''});
  });
});
