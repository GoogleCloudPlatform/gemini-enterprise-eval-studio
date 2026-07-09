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

import {HttpClient, HttpErrorResponse} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {BehaviorSubject, of, throwError} from 'rxjs';

import {AppConfig, Engine} from '../../../models/app-config.model';
import {StateService} from '../../../services/state.service';

import {ConfigFormComponent} from './config-form.component';

describe('ConfigFormComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let mockHttpClient: jasmine.SpyObj<HttpClient>;
  let configSubject: BehaviorSubject<AppConfig>;
  let enginesSubject: BehaviorSubject<Engine[]>;
  let errorMessageSubject: BehaviorSubject<string>;

  beforeEach(async () => {
    configSubject = new BehaviorSubject<AppConfig>({
      gCloudToken: '',
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
        ['setConfig', 'setEngines', 'getCurrentConfig', 'setErrorMessage'], {
          config$: configSubject.asObservable(),
          engines$: enginesSubject.asObservable(),
          errorMessage$: errorMessageSubject.asObservable()
        });

    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);

    mockHttpClient = jasmine.createSpyObj('HttpClient', ['get']);
    mockHttpClient.get.and.returnValue(of({}));

    await TestBed
        .configureTestingModule({
          imports: [ConfigFormComponent],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: HttpClient, useValue: mockHttpClient}
          ]
        })
        .compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ConfigFormComponent);
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  describe('fetchEngines', () => {
    it('should set error message if token or project ID is missing', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = '';
      component.config.projectId = '';

      component.fetchEngines();

      expect(component.errorMessage)
          .toBe('Please provide gCloud Token and Project ID');
    });

    it('should fetch engines successfully and auto-select first engine', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';
      component.config.region = 'global';

      const mockEnginesResponse = {
        engines: [
          {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
          {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
        ]
      };

      mockHttpClient.get.and.returnValue(of(mockEnginesResponse));

      component.fetchEngines();

      expect(mockHttpClient.get)
          .toHaveBeenCalledWith(
              'https://discoveryengine.googleapis.com/v1alpha/projects/project/locations/global/collections/default_collection/engines',
              jasmine.any(Object));
      expect(component.engines.length).toBe(2);
      expect(component.config.selectedEngine).toBe('engine1');
    });

    it('should use regional URL when region is not global', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';
      component.config.region = 'us-central1';

      mockHttpClient.get.and.returnValue(of({engines: []}));

      component.fetchEngines();

      expect(mockHttpClient.get)
          .toHaveBeenCalledWith(
              'https://us-central1-discoveryengine.googleapis.com/v1alpha/projects/project/locations/us-central1/collections/default_collection/engines',
              jasmine.any(Object));
    });

    it('should handle Error when fetching engines', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';

      mockHttpClient.get.and.returnValue(
          throwError(() => new Error('HTTP error')));

      component.fetchEngines();

      expect(component.errorMessage).toBe('Error fetching engines: HTTP error');
      expect(component.loading).toBeFalse();
    });

    it('should handle HttpErrorResponse when fetching engines', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';

      mockHttpClient.get.and.returnValue(
          throwError(() => new HttpErrorResponse({
            status: 403,
            error: {error: {message: 'Permission denied'}}
          })));

      component.fetchEngines();

      expect(component.errorMessage)
          .toBe('Error fetching engines: Permission denied');
      expect(component.loading).toBeFalse();
    });

    it('should maintain selected engine if it exists in fetched engines',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.gCloudToken = 'token';
         component.config.projectId = 'project';
         component.config.selectedEngine = 'engine2';

         const mockEnginesResponse = {
           engines: [
             {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
             {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
           ]
         };

         mockHttpClient.get.and.returnValue(of(mockEnginesResponse));

         component.fetchEngines();

         expect(component.config.selectedEngine).toBe('engine2');
       });

    it('should fallback to first engine if selected engine does not exist in fetched engines',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.gCloudToken = 'token';
         component.config.projectId = 'project';
         component.config.selectedEngine = 'non-existent';

         const mockEnginesResponse = {
           engines: [
             {name: 'engine1', displayName: 'Engine 1', modelConfigs: {}},
             {name: 'engine2', displayName: 'Engine 2', modelConfigs: {}}
           ]
         };

         mockHttpClient.get.and.returnValue(of(mockEnginesResponse));

         component.fetchEngines();

         expect(component.config.selectedEngine).toBe('engine1');
       });
  });

  describe('onEngineChange', () => {
    it('should update models based on selected engine and include defaults',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

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

    it('should clear selectedDataStores upon switching engines in onEngineChange',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

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
    it('should return false if base fields are missing', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      component.config = {
        gCloudToken: '',
        projectId: '',
        region: 'global',
        selectedEngine: '',
        selectedModel: '',
        autoRaterModel: 'gemini-3.1-pro-preview',
        autoRaterInstruction: '',
        selectedDataStores: [],
        enableWebSearch: false
      };

      expect(component.canProceed()).toBeFalsy();
    });

    it('should return true if base fields are present and isRunQueries is true',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.isRunQueries = true;

         component.config = {
           gCloudToken: 'token',
           projectId: 'project',
           region: 'global',
           selectedEngine: 'engine',
           selectedModel: 'model',
           autoRaterModel: 'gemini-3.1-pro-preview',
           autoRaterInstruction: '',
           selectedDataStores: [],
           enableWebSearch: false
         };

         expect(component.canProceed()).toBeTruthy();
       });


    it('should return true if all fields are present and isRunQueries is false',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.isRunQueries = false;

         component.config = {
           gCloudToken: 'token',
           projectId: 'project',
           region: 'global',
           selectedEngine: 'engine',
           selectedModel: 'model',
           autoRaterModel: 'gemini-3.1-pro-preview',
           autoRaterInstruction: '',
           selectedDataStores: [],
           enableWebSearch: false
         };

         expect(component.canProceed()).toBeTruthy();
       });

    it('should return false if autoRaterModel is missing and isRunQueries is false',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.isRunQueries = false;

         component.config = {
           gCloudToken: 'token',
           projectId: 'project',
           region: 'global',
           selectedEngine: 'engine',
           selectedModel: 'model',
           autoRaterModel: '',
           autoRaterInstruction: '',
           selectedDataStores: [],
           enableWebSearch: false
         };

         expect(component.canProceed()).toBeFalsy();
       });
  });

  describe('onConfigChange', () => {
    it('should call stateService.setConfig', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      component.config.projectId = 'new-project';
      component.onConfigChange();

      expect(mockStateService.setConfig).toHaveBeenCalledWith(component.config);
    });
  });

  describe('onNext', () => {
    it('should save config and emit next event', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
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

      expect(component.config.autoRaterModel).toBe('gemini-3.1-pro-preview');
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
  });

  describe('fetchConnectorsForSelectedEngine & Option 1 Connector Grouping', () => {
    it('should parse collectionComponents from widget data and group entityIds under each connector', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData = {
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
      expect(parsed[1].id).toBe('native-ds-789');
      expect(parsed[2].id).toBe('Web Search');
    });

    it('should group ServiceNow collection components under a single SERVICENOW connector option',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;

         const mockWidgetData = {
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
        entityIds: ['jira-issues-123', 'jira-wiki-456']
      };

      component.config.selectedDataStores = [];
      component.toggleConnector(connectorOption);
      expect(component.config.selectedDataStores).toEqual(['jira-issues-123', 'jira-wiki-456']);
      expect(component.isConnectorSelected(connectorOption)).toBeTrue();

      component.toggleConnector(connectorOption);
      expect(component.config.selectedDataStores).toEqual([]);
      expect(component.isConnectorSelected(connectorOption)).toBeFalse();
    });

    it('should fetch connectors via GetWidgetConfig endpoint when all parameters are set', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';
      component.config.region = 'global';
      component.config.selectedEngine = 'engine1';

      const mockWidgetData = {
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

      mockHttpClient.get.and.returnValue(of(mockWidgetData));
      component.fetchConnectorsForSelectedEngine();

      expect(mockHttpClient.get).toHaveBeenCalledWith(
          'https://discoveryengine.googleapis.com/v1alpha/projects/project/locations/global/collections/default_collection/engines/engine1/widgetConfigs/default_search_widget_config',
          jasmine.any(Object));
      expect(component.connectors.length).toBe(2); // jira-connector + Web Search
    });

    it('should fetch connectors using full resource path when selectedEngine starts with projects/',
       () => {
         const fixture = TestBed.createComponent(ConfigFormComponent);
         const component = fixture.componentInstance;
         component.config.gCloudToken = 'token';
         component.config.projectId = 'project';
         component.config.region = 'global';
         component.config.selectedEngine =
             'projects/project/locations/global/collections/default_collection/engines/engine1';

         mockHttpClient.get.and.returnValue(of({collectionComponents: []}));
         component.fetchConnectorsForSelectedEngine();

         expect(mockHttpClient.get)
             .toHaveBeenCalledWith(
                 'https://discoveryengine.googleapis.com/v1alpha/projects/project/locations/global/collections/default_collection/engines/engine1/widgetConfigs/default_search_widget_config',
                 jasmine.any(Object));
       });


    it('should include all widget connectors without duplicate entity IDs from engine fallback', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData = {
        collectionComponents: [
          {
            id: 'jira-connector',
            displayName: 'Jira Cloud',
            federatedSearchConnectorAuthUri: 'https://auth.example.com/jira',
            connectorAuthState: {
              authState: 'NOT_AUTHORIZED',
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
      expect(parsed[1].id).toBe('CONFLUENCE');
      expect(parsed[2].id).toBe('native-ds-789');
      expect(parsed[3].id).toBe('Web Search');
    });

    it('should group multiple Notion collection components and Notion data stores under a single consolidated option', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData = {
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
      expect(parsed[1].id).toBe('Web Search');
    });

    it('should parse collection components with empty dataStoreComponents (e.g. unauthenticated Notion after auth removal)', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;

      const mockWidgetData = {
        collectionComponents: [
          {
            id: 'collections/eua_placeholder_NOTION',
            displayName: 'Notion',
            dataSource: 'NOTION',
            connectorAuthState: {
              authState: 'NOT_AUTHORIZED',
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
});
