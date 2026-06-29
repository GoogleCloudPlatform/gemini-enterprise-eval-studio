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
import {BehaviorSubject, of} from 'rxjs';

import {AppConfig} from '../../models/app-config.model';
import {ResultRow} from '../../models/result-row.model';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';

import {RunEvaluationComponent} from './run-evaluation.component';

describe('RunEvaluationComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let mockEvalService: jasmine.SpyObj<EvalService>;
  let resultsSubject: BehaviorSubject<ResultRow[]>;
  let configSubject: BehaviorSubject<AppConfig>;

  beforeEach(async () => {
    resultsSubject = new BehaviorSubject<ResultRow[]>([]);
    configSubject = new BehaviorSubject<AppConfig>({
      gCloudToken: 'token',
      projectId: 'project',
      region: 'global',
      selectedEngine: 'engine',
      selectedModel: 'model',
      geminiApiKey: 'apikey',
      autoRaterModel: 'gemini-3.5-flash',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
    });

    mockStateService = jasmine.createSpyObj(
        'StateService',
        ['getCurrentConfig', 'getEngines', 'setResults', 'setConfig', 'setEngines'], {
          results$: resultsSubject.asObservable(),
          config$: configSubject.asObservable(),
          engines$: of([]),
        });
    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);
    mockStateService.getEngines.and.returnValue([{name: 'engine', displayName: 'Engine', modelConfigs: {}}]);
    mockStateService.setResults.and.callFake((rows: ResultRow[]) => {
      resultsSubject.next(rows);
    });

    mockEvalService = jasmine.createSpyObj('EvalService', ['processRow', 'scoreResponse']);

    await TestBed
        .configureTestingModule({
          imports: [RunEvaluationComponent],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: EvalService, useValue: mockEvalService}
          ]
        })
        .compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    expect(component).toBeTruthy();
  });

  it('should build results dynamically one row at a time in startEvaluation', fakeAsync(() => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const sampleRows = [
      {query: 'q1', golden: 'g1'},
      {query: 'q2', golden: 'g2'}
    ];

    mockEvalService.processRow.and.callFake(async (row, progressCb) => {
      return {
        query: row.query,
        golden: row.golden,
        fetched: `fetched-${row.query}`,
        ttft: 10,
        tfuft: 20,
        latency: 30,
        score: 0.9
      };
    });

    component.startEvaluation({file: new File([], 'test.csv'), rows: sampleRows});
    tick();

    expect(component.step).toBe(3);
    expect(mockStateService.setResults).toHaveBeenCalled();
    expect(component.completedRows).toBe(2);
    expect(component.isProcessing).toBeFalse();
  }));

  it('should stop evaluation mid-way when stopEvaluation is called', fakeAsync(() => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const sampleRows = [
      {query: 'q1', golden: 'g1'},
      {query: 'q2', golden: 'g2'}
    ];

    let rowCount = 0;
    mockEvalService.processRow.and.callFake(async (row, progressCb) => {
      rowCount++;
      if (rowCount === 2) {
        component.stopEvaluation();
      }
      return {
        query: row.query,
        golden: row.golden,
        fetched: `fetched-${row.query}`,
        ttft: 10,
        tfuft: 20,
        latency: 30,
        score: 0.9
      };
    });

    component.startEvaluation({file: new File([], 'test.csv'), rows: sampleRows});
    tick();

    expect(component.completedRows).toBe(0);
    expect(component.isProcessing).toBeFalse();
  }));

  it('should not run evaluation concurrently if called again while processing',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows =
           [{query: 'q1', golden: 'g1'}, {query: 'q2', golden: 'g2'}];

       mockEvalService.processRow.and.callFake(async (row, progressCb) => {
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           tfuft: 20,
           latency: 30,
           score: 0.9
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(mockEvalService.processRow).toHaveBeenCalledTimes(2);
       expect(component.completedRows).toBe(2);
     }));
});

