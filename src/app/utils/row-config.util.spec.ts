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

import {AppConfig} from '../models/app-config.model';
import {ConnectorOption} from '../models/connector.model';
import {CSVRow} from '../models/csv-row.model';

import {connectorOverrideId, hasConnectorsOverrideColumn, resolveRowConfig, resolveRowGrounding} from './row-config.util';

const CONFIG: AppConfig = {
  projectId: 'project',
  region: 'global',
  selectedEngine: 'engine',
  selectedModel: 'model',
  autoRaterModel: 'gemini-3.5-flash',
  autoRaterInstruction: 'instructions',
  selectedDataStores: ['jira-issues', 'loose-ds'],
  enableWebSearch: true
};

const CONNECTORS: ConnectorOption[] = [
  {
    id: 'jira-connector',
    displayName: 'Jira',
    entityIds: ['jira-issues'],
    searchableDataStoreIds: ['jira-issues']
  },
  {
    id: 'SERVICENOW',
    displayName: 'ServiceNow',
    entityIds: ['sn-incident', 'sn-catalog'],
    searchableDataStoreIds: ['sn-incident', 'sn-catalog']
  },
  {
    id: 'NOTION',
    displayName: 'Notion',
    entityIds: ['collections/eua_placeholder_NOTION'],
    searchableDataStoreIds: []
  },
  {
    id: 'Web Search',
    displayName: 'Web Search',
    entityIds: [],
    searchableDataStoreIds: []
  },
];

function rowWith(connectorsOverride?: string): CSVRow {
  return {query: 'q', golden: 'g', connectors_override: connectorsOverride};
}

describe('resolveRowConfig', () => {
  it('uses the connector id and web_search from the cell', () => {
    expect(resolveRowConfig(rowWith('jira-connector;web_search'), CONFIG))
        .toEqual({connectorIds: ['jira-connector'], enableWebSearch: true});
  });

  it('matches web_search case-insensitively', () => {
    expect(resolveRowConfig(rowWith('Web_Search'), CONFIG).enableWebSearch)
        .toBeTrue();
    expect(resolveRowConfig(rowWith('WEB_SEARCH'), CONFIG).enableWebSearch)
        .toBeTrue();
  });

  it('matches connector ids case-sensitively', () => {
    expect(resolveRowConfig(rowWith('Jira-Connector'), CONFIG).connectorIds)
        .toEqual(['Jira-Connector']);
  });

  it('turns web search off when the cell omits web_search', () => {
    expect(resolveRowConfig(rowWith('jira-connector'), CONFIG))
        .toEqual({connectorIds: ['jira-connector'], enableWebSearch: false});
  });

  it('uses web search alone when the cell only lists web_search', () => {
    expect(resolveRowConfig(rowWith('web_search'), CONFIG))
        .toEqual({connectorIds: [], enableWebSearch: true});
  });

  it('turns everything off for []', () => {
    expect(resolveRowConfig(rowWith(' [] '), CONFIG))
        .toEqual({connectorIds: [], enableWebSearch: false});
  });

  it('inherits the global web search setting for a blank cell', () => {
    expect(resolveRowConfig(rowWith('  '), CONFIG))
        .toEqual({enableWebSearch: true});
  });

  it('treats a cell holding only separators as blank', () => {
    expect(resolveRowConfig(rowWith(' ; '), CONFIG))
        .toEqual({enableWebSearch: true});
  });

  it('inherits the global web search setting without the column', () => {
    expect(resolveRowConfig({query: 'q', golden: 'g'}, CONFIG))
        .toEqual({enableWebSearch: true});
  });
});

describe('resolveRowGrounding', () => {
  it('expands a connector id and labels it', () => {
    expect(resolveRowGrounding(
               rowWith('jira-connector;web_search'), CONFIG, CONNECTORS))
        .toEqual({
          dataStoreIds: ['jira-issues'],
          searchAllDataStores: false,
          enableWebSearch: true,
          connectorsUsed: 'jira-connector, Web Search'
        });
  });

  it('expands a multi-store connector into all of its data stores', () => {
    expect(resolveRowGrounding(rowWith('SERVICENOW'), CONFIG, CONNECTORS)
               .dataStoreIds)
        .toEqual(['sn-incident', 'sn-catalog']);
  });

  it('does not repeat a data store listed twice', () => {
    expect(resolveRowGrounding(
               rowWith('jira-connector;jira-connector'), CONFIG, CONNECTORS)
               .dataStoreIds)
        .toEqual(['jira-issues']);
  });

  it('flags an unknown connector id and leaves it out', () => {
    expect(resolveRowGrounding(rowWith('typo;web_search'), CONFIG, CONNECTORS))
        .toEqual({
          dataStoreIds: [],
          searchAllDataStores: false,
          enableWebSearch: true,
          connectorsUsed: 'typo (not found), Web Search'
        });
  });

  it('flags a connector without searchable data stores', () => {
    expect(resolveRowGrounding(rowWith('NOTION'), CONFIG, CONNECTORS))
        .toEqual({
          dataStoreIds: [],
          searchAllDataStores: false,
          enableWebSearch: false,
          connectorsUsed: 'NOTION (not found)'
        });
  });

  it('labels web search alone', () => {
    expect(resolveRowGrounding(rowWith('web_search'), CONFIG, CONNECTORS)
               .connectorsUsed)
        .toBe('Web Search');
  });

  it('searches nothing for [] and labels it (none)', () => {
    expect(resolveRowGrounding(rowWith('[]'), CONFIG, CONNECTORS)).toEqual({
      dataStoreIds: [],
      searchAllDataStores: false,
      enableWebSearch: false,
      connectorsUsed: '(none)'
    });
  });

  it('uses the global selection for a blank cell', () => {
    expect(resolveRowGrounding(rowWith(''), CONFIG, CONNECTORS)).toEqual({
      dataStoreIds: ['jira-issues', 'loose-ds'],
      searchAllDataStores: false,
      enableWebSearch: true,
      connectorsUsed: 'jira-connector, loose-ds, Web Search'
    });
  });

  it('searches every data store for an empty global selection', () => {
    const config:
        AppConfig = {...CONFIG, selectedDataStores: [], enableWebSearch: false};

    expect(resolveRowGrounding(rowWith(undefined), config, CONNECTORS))
        .toEqual({
          dataStoreIds: [],
          searchAllDataStores: true,
          enableWebSearch: false,
          connectorsUsed: '(all engine data stores)'
        });
  });

  it('labels connector ids as unavailable when the connector list is unknown', () => {
    expect(resolveRowGrounding(
               rowWith('jira-connector;web_search'), CONFIG, undefined))
        .toEqual({
          dataStoreIds: [],
          searchAllDataStores: false,
          enableWebSearch: true,
          connectorsUsed: 'jira-connector (connectors unavailable), Web Search'
        });
  });

  it('names the global selection by id when the connector list is unknown', () => {
    expect(resolveRowGrounding(rowWith(''), CONFIG, undefined).connectorsUsed)
        .toBe('jira-issues, loose-ds, Web Search');
  });

  it('does not search every data store when the override finds none', () => {
    const config:
        AppConfig = {...CONFIG, selectedDataStores: [], enableWebSearch: false};

    expect(resolveRowGrounding(rowWith('typo'), config, CONNECTORS)
               .searchAllDataStores)
        .toBeFalse();
  });
});

describe('connectorOverrideId', () => {
  it('returns web_search for the Web Search connector', () => {
    expect(connectorOverrideId(CONNECTORS[3])).toBe('web_search');
  });

  it('returns the connector id for other connectors', () => {
    expect(connectorOverrideId(CONNECTORS[1])).toBe('SERVICENOW');
  });

  it('returns undefined for a connector without searchable data stores', () => {
    expect(connectorOverrideId(CONNECTORS[2])).toBeUndefined();
  });
});

describe('hasConnectorsOverrideColumn', () => {
  it('is true when a row has the column, even if blank', () => {
    expect(hasConnectorsOverrideColumn([{query: 'q', connectors_override: ''}]))
        .toBeTrue();
  });

  it('is false when no row has the column', () => {
    expect(hasConnectorsOverrideColumn([{query: 'q'}])).toBeFalse();
    expect(hasConnectorsOverrideColumn([])).toBeFalse();
  });
});
