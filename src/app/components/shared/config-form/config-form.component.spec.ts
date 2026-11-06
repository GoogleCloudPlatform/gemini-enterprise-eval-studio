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

import {HttpErrorResponse} from '@angular/common/http';
import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {BehaviorSubject, of, throwError} from 'rxjs';

import {Agent} from '../../../models/agent.model';
import {AppConfig, ConnectorAuthState, Engine, WidgetConfigResponse} from '../../../models/app-config.model';
import {AuthService} from '../../../services/auth.service';
import {EvalBackendService} from '../../../services/eval-backend.service';
import {StateService} from '../../../services/state.service';
import {MockAuthService, MockEvalBackendService} from '../../../testing/mocks';

import {ConfigFormComponent} from './config-form.component';

describe('ConfigFormComponent', () => {
  let fixture: ComponentFixture<ConfigFormComponent>;
  let component: ConfigFormComponent;
  let mockStateService: jasmine.SpyObj<StateService>;
  let mockAuthService: MockAuthService;
  let mockEvalBackendService: MockEvalBackendService;
  let configSubject: BehaviorSubject<AppConfig>;
  let enginesSubject: BehaviorSubject<Engine[]>;
  let errorMessageSubject: BehaviorSubject<string>;

  beforeEach(async () => {
    configSubject = new BehaviorSubject<AppConfig>({
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      autoRaterModel: '',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
    });

    enginesSubject = new BehaviorSubject<Engine[]>([]);
    errorMessageSubject = new BehaviorSubject<string>('');


    mockStateService = jasmine.createSpyObj(
        'StateService',
        ['setConfig', 'setEngines', 'getCurrentConfig', 'setErrorMessage', 'setConnectors'], {
          config$: configSubject.asObservable(),
          engines$: enginesSubject.asObservable(),
          errorMessage$: errorMessageSubject.asObservable()
        });

    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);

    mockAuthService = new MockAuthService();
    mockEvalBackendService = new MockEvalBackendService();

    await TestBed
        .configureTestingModule({
          imports: [ConfigFormComponent],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: AuthService, useValue: mockAuthService},
            {provide: EvalBackendService, useValue: mockEvalBackendService},
          ]
        })
        .compileComponents();

    fixture = TestBed.createComponent(ConfigFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('locked', () => {
    function fieldset(): HTMLFieldSetElement {
      return (fixture.nativeElement as HTMLElement).querySelector('fieldset')!;
    }

    function notice(): Element|null {
      return (fixture.nativeElement as HTMLElement)
          .querySelector('[data-test-id="config-form-locked-notice"]');
    }

    it('should leave the form editable by default', () => {
      expect(fieldset().disabled).toBeFalse();
      expect(notice()).toBeNull();
    });

    it('should disable every control and explain why while locked', () => {
      fixture.componentRef.setInput('locked', true);
      fixture.detectChanges();

      expect(fieldset().disabled).toBeTrue();
      expect(notice()?.textContent)
          .toContain('Settings are locked while a run is in progress');
      const projectId =
          (fixture.nativeElement as HTMLElement)
              .querySelector('#projectId') as HTMLInputElement;
      expect(projectId.matches(':disabled')).toBeTrue();
    });

    it('should keep Next usable while locked so the user can return to the run',
       () => {
         spyOn(component, 'canProceed').and.returnValue(true);
         fixture.componentRef.setInput('locked', true);
         fixture.detectChanges();

         const next = (fixture.nativeElement as HTMLElement)
                          .querySelector<HTMLButtonElement>(
                              '[data-test-id="config-form-next-button"]')!;
         expect(next.matches(':disabled')).toBeFalse();
       });
  });

  describe('agents', () => {
    const ENGINES: Engine[] = [
      {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
      {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}},
    ];
    const AGENT_1: Agent = {
      name: 'engine1/assistants/default_assistant/agents/a1',
      displayName: 'Support Bot',
      description: 'Answers support questions.',
      state: 'ENABLED',
    };
    const AGENT_2: Agent = {
      name: 'engine1/assistants/default_assistant/agents/a2',
      state: 'ENABLED',
    };

    function query<T extends Element>(testId: string): T|null {
      return (fixture.nativeElement as HTMLElement)
          .querySelector<T>(`[data-test-id="${testId}"]`);
    }

    function agentSelect(): HTMLSelectElement {
      return query<HTMLSelectElement>('config-form-agent-select')!;
    }

    /** Shows the form for `engine1` of project `project`. */
    function selectEngine1() {
      component.config.projectId = 'project';
      component.engines = ENGINES;
      component.config.selectedEngine = 'engine1';
    }

    it('should offer the default assistant and every runnable agent',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([
           AGENT_1,
           AGENT_2,
           {name: 'engine1/assistants/default_assistant/agents/broken',
            state: 'DEPLOYMENT_FAILED'},
         ]);
         selectEngine1();

         component.onEngineChange();
         tick();
         fixture.detectChanges();

         expect(mockEvalBackendService.fetchAgentsSpy)
             .toHaveBeenCalledWith(
                 'project', 'global', 'engine1',
                 jasmine.objectContaining({selectedEngine: 'engine1'}));
         const options = Array.from(agentSelect().options);
         expect(options.map(o => o.textContent?.trim())).toEqual([
           'Default assistant (no agent)', 'Support Bot', 'a2'
         ]);
         expect(agentSelect().disabled).toBeFalse();
         expect(component.config.selectedAgent).toBe('');
       }));

    it('should mark a suspended agent in the picker', fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo(
             [AGENT_1, {...AGENT_2, state: 'SUSPENDED'}]);
         selectEngine1();

         component.onEngineChange();
         tick();
         fixture.detectChanges();

         const options = Array.from(agentSelect().options);
         expect(options.map(o => o.textContent?.trim())).toEqual([
           'Default assistant (no agent)', 'Support Bot', 'a2 (suspended)'
         ]);
       }));

    it('should show the description of the selected agent', fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([AGENT_1]);
         selectEngine1();
         component.onEngineChange();
         tick();

         component.config.selectedAgent = AGENT_1.name;
         fixture.detectChanges();

         expect(query('config-form-agent-description')?.textContent)
             .toContain('Answers support questions.');
       }));

    it('should disable the picker and say so when the engine has no agents',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([]);
         selectEngine1();

         component.onEngineChange();
         tick();
         fixture.detectChanges();
         tick();

         expect(agentSelect().disabled).toBeTrue();
         expect(query('config-form-no-agents')?.textContent)
             .toContain('No agents published under this engine.');
       }));

    it('should disable the picker while the agents are loading',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.returnValue(
             new Promise<Agent[]>(() => {}));
         selectEngine1();

         component.onEngineChange();
         fixture.detectChanges();
         tick();

         expect(component.agentsLoading).toBeTrue();
         expect(agentSelect().disabled).toBeTrue();
         expect(query('config-form-agents-loading')).not.toBeNull();
       }));

    it('should fall back to the default assistant when agents cannot be listed',
       fakeAsync(() => {
         spyOn(console, 'error');
         mockEvalBackendService.fetchAgentsSpy.and.rejectWith(
             new Error('Permission denied'));
         selectEngine1();

         component.onEngineChange();
         tick();
         fixture.detectChanges();
         tick();

         expect(component.agents).toEqual([]);
         expect(component.config.selectedAgent).toBe('');
         expect(component.errorMessage).toBe('');
         expect(query('config-form-agents-error')?.textContent)
             .toContain(
                 'Could not list agents: Permission denied. Queries will run against the default assistant.');
       }));

    it('should discard a response for an engine that is no longer selected',
       fakeAsync(() => {
         let resolveEngine1!: (agents: Agent[]) => void;
         mockEvalBackendService.fetchAgentsSpy.and.callFake(
             (projectId: string, region: string, engineId: string) =>
                 engineId === 'engine1' ?
                 new Promise<Agent[]>(resolve => {
                   resolveEngine1 = resolve;
                 }) :
                 Promise.resolve([]));
         selectEngine1();
         component.onEngineChange();

         component.config.selectedEngine = 'engine2';
         component.onEngineChange();
         tick();
         resolveEngine1([AGENT_1]);
         tick();

         expect(component.agents).toEqual([]);
         expect(component.agentsLoading).toBeFalse();
       }));

    it('should keep the selection when the reloaded list still offers it',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo(
             [AGENT_1, AGENT_2]);
         selectEngine1();
         component.config.selectedAgent = AGENT_1.name;
         mockStateService.setConfig.calls.reset();

         component.fetchAgentsForSelectedEngine();
         tick();

         expect(component.config.selectedAgent).toBe(AGENT_1.name);
         expect(mockStateService.setConfig).not.toHaveBeenCalled();
       }));

    it('should drop a selection the reloaded list no longer offers',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([
           AGENT_2,
           {...AGENT_1, state: 'DEPLOYMENT_FAILED'},
         ]);
         selectEngine1();
         component.config.selectedAgent = AGENT_1.name;

         component.fetchAgentsForSelectedEngine();
         tick();

         expect(component.config.selectedAgent).toBe('');
         expect(mockStateService.setConfig)
             .toHaveBeenCalledWith(
                 jasmine.objectContaining({selectedAgent: ''}));
       }));

    it('should share one request and one list between the two tabs\' forms',
       fakeAsync(() => {
         // Run Queries and Run Evaluation each mount a form, and both share
         // the config through StateService.
         mockStateService.setConfig.and.callFake(
             (config: AppConfig) => configSubject.next(structuredClone(config)));
         const resolvers: Array<(agents: Agent[]) => void> = [];
         mockEvalBackendService.fetchAgentsSpy.and.callFake(
             () => new Promise<Agent[]>(resolve => resolvers.push(resolve)));
         const otherFixture = TestBed.createComponent(ConfigFormComponent);
         otherFixture.detectChanges();
         const otherForm = otherFixture.componentInstance;
         enginesSubject.next(ENGINES);

         // The user picks engine1 in this form; the other form follows.
         selectEngine1();
         component.onEngineChange();
         expect(resolvers.length).toBe(1);

         resolvers[0]([AGENT_1]);
         tick();
         expect(otherForm.agents).toEqual([AGENT_1]);

         // An agent picked in this form survives in the other.
         component.config.selectedAgent = AGENT_1.name;
         component.onConfigChange();
         otherForm.fetchAgentsForSelectedEngine();
         tick();

         expect(resolvers.length).toBe(1);
         expect(configSubject.value.selectedAgent).toBe(AGENT_1.name);
         expect(otherForm.config.selectedAgent).toBe(AGENT_1.name);
       }));

    it('should ignore an earlier response for the same engine', fakeAsync(() => {
         const resolvers: Array<(agents: Agent[]) => void> = [];
         mockEvalBackendService.fetchAgentsSpy.and.callFake(
             () => new Promise<Agent[]>(resolve => resolvers.push(resolve)));
         selectEngine1();

         // engine1, engine2, then engine1 again before the first answer.
         component.onEngineChange();
         component.config.selectedEngine = 'engine2';
         component.onEngineChange();
         component.config.selectedEngine = 'engine1';
         component.onEngineChange();
         expect(resolvers.length).toBe(3);

         resolvers[0]([AGENT_1]);
         tick();
         expect(component.agentsLoading).toBeTrue();
         expect(component.agents).toEqual([]);

         resolvers[2]([AGENT_2]);
         tick();
         expect(component.agentsLoading).toBeFalse();
         expect(component.agents).toEqual([AGENT_2]);
       }));

    it('should show the proxy\'s plain-text error message', fakeAsync(() => {
         spyOn(console, 'error');
         mockEvalBackendService.fetchAgentsSpy.and.rejectWith(
             new HttpErrorResponse({
               status: 400,
               statusText: 'Bad Request',
               error: 'Invalid engineId parameter.',
             }));
         selectEngine1();

         component.onEngineChange();
         tick();

         expect(component.agentsErrorMessage)
             .toBe('Could not list agents: Invalid engineId parameter.');
       }));

    it('should keep the agent and send one request when reloaded engines keep the selected engine',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([AGENT_1]);
         mockEvalBackendService.fetchEnginesSpy.and.resolveTo(ENGINES);
         // Publish the engines, so the engines$ subscription runs too.
         mockStateService.setEngines.and.callFake(
             (engines: Engine[]) => enginesSubject.next(engines));
         selectEngine1();
         component.onEngineChange();
         tick();
         component.config.selectedAgent = AGENT_1.name;
         mockEvalBackendService.fetchAgentsSpy.calls.reset();

         component.fetchEngines();
         tick();

         expect(mockEvalBackendService.fetchAgentsSpy.calls.count()).toBe(1);
         expect(component.config.selectedAgent).toBe(AGENT_1.name);
       }));

    it('should clear the agents and the selection when the engine changes',
       fakeAsync(() => {
         mockEvalBackendService.fetchAgentsSpy.and.resolveTo([AGENT_1]);
         selectEngine1();
         component.onEngineChange();
         tick();
         component.config.selectedAgent = AGENT_1.name;
         mockEvalBackendService.fetchAgentsSpy.and.returnValue(
             new Promise<Agent[]>(() => {}));

         component.config.selectedEngine = 'engine2';
         component.onEngineChange();

         expect(component.agents).toEqual([]);
         expect(component.config.selectedAgent).toBe('');
       }));

    it('should clear the agents when the project, region or token changes',
       fakeAsync(() => {
         spyOn(console, 'error');
         mockEvalBackendService.fetchAgentsSpy.and.rejectWith(
             new Error('Permission denied'));
         selectEngine1();
         component.onEngineChange();
         tick();
         expect(component.agentsErrorMessage).not.toBe('');

         component.changeConfigAndResetEngines();

         expect(component.agents).toEqual([]);
         expect(component.agentsErrorMessage).toBe('');
         expect(component.agentsLoading).toBeFalse();
         expect(component.config.selectedAgent).toBe('');
       }));

    it('should not look up agents without a project or engine', () => {
      component.config.projectId = '';
      component.config.selectedEngine = 'engine1';

      component.fetchAgentsForSelectedEngine();

      expect(mockEvalBackendService.fetchAgentsSpy).not.toHaveBeenCalled();
      expect(component.agents).toEqual([]);
      expect(component.agentsLoading).toBeFalse();
    });
  });

  describe('connectorIdHint', () => {
    it('should name the connector id to use in connectors_override', () => {
      expect(component.connectorIdHint({
        id: 'JIRA',
        displayName: 'Jira',
        entityIds: ['jira-issues'],
        searchableDataStoreIds: ['jira-issues'],
      })).toBe('connectors_override id: JIRA');
    });

    it('should name web_search for the Web Search option', () => {
      expect(component.connectorIdHint({
        id: 'Web Search',
        displayName: 'Web Search',
        entityIds: [],
        searchableDataStoreIds: [],
      })).toBe('connectors_override id: web_search');
    });

    it('should say a connector without searchable data stores is not available',
       () => {
         expect(component.connectorIdHint({
           id: 'NOTION',
           displayName: 'Notion',
           entityIds: ['notion-ds'],
           searchableDataStoreIds: [],
         })).toBe('connectors_override: not available (not authorized)');
       });
  });

  describe('fetchEngines', () => {
    it('should set error message if project ID is missing', () => {
      component.config.projectId = '';

      component.fetchEngines();

      expect(component.errorMessage)
          .toBe('Please provide Project ID');
    });

    it('should fetch engines successfully and auto-select first engine', fakeAsync(() => {
      component.config.projectId = 'project';
      component.config.region = 'global';

      const mockEngines: Engine[] = [
        {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
        {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
      ];

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(Promise.resolve(mockEngines));

      component.fetchEngines();
      tick();

      expect(mockEvalBackendService.fetchEnginesSpy)
          .toHaveBeenCalledWith('project', 'global', jasmine.objectContaining({
            projectId: 'project',
            region: 'global'
          }));
      expect(component.engines.length).toBe(2);
      expect(component.config.selectedEngine).toBe('engine1');
    }));

    it('should pass correct region to fetchEngines', fakeAsync(() => {
      component.config.projectId = 'project';
      component.config.region = 'us-central1';

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(Promise.resolve([]));

      component.fetchEngines();
      tick();

      expect(mockEvalBackendService.fetchEnginesSpy)
          .toHaveBeenCalledWith('project', 'us-central1', jasmine.objectContaining({
            projectId: 'project',
            region: 'us-central1'
          }));
    }));

    it('should handle Error when fetching engines', fakeAsync(() => {
      component.config.projectId = 'project';

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(
          Promise.reject(new Error('Fetch error')));

      component.fetchEngines();
      tick();

      expect(component.errorMessage).toBe('Error fetching engines: Fetch error');
      expect(component.loading).toBeFalse();
    }));

    it('should handle HttpErrorResponse when fetching engines', fakeAsync(() => {
      component.config.projectId = 'project';

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(
          Promise.reject(new HttpErrorResponse({
            status: 403,
            error: {error: {message: 'Permission denied'}}
          })));

      component.fetchEngines();
      tick();

      expect(component.errorMessage)
          .toBe('Error fetching engines: Permission denied');
      expect(component.loading).toBeFalse();
    }));

    it('should maintain selected engine if it exists in fetched engines', fakeAsync(() => {
      component.config.projectId = 'project';
      component.config.selectedEngine = 'engine2';

      const mockEngines: Engine[] = [
        {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
        {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
      ];

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(Promise.resolve(mockEngines));

      component.fetchEngines();
      tick();

      expect(component.config.selectedEngine).toBe('engine2');
    }));

    it('should fallback to first engine if selected engine does not exist in fetched engines', fakeAsync(() => {
      component.config.projectId = 'project';
      component.config.selectedEngine = 'non-existent';

      const mockEngines: Engine[] = [
        {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
        {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
      ];

      mockEvalBackendService.fetchEnginesSpy.and.returnValue(Promise.resolve(mockEngines));

      component.fetchEngines();
      tick();

      expect(component.config.selectedEngine).toBe('engine1');
    }));
  });

  describe('onEngineChange', () => {
    it('should update models based on selected engine and include defaults', () => {
      component.engines = [{
        name: 'engine1',
        displayName: 'Engine 1',
        modelConfigs: {
          'custom-model': 'MODEL_ENABLED',
          'disabled-model': 'MODEL_DISABLED'
        }
      }];
      component.config.selectedEngine = 'engine1';

      component.onEngineChange();

      expect(component.models).toContain('auto');
      expect(component.models).toContain('custom-model');
      expect(component.models).not.toContain('disabled-model');
      expect(component.config.selectedModel).toBe('auto');
    });

    it('should clear selectedDataStores upon switching engines in onEngineChange', () => {
      component.engines = [{
        name: 'engine1',
        displayName: 'Engine 1',
        dataStoreIds: ['ds1', 'ds2']
      }];
      component.config.selectedEngine = 'engine1';
      component.config.selectedDataStores = ['ds1', 'ds3'];

      component.onEngineChange();

      expect(component.config.selectedDataStores).toEqual([]);
    });

    it('should include gemini-2.5-pro and gemini-3.5-flash as fallbacks if they are not in modelConfigs',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         component.engines = [{
           name: 'engine1',
           displayName: 'Engine 1',
           modelConfigs: {}
         }];
         component.config.selectedEngine = 'engine1';

         component.onEngineChange();

         expect(component.models).toContain('auto');
         expect(component.models).toContain('gemini-2.5-pro');
         expect(component.models).toContain('gemini-3.5-flash');
       });

    it('should not add fallback model if it is in modelConfigs as MODEL_DISABLED',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         component.engines = [{
           name: 'engine1',
           displayName: 'Engine 1',
           modelConfigs: {
             'gemini-2.5-pro': 'MODEL_DISABLED'
           }
         }];
         component.config.selectedEngine = 'engine1';

         component.onEngineChange();

         expect(component.models).not.toContain('gemini-2.5-pro');
         expect(component.models).toContain('gemini-3.5-flash');
       });

    it('should not duplicate fallback model if it is already in modelConfigs as MODEL_ENABLED',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         component.engines = [{
           name: 'engine1',
           displayName: 'Engine 1',
           modelConfigs: {
             'gemini-2.5-pro': 'MODEL_ENABLED'
           }
         }];
         component.config.selectedEngine = 'engine1';

         component.onEngineChange();

         const proOccurrences = component.models.filter(m => m === 'gemini-2.5-pro').length;
         expect(proOccurrences).toBe(1);
       });
  });

  describe('canProceed', () => {
    beforeEach(() => {
      mockAuthService.showCredentialInputs = false;
      component.engines = [{name: 'engine', displayName: 'Engine', modelConfigs: {}}];
    });

    it('should return false if any required field is missing', () => {
      component.config = {
        projectId: '',
        region: 'global',
        selectedEngine: 'engine',
        selectedModel: 'model',
        autoRaterModel: 'gemini-3.1-pro-preview',
        autoRaterInstruction: '',
        selectedDataStores: [],
        enableWebSearch: false
      };
      expect(component.canProceed()).toBeFalsy();

      component.config.projectId = 'project';
      component.config.selectedEngine = '';
      expect(component.canProceed()).toBeFalsy();

      component.config.selectedEngine = 'engine';
      component.config.selectedModel = '';
      expect(component.canProceed()).toBeFalsy();
    });

    it('should return true if all required fields are present in WIF mode', () => {
      component.config = {
        projectId: 'project',
        region: 'global',
        selectedEngine: 'engine',
        selectedModel: 'model',
        autoRaterModel: 'gemini-3.1-pro-preview',
        autoRaterInstruction: 'Rate the response against the golden answer.',
        selectedDataStores: [],
        enableWebSearch: false
      };

      expect(component.canProceed()).toBeTruthy();
    });

    describe('with credential inputs enabled (API Key mode)', () => {
      beforeEach(() => {
        mockAuthService.showCredentialInputs = true;
      });

      describe('when isRunQueries is true (Run Queries)', () => {
        beforeEach(() => {
          component.isRunQueries = true;
        });
        it('should require gCloudToken', () => {
          component.config = {
            projectId: 'project',
            region: 'global',
            selectedEngine: 'engine',
            selectedModel: 'model',
            autoRaterModel: 'gemini-3.1-pro-preview',
            autoRaterInstruction: '',
            selectedDataStores: [],
            enableWebSearch: false,
            gCloudToken: ''
          };

          expect(component.canProceed()).toBeFalsy();

          component.config.gCloudToken = 'token';
          expect(component.canProceed()).toBeTruthy();
        });
      });
      describe('when isRunQueries is false (Run Evaluation)', () => {
        beforeEach(() => {
          component.isRunQueries = false;
        });
        it('should require gCloudToken', () => {
          component.config = {
            projectId: 'project',
            region: 'global',
            selectedEngine: 'engine',
            selectedModel: 'model',
            autoRaterModel: 'gemini-3.5-flash',
            autoRaterInstruction: 'Rate the response against the golden answer.',
            selectedDataStores: [],
            enableWebSearch: false,
            gCloudToken: ''
          };

          expect(component.canProceed()).toBeFalsy();

          component.config.gCloudToken = 'token';
          expect(component.canProceed()).toBeTruthy();
        });
      });
    });
  });

  describe('onConfigChange', () => {
    it('should call stateService.setConfig', () => {
      component.config.projectId = 'new-project';
      component.onConfigChange();

      expect(mockStateService.setConfig).toHaveBeenCalledWith(component.config);
    });
  });

  describe('onNext', () => {
    it('should save config and emit next event', () => {
      spyOn(component.next, 'emit');

      component.onNext();

      expect(mockStateService.setConfig).toHaveBeenCalledWith(component.config);
      expect(component.next.emit).toHaveBeenCalled();
    });
  });

  describe('initialization', () => {
    it('should initialize autoRaterModels with hard-coded values', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      expect(component.autoRaterModels).toEqual([
        'gemini-3.1-pro-preview', 'gemini-3.5-flash'
      ]);
    });

    it('should default autoRaterModel to the first available model if empty', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      // Trigger ngOnInit which subscribes to config$
      fixture.detectChanges();

      expect(component.config.autoRaterModel).toBe('gemini-3.5-flash');
      expect(mockStateService.setConfig).toHaveBeenCalled();
    });

    it('should not overwrite autoRaterModel if it is already a valid model',
       () => {
         configSubject.next({
           gCloudToken: '',
           projectId: '',
           region: 'global',
           selectedEngine: '',
           selectedModel: '',
           autoRaterModel: 'gemini-3.5-flash',
           autoRaterInstruction: '',
           selectedDataStores: [],
           enableWebSearch: false
         });

         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         fixture.detectChanges();

         expect(component.config.autoRaterModel).toBe('gemini-3.5-flash');
       });

    it('should clear autoRaterModel when no model is offered', () => {
      mockStateService.setConfig.calls.reset();
      component.autoRaterModels = [];

      configSubject.next(
          {...configSubject.value, autoRaterModel: 'gemini-3.5-flash'});

      // Cleared rather than kept, so validation flags it instead of a run
      // using a model the user can neither see nor change.
      expect(component.config.autoRaterModel).toBe('');
      expect(mockStateService.setConfig)
          .toHaveBeenCalledWith(jasmine.objectContaining({autoRaterModel: ''}));
    });

    it('should fetch connectors if selectedEngine changes in config$', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      spyOn(component, 'fetchConnectorsForSelectedEngine');

      // Set engines so updateModelsForSelectedEngine and fetchConnectors can
      // run
      enginesSubject.next([{name: 'engine-1', displayName: 'Engine 1'}]);
      fixture.detectChanges();

      expect(component.fetchConnectorsForSelectedEngine).not.toHaveBeenCalled();

      configSubject.next({
        gCloudToken: 'token',
        projectId: 'project',
        region: 'global',
        selectedEngine: 'engine-1',
        selectedModel: 'auto',
        autoRaterModel: 'gemini-3.1-pro-preview',
        autoRaterInstruction: '',
        selectedDataStores: [],
        enableWebSearch: false
      });

      expect(component.fetchConnectorsForSelectedEngine).toHaveBeenCalled();
    });
  });

  describe('fetchConnectorsForSelectedEngine & Option 1 Connector Grouping', () => {
    it('should parse collectionComponents from widget data and group entityIds under each connector', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          {
            id: 'jira-connector',
            displayName: 'Jira Cloud',
            dataSource: 'JIRA',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/jira',
            connectorAuthState: {
              authState: 'AUTHORIZED',
              authorizationUri: 'https://auth.example.com/jira'
            },
            dataStoreComponents: [
              {id: 'jira-issues-123'},
              {id: 'jira-wiki-456'}
            ]
          }
        ]
      };

      const parsed = component.parseWidgetDataForConnectors(mockWidgetData, {name: 'test-engine', displayName: 'Test Engine', dataStoreIds: ['native-ds-789']});
      expect(parsed.length).toBe(3); // Jira + native-ds-789 + Web Search
      expect(parsed[0].id).toBe('JIRA');
      expect(parsed[0].displayName).toBe('Jira Cloud');
      expect(parsed[0].entityIds).toEqual(['jira-issues-123', 'jira-wiki-456']);
      expect(parsed[0].searchableDataStoreIds).toEqual(['jira-issues-123', 'jira-wiki-456']);
      expect(parsed[1].id).toBe('native-ds-789');
      expect(parsed[1].searchableDataStoreIds).toEqual(['native-ds-789']);
      expect(parsed[2].id).toBe('Web Search');
      expect(parsed[2].searchableDataStoreIds).toEqual([]);
    });

    it('should group ServiceNow collection components under a single SERVICENOW connector option',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         const mockWidgetData: WidgetConfigResponse = {
           collectionComponents: [
             {
               id: 'Servicenow_hr',
               displayName: 'ServiceNow',
               dataStoreComponents: [{id: 'sn-hr-1'}]
             },
             {
               id: 'Catalog',
               displayName: 'Structured data (ServiceNow)',
               dataStoreComponents: [{id: 'sn-cat-2'}]
             },
             {
               id: 'Incident',
               displayName: 'Structured data (ServiceNow)',
               dataStoreComponents: [{id: 'sn-inc-3'}]
             },
             {
               id: 'Knowledge',
               displayName: 'Structured data (ServiceNow)',
               dataStoreComponents: [{id: 'sn-know-4'}]
             },
             {
               id: 'Users',
               displayName: 'Structured data (ServiceNow)',
               dataStoreComponents: [{id: 'sn-usr-5'}]
             },
             {
               id: 'Attachment',
               displayName: 'Unstructured data (ServiceNow)',
               dataStoreComponents: [{id: 'sn-att-6'}]
             }
           ]
         };

         const parsed =
             component.parseWidgetDataForConnectors(mockWidgetData, undefined);
         const serviceNowOption = parsed.find(c => c.id === 'SERVICENOW');
         expect(serviceNowOption).toBeDefined();
         expect(serviceNowOption!.displayName).toBe('ServiceNow');
         expect(serviceNowOption!.entityIds).toEqual([
           'sn-hr-1', 'sn-cat-2', 'sn-inc-3', 'sn-know-4', 'sn-usr-5',
           'sn-att-6'
         ]);
       });

    it('should toggle all entityIds simultaneously when toggleConnector is called', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const connectorOption = {
        id: 'jira-connector',
        displayName: 'Jira Cloud',
        entityIds: ['jira-issues-123', 'jira-wiki-456'],
        searchableDataStoreIds: ['jira-issues-123', 'jira-wiki-456']
      };

      component.config.selectedDataStores = [];
      component.toggleConnector(connectorOption);
      expect(component.config.selectedDataStores).toEqual(['jira-issues-123', 'jira-wiki-456']);
      expect(component.isConnectorSelected(connectorOption)).toBeTrue();

      component.toggleConnector(connectorOption);
      expect(component.config.selectedDataStores).toEqual([]);
      expect(component.isConnectorSelected(connectorOption)).toBeFalse();
    });

    it('should fetch connectors via GetWidgetConfig endpoint when all parameters are set', fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.projectId = 'project';
      component.config.region = 'global';
      component.config.selectedEngine = 'engine1';

      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          {
            id: 'jira-connector',
            displayName: 'Jira Cloud',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/jira',
            connectorAuthState: {
              authState: 'AUTHORIZED'
            },
            dataStoreComponents: [{id: 'ds-1'}]
          }
        ]
      };

      mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(Promise.resolve(mockWidgetData));
      component.fetchConnectorsForSelectedEngine();
      tick();

      expect(mockEvalBackendService.fetchWidgetConfigSpy).toHaveBeenCalledWith(
          'project', 'global', 'engine1', component.config);
      expect(component.connectors.length).toBe(2); // jira-connector + Web Search
      expect(mockStateService.setConnectors)
          .toHaveBeenCalledWith('engine1', component.connectors);
    }));

    it('should drop a widget config response for an engine that is no longer selected',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine = 'engineA';
         let resolveA: (data: unknown) => void = () => {};
         mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(
             new Promise(resolve => {
               resolveA = resolve;
             }));
         component.fetchConnectorsForSelectedEngine();

         // The user picks engine B before engine A's response arrives.
         component.config.selectedEngine = 'engineB';
         mockStateService.setConnectors.calls.reset();
         resolveA({
           collectionComponents: [{
             id: 'jira-connector',
             displayName: 'Jira Cloud',
             dataStoreComponents: [{id: 'engine-a-ds'}]
           }]
         });
         tick();

         expect(mockStateService.setConnectors).not.toHaveBeenCalled();
         expect(component.connectors.flatMap(c => c.entityIds))
             .not.toContain('engine-a-ds');
       }));

    it('should drop a widget config failure for an engine that is no longer selected',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine = 'engineA';
         let rejectA: (error: Error) => void = () => {};
         mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(
             new Promise((unusedResolve, reject) => {
               rejectA = reject;
             }));
         component.fetchConnectorsForSelectedEngine();

         component.config.selectedEngine = 'engineB';
         mockStateService.setConnectors.calls.reset();
         rejectA(new Error('slow failure'));
         tick();

         expect(mockStateService.setConnectors).not.toHaveBeenCalled();
       }));

    it('should fetch connectors using full resource path when selectedEngine starts with projects/',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine =
             'projects/project/locations/global/collections/default_collection/engines/engine1';

         mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(Promise.resolve({collectionComponents: []}));
         component.fetchConnectorsForSelectedEngine();
         tick();

         expect(mockEvalBackendService.fetchWidgetConfigSpy)
             .toHaveBeenCalledWith(
                 'project', 'global', 'projects/project/locations/global/collections/default_collection/engines/engine1', component.config);
       }));



    it('should treat connector auth states as the widget config API reports them', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      const component_ = (id: string, connectorAuthState?: ConnectorAuthState) => ({
        id,
        displayName: id,
        connectorAuthState,
        dataStoreComponents: [{id: `${id}-ds`}]
      });
      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          component_('no-auth-state'),
          component_('unspecified', {authorizationUri: 'https://auth.example.com'}),
          component_('authorized', {authState: 'AUTHORIZED'}),
          component_('no-auth', {authState: 'NO_AUTH'}),
          component_('actions-disabled', {authState: 'ACTIONS_DISABLED'}),
          component_('expired', {authState: 'EXPIRED'}),
        ]
      };

      const parsed = component.parseWidgetDataForConnectors(mockWidgetData, undefined);
      const searchable = (id: string) =>
          parsed.find(c => c.entityIds.includes(`${id}-ds`))
              ?.searchableDataStoreIds;

      expect(searchable('no-auth-state')).toEqual(['no-auth-state-ds']);
      expect(searchable('unspecified')).toEqual([]);
      expect(searchable('authorized')).toEqual(['authorized-ds']);
      expect(searchable('no-auth')).toEqual(['no-auth-ds']);
      expect(searchable('actions-disabled')).toEqual(['actions-disabled-ds']);
      expect(searchable('expired')).toEqual([]);
    });

    it('should not share the fallback connectors when the widget config is unavailable',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine = 'engine1';
         mockStateService.setConnectors.calls.reset();
         mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(
             Promise.resolve(null));

         component.fetchConnectorsForSelectedEngine();
         tick();

         expect(component.connectors.length).toBeGreaterThan(0);
         expect(mockStateService.setConnectors).not.toHaveBeenCalled();
       }));

    it('should not share the fallback connectors when the widget config request fails',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine = 'engine1';
         mockStateService.setConnectors.calls.reset();
         mockEvalBackendService.fetchWidgetConfigSpy.and.returnValue(
             Promise.reject(new Error('403')));

         component.fetchConnectorsForSelectedEngine();
         tick();

         expect(mockStateService.setConnectors).not.toHaveBeenCalled();
       }));

    it('should include all widget connectors without duplicate entity IDs from engine fallback', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          {
            id: 'jira-connector',
            displayName: 'Jira Cloud',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/jira',
            connectorAuthState: {
              authorizationUri: 'https://auth.example.com/jira'
            },
            dataStoreComponents: [{id: 'jira-issues-123'}]
          },
          {
            id: 'confluence-connector',
            displayName: 'Confluence Cloud',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/confluence',
            connectorAuthState: {
              authState: 'AUTHORIZED',
              authorizationUri: 'https://auth.example.com/confluence'
            },
            dataStoreComponents: [{id: 'confluence-wiki-456'}]
          }
        ]
      };

      const parsed = component.parseWidgetDataForConnectors(mockWidgetData, {
        name: 'test-engine',
        displayName: 'Test Engine',
        dataStoreIds: ['jira-issues-123', 'confluence-wiki-456', 'native-ds-789']
      });

      expect(parsed.length).toBe(4); // JIRA + CONFLUENCE + native-ds-789 + Web Search
      expect(parsed[0].id).toBe('JIRA');
      expect(parsed[0].searchableDataStoreIds).toEqual([]);
      expect(parsed[1].id).toBe('CONFLUENCE');
      expect(parsed[1].searchableDataStoreIds).toEqual(['confluence-wiki-456']);
      expect(parsed[2].id).toBe('native-ds-789');
      expect(parsed[3].id).toBe('Web Search');
    });

    it('should group multiple Notion collection components and Notion data stores under a single consolidated option', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          {
            id: 'notion-pages',
            displayName: 'Notion',
            dataSource: 'NOTION',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/notion',
            connectorAuthState: {
              authState: 'AUTHORIZED'
            },
            dataStoreComponents: [{id: 'notion-pages-ds-1'}]
          },
          {
            id: 'notion-databases',
            displayName: 'Notion Cloud',
            dataSource: 'NOTION',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/notion',
            connectorAuthState: {
              authState: 'EXPIRED',
              authorizationUri: 'https://auth.example.com/notion-refresh'
            },
            dataStoreComponents: [{id: 'notion-db-ds-2'}]
          }
        ]
      };

      const parsed = component.parseWidgetDataForConnectors(mockWidgetData, {
        name: 'test-engine',
        displayName: 'Test Engine',
        dataStoreIds: ['notion-pages-ds-1', 'notion-db-ds-2', 'notion_extra_ds_3']
      });

      expect(parsed.length).toBe(2); // Consolidated Notion + Web Search
      expect(parsed[0].id).toBe('NOTION');
      expect(parsed[0].displayName).toBe('Notion');
      expect(parsed[0].entityIds).toEqual(['notion-pages-ds-1', 'notion-db-ds-2', 'notion_extra_ds_3']);
      // The EXPIRED component's data store is left out; the engine data store
      // grouped under NOTION stays searchable.
      expect(parsed[0].searchableDataStoreIds)
          .toEqual(['notion-pages-ds-1', 'notion_extra_ds_3']);
      expect(parsed[1].id).toBe('Web Search');
    });

    it('should parse collection components with empty dataStoreComponents (e.g. unauthenticated Notion after auth removal)', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData: WidgetConfigResponse = {
        collectionComponents: [
          {
            id: 'collections/eua_placeholder_NOTION',
            displayName: 'Notion',
            dataSource: 'NOTION',
            connectorAuthState: {
              authorizationUri: 'https://auth.example.com/notion-auth'
            },
            dataStoreComponents: []
          }
        ]
      };

      const parsed = component.parseWidgetDataForConnectors(mockWidgetData, {
        name: 'test-engine',
        displayName: 'Test Engine',
        dataStoreIds: []
      });

      expect(parsed.length).toBe(2); // Notion + Web Search
      expect(parsed[0].id).toBe('NOTION');
      expect(parsed[0].displayName).toBe('Notion');
      expect(parsed[0].entityIds).toEqual(['collections/eua_placeholder_NOTION']);
      expect(parsed[0].searchableDataStoreIds).toEqual([]);
    });
  });

  describe('inferConnectorMetadata', () => {
    let component: ConfigFormComponent;

    beforeEach(() => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      component = fixture.componentInstance;
    });

    it('should infer normalized metadata when object has exact dataSource', () => {
      const meta = component.inferConnectorMetadata({dataSource: 'BIG_QUERY'});
      expect(meta).toEqual({key: 'BIG_QUERY', displayName: 'BigQuery', dataSource: 'BIG_QUERY'});
    });

    it('should infer normalized metadata when object has id or displayName with matching keywords', () => {
      const metaId = component.inferConnectorMetadata({id: 'my-test-confluence-123'});
      expect(metaId).toEqual({key: 'CONFLUENCE', displayName: 'Confluence', dataSource: 'CONFLUENCE'});

      const metaName = component.inferConnectorMetadata({displayName: 'Custom Cloud Storage Connector'});
      expect(metaName).toEqual({key: 'GCS', displayName: 'Cloud Storage', dataSource: 'GCS'});
    });

    it('should infer normalized metadata when input is string with matching keywords', () => {
      expect(component.inferConnectorMetadata('bq-prod-connector')).toEqual({key: 'BIG_QUERY', displayName: 'BigQuery', dataSource: 'BIG_QUERY'});
      expect(component.inferConnectorMetadata('salesforce-data')).toEqual({key: 'SALESFORCE', displayName: 'Salesforce', dataSource: 'SALESFORCE'});
    });

    it('should return fallback metadata for unknown objects and strings', () => {
      expect(component.inferConnectorMetadata({id: 'custom-ds', displayName: 'Custom Data Store'})).toEqual({key: 'custom-ds', displayName: 'Custom Data Store'});
      expect(component.inferConnectorMetadata('unknown-connector')).toEqual({key: 'unknown-connector', displayName: 'unknown-connector'});
    });
  });

  describe('changeConfigAndResetEngines', () => {
    it('should reset engines and clear selectedEngine / selectedModel when token, project ID, or region changes',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         // State where engines have been fetched
         component.engines =
             [{name: 'engine-1', displayName: 'Engine 1', modelConfigs: {}}];
         component.config = {
           gCloudToken: 'token-1',
           projectId: 'project-1',
           region: 'global',
           selectedEngine: 'engine-1',
           selectedModel: 'model-1',
           autoRaterModel: 'auto',
           autoRaterInstruction: 'instruction',
           selectedDataStores: [],
           enableWebSearch: false
         };

         // Changing config fields and triggering reset handler
         component.config.gCloudToken = 'token-2';
         component.config.projectId = 'project-2';
         component.config.region = 'us';
         component.changeConfigAndResetEngines();

         expect(component.engines).toEqual([]);
         expect(component.config.selectedEngine).toBe('');
         expect(component.config.selectedModel).toBe('');
         expect(component.config.gCloudToken).toBe('token-2');
         expect(component.config.projectId).toBe('project-2');
         expect(component.config.region).toBe('us');

         expect(mockStateService.setEngines).toHaveBeenCalledWith([]);
         expect(mockStateService.setConfig)
             .toHaveBeenCalledWith(component.config);
       });
  });

  describe('auth mode', () => {
    it('should pre-populate autoRaterModels with WIF models in ngOnInit when showCredentialInputs is false', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      const authService = TestBed.inject(AuthService) as MockAuthService;
      authService.showCredentialInputs = false;

      fixture.detectChanges();

      expect(component.autoRaterModels).toEqual(['gemini-3.5-flash', 'gemini-3.1-pro']);
      expect(component.config.autoRaterModel).toBe('gemini-3.5-flash');
    });

    it('should pre-populate autoRaterModels with default models in ngOnInit when showCredentialInputs is true', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      const authService = TestBed.inject(AuthService) as MockAuthService;
      authService.showCredentialInputs = true;

      fixture.detectChanges();

      expect(component.autoRaterModels).toEqual(['gemini-3.1-pro-preview', 'gemini-3.5-flash']);
      expect(component.config.autoRaterModel).toBe('gemini-3.1-pro-preview');
    });
  });
});
