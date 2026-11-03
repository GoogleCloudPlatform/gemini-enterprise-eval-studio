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

import {HttpClientTestingModule} from '@angular/common/http/testing';
import {TestBed, fakeAsync, tick} from '@angular/core/testing';
import {BehaviorSubject, of} from 'rxjs';

import {AppConfig} from '../../models/app-config.model';
import {CSVRow} from '../../models/csv-row.model';
import {ResultRow} from '../../models/result-row.model';
import {AuthService} from '../../services/auth.service';
import {CsvService} from '../../services/csv.service';
import {EvalBackendService} from '../../services/eval-backend.service';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {MockAuthService, MockEvalBackendService} from '../../testing/mocks';

import {RunQueriesComponent} from './run-queries.component';

describe('RunQueriesComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let mockEvalService: jasmine.SpyObj<EvalService>;
  let configSubject: BehaviorSubject<AppConfig>;

  beforeEach(async () => {
    configSubject = new BehaviorSubject<AppConfig>({
      gCloudToken: 'token',
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      autoRaterModel: '',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false,
    });

    mockStateService = jasmine.createSpyObj(
        'StateService',
        [
          'getCurrentConfig',
          'getEngines',
          'setResults',
          'setConfig',
          'setEngines',
          'setErrorMessage',
        ],
        {
          results$: of([]),
          config$: configSubject.asObservable(),
          engines$: of([]),
          errorMessage$: of(''),
        });
    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);
    mockStateService.getEngines.and.returnValue(
        [{name: 'engine', displayName: 'Engine', modelConfigs: {}}]);

    mockEvalService =
        jasmine.createSpyObj('EvalService', ['processRow', 'scoreAll']);

    await TestBed
        .configureTestingModule({
          imports: [RunQueriesComponent, HttpClientTestingModule],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: EvalService, useValue: mockEvalService},
            {provide: AuthService, useValue: new MockAuthService()},
            {
              provide: EvalBackendService,
              useValue: new MockEvalBackendService(),
            },
          ],
        })
        .compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(RunQueriesComponent);
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should run every row against the settings captured when the run started',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunQueriesComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const engines: Array<string|undefined> = [];
       mockEvalService.processRow.and.callFake(
           async (row, onProgress, session, config) => {
             engines.push(config?.selectedEngine);
             // The settings change while the run is in flight.
             configSubject.next(
                 {...configSubject.value, selectedEngine: 'edited-engine'});
             return {
               query: row.query,
               golden: '',
               fetched: 'fetched',
               ttft: 0,
               ttfa: 0,
               ttlt: 0,
               scorerResults: [],
             };
           });

       component.startResponseGeneration({
         file: new File([], 'test.csv'),
         rows: [{query: 'q1'}, {query: 'q2'}, {query: 'q3'}],
       });
       tick();

       expect(engines).toEqual(['engine', 'engine', 'engine']);
       expect(component.responseResults.length).toBe(3);
     }));

  it('should lock the settings form only while a run is in progress',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunQueriesComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();
       const fieldset = () =>
           (fixture.nativeElement as HTMLElement)
               .querySelector('app-config-form fieldset') as HTMLFieldSetElement;

       let finishRow!: () => void;
       mockEvalService.processRow.and.callFake(
           (row) => new Promise<ResultRow>(resolve => {
             finishRow = () => resolve({
               query: row.query,
               golden: '',
               fetched: 'fetched',
               ttft: 0,
               ttfa: 0,
               ttlt: 0,
               scorerResults: [],
             });
           }));

       expect(fieldset().disabled).toBeFalse();

       component.startResponseGeneration(
           {file: new File([], 'test.csv'), rows: [{query: 'q1'}]});
       tick();
       fixture.detectChanges();
       expect(fieldset().disabled).toBeTrue();

       finishRow();
       tick();
       fixture.detectChanges();
       expect(fieldset().disabled).toBeFalse();
     }));

  it('should map errorCode onto responseResults, highlight SKIPPED and error rows, and export Error Code to CSV',
     fakeAsync(() => {
       const csvService = TestBed.inject(CsvService);
       const exportSpy =
           spyOn(csvService, 'exportCSV').and.callFake(() => {});

       const fixture = TestBed.createComponent(RunQueriesComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const mockResponses: Record<string, ResultRow> = {
         'Hi': {
           query: 'Hi',
           golden: '',
           fetched: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           errorCode: 'SKIPPED',
           ttft: 0,
           ttfa: 0,
           ttlt: 1.2,
           scorerResults: [],
         },
         'Normal query': {
           query: 'Normal query',
           golden: '',
           fetched: 'Valid response',
           errorCode: '',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: [],
         },
         'Failed query': {
           query: 'Failed query',
           golden: '',
           fetched: 'Error: HTTP error! status: 500 Internal Server Error',
           errorCode: 'HTTP_500',
           ttft: 0,
           ttfa: 0,
           ttlt: 0,
           scorerResults: [],
         },
       };

       mockEvalService.processRow.and.callFake(
           async (row: CSVRow) => mockResponses[row.query]);

       component.startResponseGeneration({
         file: new File([], 'queries.csv'),
         rows: [
           {query: 'Hi'},
           {query: 'Normal query'},
           {query: 'Failed query'},
         ],
       });
       tick();
       fixture.detectChanges();

       expect(component.responseResults.length).toBe(3);
       expect(component.responseResults[0]['errorCode']).toBe('SKIPPED');
       expect(component.responseResults[1]['errorCode']).toBe('');
       expect(component.responseResults[2]['errorCode']).toBe('HTTP_500');

       const rows = Array.from(
           fixture.nativeElement.querySelectorAll('tbody tr')) as
           HTMLTableRowElement[];
       expect(rows.length).toBe(3);

       expect(rows[0].classList.contains('bg-amber-50')).toBeTrue();
       expect(rows[0].classList.contains('!border-l-amber-500')).toBeTrue();

       expect(rows[1].classList.contains('bg-amber-50')).toBeFalse();
       expect(rows[1].classList.contains('bg-red-50')).toBeFalse();

       expect(rows[2].classList.contains('bg-red-50')).toBeTrue();
       expect(rows[2].classList.contains('!border-l-red-500')).toBeTrue();

       const buttons = Array.from(
           fixture.nativeElement.querySelectorAll('button')) as
           HTMLButtonElement[];
       const exportBtn =
           buttons.find(btn => btn.textContent?.trim() === 'Export CSV');
       expect(exportBtn).toBeDefined();
       exportBtn!.click();

       expect(exportSpy).toHaveBeenCalledTimes(1);
       const exportedData =
           exportSpy.calls.mostRecent().args[0] as Array<Record<string, unknown>>;
       expect(exportedData.length).toBe(3);
       expect(exportedData[0]['Error Code']).toBe('SKIPPED');
       expect(exportedData[1]['Error Code']).toBe('');
       expect(exportedData[2]['Error Code']).toBe('HTTP_500');
     }));
});
