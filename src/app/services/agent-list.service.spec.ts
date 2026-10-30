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

import {TestBed, fakeAsync, tick} from '@angular/core/testing';

import {Agent} from '../models/agent.model';
import {AppConfig} from '../models/app-config.model';
import {MockEvalBackendService} from '../testing/mocks';

import {AgentListService} from './agent-list.service';
import {EvalBackendService} from './eval-backend.service';

const CONFIG: AppConfig = {
  projectId: 'project',
  region: 'global',
  selectedEngine: 'engine1',
  selectedModel: '',
  autoRaterModel: '',
  autoRaterInstruction: '',
  selectedDataStores: [],
  enableWebSearch: false,
  gCloudToken: 'token',
};

const AGENT_1: Agent = {
  name: 'engine1/assistants/default_assistant/agents/a1',
  state: 'ENABLED',
};
const AGENT_2: Agent = {
  name: 'engine1/assistants/default_assistant/agents/a2',
  state: 'ENABLED',
};

describe('AgentListService', () => {
  let service: AgentListService;
  let backend: MockEvalBackendService;

  beforeEach(() => {
    backend = new MockEvalBackendService();
    TestBed.configureTestingModule(
        {providers: [{provide: EvalBackendService, useValue: backend}]});
    service = TestBed.inject(AgentListService);
  });

  it('should load the runnable agents of the selected engine', fakeAsync(() => {
       backend.fetchAgentsSpy.and.resolveTo([
         AGENT_1,
         {name: 'engine1/assistants/default_assistant/agents/x',
          state: 'CONFIGURED'},
       ]);

       service.load(CONFIG);
       expect(service.state.status).toBe('loading');
       tick();

       expect(backend.fetchAgentsSpy)
           .toHaveBeenCalledWith('project', 'global', 'engine1', CONFIG);
       expect(service.state).toEqual({status: 'loaded', agents: [AGENT_1]});
     }));

  it('should send one request when the same list is asked for twice',
     fakeAsync(() => {
       backend.fetchAgentsSpy.and.resolveTo([AGENT_1]);

       service.load(CONFIG);
       service.load({...CONFIG});
       tick();
       service.load(CONFIG);
       tick();

       expect(backend.fetchAgentsSpy.calls.count()).toBe(1);
     }));

  it('should fetch again for a different project, region, engine or token',
     fakeAsync(() => {
       backend.fetchAgentsSpy.and.resolveTo([]);

       service.load(CONFIG);
       service.load({...CONFIG, projectId: 'other'});
       service.load({...CONFIG, region: 'eu'});
       service.load({...CONFIG, selectedEngine: 'engine2'});
       service.load({...CONFIG, gCloudToken: 'new-token'});
       tick();

       expect(backend.fetchAgentsSpy.calls.count()).toBe(5);
     }));

  it('should apply only the latest request when one for the same engine is still in flight',
     fakeAsync(() => {
       const resolvers: Array<(agents: Agent[]) => void> = [];
       backend.fetchAgentsSpy.and.callFake(
           () => new Promise<Agent[]>(resolve => resolvers.push(resolve)));

       // engine1, then engine2, then back to engine1 before the first answers.
       service.load(CONFIG);
       service.load({...CONFIG, selectedEngine: 'engine2'});
       service.load(CONFIG);
       expect(resolvers.length).toBe(3);

       resolvers[0]([AGENT_1]);
       tick();
       expect(service.state.status).toBe('loading');

       resolvers[2]([AGENT_2]);
       tick();
       expect(service.state).toEqual({status: 'loaded', agents: [AGENT_2]});
     }));

  it('should report a failure and try again on the next request', fakeAsync(() => {
       spyOn(console, 'error');
       const error = new Error('Permission denied');
       backend.fetchAgentsSpy.and.rejectWith(error);

       service.load(CONFIG);
       tick();
       expect(service.state).toEqual({status: 'failed', agents: [], error});

       backend.fetchAgentsSpy.and.resolveTo([AGENT_1]);
       service.load(CONFIG);
       tick();
       expect(service.state).toEqual({status: 'loaded', agents: [AGENT_1]});
       expect(backend.fetchAgentsSpy.calls.count()).toBe(2);
     }));

  it('should discard a request in flight when cleared', fakeAsync(() => {
       let resolve!: (agents: Agent[]) => void;
       backend.fetchAgentsSpy.and.callFake(
           () => new Promise<Agent[]>(r => resolve = r));

       service.load(CONFIG);
       service.clear();
       resolve([AGENT_1]);
       tick();

       expect(service.state).toEqual({status: 'idle', agents: []});
     }));

  it('should not request agents without a project or engine', () => {
    service.load({...CONFIG, projectId: ''});
    service.load({...CONFIG, selectedEngine: ''});

    expect(backend.fetchAgentsSpy).not.toHaveBeenCalled();
    expect(service.state).toEqual({status: 'idle', agents: []});
  });
});
