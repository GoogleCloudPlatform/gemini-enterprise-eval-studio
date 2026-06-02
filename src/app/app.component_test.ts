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

import {TestBed} from '@angular/core/testing';
import {BehaviorSubject} from 'rxjs';

import {AppComponent} from './app.component';
import {AppConfig, Engine} from './models/app-config.model';
import {ResultRow} from './models/result-row.model';
import {StateService} from './services/state.service';

describe('AppComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let currentTabSubject: BehaviorSubject<string>;
  let resultsSubject: BehaviorSubject<ResultRow[]>;
  let configSubject: BehaviorSubject<AppConfig>;
  let enginesSubject: BehaviorSubject<Engine[]>;

  beforeEach(async () => {
    currentTabSubject = new BehaviorSubject<string>('run');
    resultsSubject = new BehaviorSubject<ResultRow[]>([]);
    configSubject = new BehaviorSubject<AppConfig>({
      gCloudToken: '',
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      geminiApiKey: '',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
    });
    enginesSubject = new BehaviorSubject<Engine[]>([]);
    mockStateService = jasmine.createSpyObj(
        'StateService', ['getCurrentConfig', 'getEngines'], {
          currentTab$: currentTabSubject.asObservable(),
          results$: resultsSubject.asObservable(),
          config$: configSubject.asObservable(),
          engines$: enginesSubject.asObservable()
        });
    mockStateService.getEngines.and.returnValue([]);
    mockStateService.getCurrentConfig.and.returnValue({
      gCloudToken: '',
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      geminiApiKey: '',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
    });

    await TestBed
        .configureTestingModule({
          imports: [AppComponent],
          providers: [{provide: StateService, useValue: mockStateService}]
        })
        .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as currentTab 'run'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    expect(app.currentTab).toEqual('run');
  });
});
