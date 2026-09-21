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
import {ResultRow} from '../../models/result-row.model';
import {AuthService} from '../../services/auth.service';
import {EvalBackendService} from '../../services/eval-backend.service';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {MockAuthService, MockEvalBackendService} from '../../testing/mocks';

import {RunEvaluationComponent} from './run-evaluation.component';

describe('RunEvaluationComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let mockEvalService: jasmine.SpyObj<EvalService>;
  let mockAuthService: MockAuthService;
  let mockEvalBackendService: MockEvalBackendService;
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
      autoRaterModel: 'gemini-3.5-flash',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
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
          results$: resultsSubject.asObservable(),
          config$: configSubject.asObservable(),
          engines$: of([]),
          errorMessage$: of(''),
        });
    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);
    mockStateService.getEngines.and.returnValue([{name: 'engine', displayName: 'Engine', modelConfigs: {}}]);
    mockStateService.setResults.and.callFake((rows: ResultRow[]) => {
      resultsSubject.next(rows);
    });

    mockEvalService = jasmine.createSpyObj('EvalService', ['processRow', 'scoreResponse']);
    mockAuthService = new MockAuthService();
    mockEvalBackendService = new MockEvalBackendService();

    await TestBed
        .configureTestingModule({
          imports: [RunEvaluationComponent, HttpClientTestingModule],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: EvalService, useValue: mockEvalService},
            {provide: AuthService, useValue: mockAuthService},
            {provide: EvalBackendService, useValue: mockEvalBackendService}
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
        ttfa: 20,
        ttlt: 30,
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
        ttfa: 20,
        ttlt: 30,
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
           ttfa: 20,
           ttlt: 30,
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

  it('should process rows again after restarting evaluation', fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows =
           [{query: 'q1', golden: 'g1'}, {query: 'q2', golden: 'g2'}];

       let resolveFirstRow: (value: ResultRow) => void;
       const firstRowPromise = new Promise<ResultRow>((resolve) => {
         resolveFirstRow = resolve;
       });

       let rowCount = 0;
       mockEvalService.processRow.and.callFake(async (row, progressCb) => {
         rowCount++;
         if (rowCount === 1) {
           return firstRowPromise;
         }
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           ttfa: 20,
           ttlt: 30,
           score: 0.9
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       component.stopEvaluation();
       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});

       resolveFirstRow!({
         query: 'q1',
         golden: 'g1',
         fetched: 'fetched-q1',
         ttft: 10,
         ttfa: 20,
         ttlt: 30,
         score: 0.9
       });

       tick();

       expect(mockEvalService.processRow).toHaveBeenCalledTimes(4);
     }));

  it('should maintain original CSV row order even if requests complete out of order', fakeAsync(() => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const sampleRows = [
      {query: 'slow_row_1', golden: 'g1'},
      {query: 'fast_row_2', golden: 'g2'}
    ];

    let resolveSlowRow: (value: ResultRow) => void;
    const slowRowPromise = new Promise<ResultRow>((resolve) => {
      resolveSlowRow = resolve;
    });

    mockEvalService.processRow.and.callFake(async (row) => {
      if (row.query === 'slow_row_1') {
        return slowRowPromise;
      }
      return {
        query: 'fast_row_2',
        golden: 'g2',
        fetched: 'fetched-fast_row_2',
        ttft: 10,
        ttfa: 20,
        ttlt: 30,
        score: 0.9
      };
    });

    component.startEvaluation({file: new File([], 'test.csv'), rows: sampleRows});
    tick();

    resolveSlowRow!({
      query: 'slow_row_1',
      golden: 'g1',
      fetched: 'fetched-slow_row_1',
      ttft: 10,
      ttfa: 20,
      ttlt: 30,
      score: 0.9
    });
    tick();

    const lastCallResults = mockStateService.setResults.calls.mostRecent().args[0];
    expect(lastCallResults.length).toBe(2);
    expect(lastCallResults[0].query).toBe('slow_row_1');
    expect(lastCallResults[1].query).toBe('fast_row_2');
  }));

  it('should omit the session field for independent single-turn rows', fakeAsync(() => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    let capturedSession: string | undefined;
    mockEvalService.processRow.and.callFake(async (row, _progressCb, session) => {
      capturedSession = session;
      return {
        query: row.query,
        golden: row.golden,
        fetched: `fetched-${row.query}`,
        ttft: 10,
        ttfa: 20,
        ttlt: 30,
        score: 0.9
      };
    });

    component.startEvaluation(
        {file: new File([], 'test.csv'), rows: [{query: 'q1', golden: 'g1'}]});
    tick();

    expect(capturedSession).toBeUndefined();
    expect(resultsSubject.value[0].conversationId).toBeUndefined();
    expect(resultsSubject.value[0].turn).toBeUndefined();
  }));

  it('should run same-conversation turns sequentially, threading the returned session, and tag results with conversationId/turn',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows = [
         {query: 'turn1', golden: 'g1', conversationId: 'conv-a', turn: '1'},
         {query: 'turn2', golden: 'g2', conversationId: 'conv-a', turn: '2'},
       ];

       const calls: Array<{query: string; session?: string}> = [];
       mockEvalService.processRow.and.callFake(
           async (row, _progressCb, session) => {
             calls.push({query: row.query, session});
             return {
               query: row.query,
               golden: row.golden,
               fetched: `fetched-${row.query}`,
               ttft: 10,
               ttfa: 20,
               ttlt: 30,
               score: 0.9,
               session: `session-after-${row.query}`,
             };
           });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       // Both turns ran, in order, and turn 2 was given the session turn 1
       // returned rather than starting a fresh/unrelated session.
       expect(calls.map(c => c.query)).toEqual(['turn1', 'turn2']);
       expect(calls[0].session).toBeUndefined();
       expect(calls[1].session).toBe('session-after-turn1');

       const results = resultsSubject.value;
       expect(results[0].conversationId).toBe('conv-a');
       expect(results[0].turn).toBe(1);
       expect(results[1].conversationId).toBe('conv-a');
       expect(results[1].turn).toBe(2);
     }));

  it('should run independent conversations concurrently while keeping each internally sequential',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       // Two 2-turn conversations. Turn 2 of each conversation must never
       // start before turn 1 of that *same* conversation has resolved, but
       // the two conversations themselves may interleave freely.
       const sampleRows = [
         {query: 'a1', golden: 'g', conversationId: 'conv-a', turn: '1'},
         {query: 'b1', golden: 'g', conversationId: 'conv-b', turn: '1'},
         {query: 'a2', golden: 'g', conversationId: 'conv-a', turn: '2'},
         {query: 'b2', golden: 'g', conversationId: 'conv-b', turn: '2'},
       ];

       const startedBeforeFinished: Record<string, string[]> = {a2: [], b2: []};
       const finished = new Set<string>();

       mockEvalService.processRow.and.callFake(
           async (row, _progressCb, sessionContext) => {
             if (row.query === 'a2' || row.query === 'b2') {
               startedBeforeFinished[row.query] = [...finished];
             }
             await Promise.resolve();
             finished.add(row.query);
             return {
               query: row.query,
               golden: row.golden,
               fetched: `fetched-${row.query}`,
               ttft: 10,
               ttfa: 20,
               ttlt: 30,
               score: 0.9,
               session: `session-after-${row.query}`,
             };
           });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       // By the time turn 2 of a conversation starts, turn 1 of that SAME
       // conversation must have already finished.
       expect(startedBeforeFinished['a2']).toContain('a1');
       expect(startedBeforeFinished['b2']).toContain('b1');
     }));

  it('should sort unnumbered turns after numbered turns and mark them SKIPPED',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows = [
         {query: 'turn1', golden: 'g', conversationId: 'conv-1', turn: '1'},
         {query: 'unnumbered-a', golden: 'g', conversationId: 'conv-1'},
         {query: 'turn2', golden: 'g', conversationId: 'conv-1', turn: '2'},
         {query: 'unnumbered-b', golden: 'g', conversationId: 'conv-1'},
       ];

       const executionOrder: string[] = [];
       mockEvalService.processRow.and.callFake(async (row) => {
         executionOrder.push(row.query);
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           ttfa: 20,
           ttlt: 30,
           score: 0.9,
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['turn1', 'turn2']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => r.fetched)).toEqual([
         'fetched-turn1',
         'fetched-turn2',
         'SKIPPED: Incorrect or missing turn ID.',
         'SKIPPED: Incorrect or missing turn ID.',
       ]);
     }));

  it('should preserve 0-indexed turn numbers in sorting and results',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows = [
         {query: 'turn1', golden: 'g', conversationId: 'conv-0', turn: '1'},
         {query: 'turn0', golden: 'g', conversationId: 'conv-0', turn: '0'},
       ];

       const executionOrder: string[] = [];
       mockEvalService.processRow.and.callFake(async (row) => {
         executionOrder.push(row.query);
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           ttfa: 20,
           ttlt: 30,
           score: 0.9,
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['turn0', 'turn1']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => r.turn)).toEqual([0, 1]);
     }));

  it('should sort non-numeric turn strings last and mark them SKIPPED',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows = [
         {query: 'invalid-foo', golden: 'g', conversationId: 'conv-1', turn: 'foo'},
         {query: 'turn1', golden: 'g', conversationId: 'conv-1', turn: '1'},
         {query: 'invalid-bar', golden: 'g', conversationId: 'conv-1', turn: 'bar'},
       ];

       const executionOrder: string[] = [];
       mockEvalService.processRow.and.callFake(async (row) => {
         executionOrder.push(row.query);
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           ttfa: 20,
           ttlt: 30,
           score: 0.9,
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['turn1']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => r.fetched)).toEqual([
         'fetched-turn1',
         'SKIPPED: Incorrect or missing turn ID.',
         'SKIPPED: Incorrect or missing turn ID.',
       ]);
     }));

  it('should skip remaining turns in a conversation when consecutive turn numbering is broken or does not start at 0 or 1',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const sampleRows = [
         // Gap after turn 2: turn 3 is missing, so turn 4 and empty turn are skipped
         {query: 'c1-t1', golden: 'g', conversationId: 'conv-gap', turn: '1'},
         {query: 'c1-t2', golden: 'g', conversationId: 'conv-gap', turn: '2'},
         {query: 'c1-missing', golden: 'g', conversationId: 'conv-gap'},
         {query: 'c1-t4', golden: 'g', conversationId: 'conv-gap', turn: '4'},
         // Conversation starting at turn 2: all turns skipped
         {query: 'c2-t2', golden: 'g', conversationId: 'conv-bad-start', turn: '2'},
         {query: 'c2-t3', golden: 'g', conversationId: 'conv-bad-start', turn: '3'},
       ];

       const executionOrder: string[] = [];
       mockEvalService.processRow.and.callFake(async (row) => {
         executionOrder.push(row.query);
         return {
           query: row.query,
           golden: row.golden,
           fetched: `fetched-${row.query}`,
           ttft: 10,
           ttfa: 20,
           ttlt: 30,
           score: 0.9,
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['c1-t1', 'c1-t2']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => ({query: r.query, fetched: r.fetched})))
           .toEqual([
             {query: 'c1-t1', fetched: 'fetched-c1-t1'},
             {query: 'c1-t2', fetched: 'fetched-c1-t2'},
             {
               query: 'c1-t4',
               fetched: 'SKIPPED: Incorrect or missing turn ID.'
             },
             {
               query: 'c1-missing',
               fetched: 'SKIPPED: Incorrect or missing turn ID.'
             },
             {
               query: 'c2-t2',
               fetched: 'SKIPPED: Incorrect or missing turn ID.'
             },
             {
               query: 'c2-t3',
               fetched: 'SKIPPED: Incorrect or missing turn ID.'
             },
           ]);
     }));

  it('should exclude Conversation and Turn columns for single-turn datasets and include them immediately when input or results have multi-turn data',
     () => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       // Single-turn input and results: no conversationId or turn
       component.uploadedRows = [{query: 'q1', golden: 'g1'}];
       component.results = [];
       let columnKeys = component.columns.map(c => c.key);
       expect(columnKeys).not.toContain('conversationId');
       expect(columnKeys).not.toContain('turn');

       // Multi-turn input rows present before any results arrive (results = [])
       component.uploadedRows = [
         {query: 'q1', golden: 'g1', conversationId: 'conv-1', turn: '1'},
       ];
       component.results = [];
       columnKeys = component.columns.map(c => c.key);
       expect(columnKeys).toContain('conversationId');
       expect(columnKeys).toContain('turn');

       // Persisted multi-turn results when uploadedRows is empty
       component.uploadedRows = [];
       component.results = [
         {
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           score: 0.9,
           conversationId: 'conv-1',
           turn: 1,
         },
       ];
       columnKeys = component.columns.map(c => c.key);
       expect(columnKeys).toContain('conversationId');
       expect(columnKeys).toContain('turn');
     });
});

