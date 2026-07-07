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

import {HttpClient} from '@angular/common/http';
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

    mockStateService = jasmine.createSpyObj(
        'StateService', ['setConfig', 'setEngines', 'getCurrentConfig'], {
          config$: configSubject.asObservable(),
          engines$: enginesSubject.asObservable()
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

    it('should handle HTTP error when fetching engines', () => {
      const fixture = TestBed.createComponent(ConfigFormComponent);
      const component = fixture.componentInstance;
      component.config.gCloudToken = 'token';
      component.config.projectId = 'project';

      mockHttpClient.get.and.returnValue(
          throwError(() => new Error('HTTP error')));

      component.fetchEngines();

      expect(component.errorMessage)
          .toBe('Error fetching engines. See console for details.');
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

    it('should filter selectedDataStores to only include those belonging to the selected engine',
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

         expect(component.config.selectedDataStores).toEqual(['ds1']);
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
});
