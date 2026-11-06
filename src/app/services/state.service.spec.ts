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

import {fakeAsync, tick} from '@angular/core/testing';

import {AppConfig} from '../models/app-config.model';
import {ConnectorOption} from '../models/connector.model';

import {StateService} from './state.service';

const STORAGE_KEY = 'ge_eval_studio_config';

/** Longer than the debounce on localStorage writes. */
const STORAGE_DEBOUNCE_MS = 300;

const AGENT_PATH =
    'projects/p/locations/global/collections/default_collection/engines/e/assistants/default_assistant/agents/support-bot';

const JIRA: ConnectorOption = {
  id: 'JIRA',
  displayName: 'Jira',
  entityIds: ['jira-issues'],
  searchableDataStoreIds: ['jira-issues'],
};

describe('StateService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('should not persist the selected agent', fakeAsync(() => {
       const service = new StateService();
       const config: AppConfig = {
         ...service.getCurrentConfig(),
         projectId: 'project',
         selectedEngine: 'engine',
         selectedAgent: AGENT_PATH,
       };

       service.setConfig(config);
       tick(STORAGE_DEBOUNCE_MS);

       const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as
           Partial<AppConfig>;
       expect(stored.projectId).toBe('project');
       expect('selectedAgent' in stored).toBeFalse();
       // The live configuration still carries it for the current session.
       expect(service.getCurrentConfig().selectedAgent).toBe(AGENT_PATH);
     }));

  it('should not restore an agent saved by an earlier version', () => {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({projectId: 'project', selectedAgent: AGENT_PATH}));

    const config = new StateService().getCurrentConfig();

    expect(config.projectId).toBe('project');
    expect(config.selectedAgent).toBe('');
  });

  describe('connectors', () => {
    it('should return no connectors before any are set', () => {
      expect(new StateService().getConnectors('engineA')).toBeUndefined();
    });

    it('should return the connectors set for the same engine', () => {
      const service = new StateService();
      service.setConnectors('engineA', [JIRA]);
      expect(service.getConnectors('engineA')).toEqual([JIRA]);
    });

    it('should not return connectors set for another engine', () => {
      const service = new StateService();
      service.setConnectors('engineA', [JIRA]);
      expect(service.getConnectors('engineB')).toBeUndefined();
    });

    it('should replace the connectors when another engine sets them', () => {
      const service = new StateService();
      service.setConnectors('engineA', [JIRA]);
      service.setConnectors('engineB', []);
      expect(service.getConnectors('engineA')).toBeUndefined();
    });
  });
});
