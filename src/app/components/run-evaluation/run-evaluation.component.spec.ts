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
import {ComponentFixture, TestBed, fakeAsync, tick} from '@angular/core/testing';
import {BehaviorSubject, of} from 'rxjs';

import {AppConfig} from '../../models/app-config.model';
import {ResultRow, TRACE_COLUMN_TOOLTIP} from '../../models/result-row.model';
import {ScoreResult, Scorer, ScorerRunResult, ScoringRequest} from '../../scoring/scorer';
import {SCORERS} from '../../scoring/scorer.registry';
import {AuthService} from '../../services/auth.service';
import {CsvService} from '../../services/csv.service';
import {EvalBackendService} from '../../services/eval-backend.service';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {MockAuthService, MockEvalBackendService} from '../../testing/mocks';

import {RunEvaluationComponent} from './run-evaluation.component';

/**
 * A scorer whose identity and config keys are test controlled.
 *
 * Declared at module scope, as the other scorer tests do. Subclassing `Scorer`
 * inside a `describe` body leaves the base class uninitialized in the external
 * Vitest build, which fails with `Class extends value undefined`.
 */
class FakeScorer extends Scorer {
  constructor(
      readonly id: string, readonly displayName: string,
      override readonly configKeys: ReadonlyArray<keyof AppConfig> = []) {
    super();
  }

  async score(request: ScoringRequest): Promise<ScoreResult> {
    return {score: 1};
  }
}

/** The per-scorer results of a row scored by a single scorer. */
function scored(score: number): ScorerRunResult[] {
  return [{scorerId: 'first', displayName: 'First', score}];
}

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

    mockEvalService =
        jasmine.createSpyObj('EvalService', ['processRow', 'scoreAll']);
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
        scorerResults: []
      };
    });

    component.startEvaluation({file: new File([], 'test.csv'), rows: sampleRows});
    tick();

    expect(component.step).toBe(3);
    expect(mockStateService.setResults).toHaveBeenCalled();
    expect(component.completedRows).toBe(2);
    expect(component.isProcessing).toBeFalse();
  }));

  it('should run every row against the settings captured when the run started',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
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
           golden: row.golden,
           fetched: 'fetched',
           ttft: 0,
           ttfa: 0,
           ttlt: 0,
           scorerResults: []
         };
       });

       component.startEvaluation({
         file: new File([], 'test.csv'),
         rows: [
           {query: 'q1', golden: 'g1'}, {query: 'q2', golden: 'g2'},
           {query: 'q3', golden: 'g3'}
         ]
       });
       tick();

       expect(engines).toEqual(['engine', 'engine', 'engine']);
     }));

  it('should lock the settings form only while a run is in progress',
     fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();
       const element = fixture.nativeElement as HTMLElement;
       const fieldset = () => element.querySelector(
                                  'app-config-form fieldset') as HTMLFieldSetElement;
       const notice = () =>
           element.querySelector('[data-test-id="config-form-locked-notice"]');

       expect(fieldset().disabled).toBeFalse();
       expect(notice()).toBeNull();

       let finishRow!: (result: ResultRow) => void;
       mockEvalService.processRow.and.returnValue(
           new Promise<ResultRow>(resolve => {
             finishRow = resolve;
           }));
       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: [{query: 'q1', golden: 'g1'}]});
       tick();
       fixture.detectChanges();

       expect(fieldset().disabled).toBeTrue();
       expect(notice()).not.toBeNull();

       finishRow({
         query: 'q1',
         golden: 'g1',
         fetched: 'fetched',
         ttft: 0,
         ttfa: 0,
         ttlt: 0,
         scorerResults: []
       });
       tick();
       fixture.detectChanges();

       expect(fieldset().disabled).toBeFalse();
       expect(notice()).toBeNull();
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
        scorerResults: []
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
           scorerResults: []
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
           scorerResults: []
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
         scorerResults: []
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
        scorerResults: []
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
      scorerResults: []
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
        scorerResults: scored(0.9)
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
               scorerResults: scored(0.9),
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
               scorerResults: scored(0.9),
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

  it('should sort unnumbered turns after numbered turns and mark them INVALID_TURN_ID',
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
           scorerResults: scored(0.9),
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
         'INVALID_TURN_ID: Incorrect or missing turn ID.',
         'INVALID_TURN_ID: Incorrect or missing turn ID.',
       ]);
       expect(finalResults[2].errorCode).toBe('INVALID_TURN_ID');
       expect(finalResults[3].errorCode).toBe('INVALID_TURN_ID');
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
           scorerResults: scored(0.9),
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['turn0', 'turn1']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => r.turn)).toEqual([0, 1]);
     }));

  it('should sort non-numeric turn strings last and mark them INVALID_TURN_ID',
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
           scorerResults: scored(0.9),
         };
       });

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: sampleRows});
       tick();

       expect(executionOrder).toEqual(['turn1']);
       const finalResults = resultsSubject.value;
       expect(finalResults.map(r => r.fetched)).toEqual([
         'fetched-turn1',
         'INVALID_TURN_ID: Incorrect or missing turn ID.',
         'INVALID_TURN_ID: Incorrect or missing turn ID.',
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
           scorerResults: scored(0.9),
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
               fetched: 'INVALID_TURN_ID: Incorrect or missing turn ID.'
             },
             {
               query: 'c1-missing',
               fetched: 'INVALID_TURN_ID: Incorrect or missing turn ID.'
             },
             {
               query: 'c2-t2',
               fetched: 'INVALID_TURN_ID: Incorrect or missing turn ID.'
             },
             {
               query: 'c2-t3',
               fetched: 'INVALID_TURN_ID: Incorrect or missing turn ID.'
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
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.9),
           conversationId: 'conv-1',
           turn: 1,
         },
       ];
       columnKeys = component.columns.map(c => c.key);
       expect(columnKeys).toContain('conversationId');
       expect(columnKeys).toContain('turn');
     });

  it('should report the first scorer failure of a run', fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       mockEvalService.processRow.and.callFake(async row => ({
                                                 query: row.query,
                                                 golden: row.golden ?? '',
                                                 fetched: 'f',
                                                 ttft: 1,
                                                 ttfa: 2,
                                                 ttlt: 3,
                                                 scorerResults: [{
                                                   scorerId: 'first',
                                                   displayName: 'First',
                                                   score: 0,
                                                   error: 'boom'
                                                 }]
                                               }));

       component.startEvaluation(
           {file: new File([], 'test.csv'), rows: [{query: 'q', golden: 'g'}]});
       tick();

       expect(component.errorMessage)
           .toBe('Scoring failed for some rows: boom');
     }));

  it('should finish a run whose first row has a row error', fakeAsync(() => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       fixture.detectChanges();

       const outOfRange: ScorerRunResult = {
         scorerId: 'first',
         displayName: 'First',
         score: 0,
         error: 'Score 2026 is outside the 0.0 to 1.0 range.',
         rowError: true,
       };
       mockEvalService.processRow.and.callFake(async row => ({
                                                 query: row.query,
                                                 golden: row.golden ?? '',
                                                 fetched: 'f',
                                                 ttft: 1,
                                                 ttfa: 2,
                                                 ttlt: 3,
                                                 scorerResults: row.query === 'q1' ?
                                                     [outOfRange] :
                                                     [{
                                                       scorerId: 'first',
                                                       displayName: 'First',
                                                       score: 0.5
                                                     }]
                                               }));

       component.startEvaluation({
         file: new File([], 'test.csv'),
         rows: [{query: 'q1', golden: 'g1'}, {query: 'q2', golden: 'g2'}]
       });
       tick();

       expect(component.completedRows).toBe(2);
       expect(component.isProcessing).toBeFalse();
       expect(component.errorMessage)
           .toBe('Scoring failed for some rows: Score 2026 is outside the ' +
                 '0.0 to 1.0 range.');
     }));

  describe('score columns', () => {
    beforeEach(() => {
      TestBed.overrideProvider(SCORERS, {
        useValue: [
          new FakeScorer('first', 'First'),
          new FakeScorer('second', 'Second'),
        ],
      });
    });

    /** Selects the given scorers in the run configuration. */
    function select(...ids: string[]) {
      configSubject.next({...configSubject.value, selectedScorers: ids});
    }

    /** Builds a scored row carrying the given per-scorer outcomes. */
    function rowWith(scorerResults: ScorerRunResult[]): ResultRow {
      return {
        query: 'q',
        golden: 'g',
        fetched: 'f',
        ttft: 1,
        ttfa: 2,
        ttlt: 3,
        scorerResults
      };
    }

    it('should name the score column after the scorer', () => {
      select('first');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      resultsSubject.next(
          [rowWith([{scorerId: 'first', displayName: 'First', score: 0.5}])]);

      const headers = component.columns.map(c => c.header);
      expect(headers).toContain('First Score');
      expect(headers).not.toContain('Score');
      expect(component.displayResults[0]['score_first']).toBe(0.5);
      expect(component.displayResults[0]['scorerResults']).toBeUndefined();
    });

    it('should show every selected scorer\'s column before any row is scored',
       () => {
         select('first', 'second');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([]);

         const headers = component.columns.map(c => c.header);
         expect(headers).toContain('First Score');
         expect(headers).toContain('Second Score');
       });

    it('should keep the columns unchanged as scored rows arrive', () => {
      select('first', 'second');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      resultsSubject.next([]);
      const columnsBeforeAnyRow = component.columns.map(c => c.key);

      resultsSubject.next([rowWith([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {scorerId: 'second', displayName: 'Second', score: 0.75},
      ])]);

      expect(component.columns.map(c => c.key)).toEqual(columnsBeforeAnyRow);
    });

    it('should render one column per scorer when several ran', () => {
      select('first', 'second');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      resultsSubject.next([rowWith([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {scorerId: 'second', displayName: 'Second', score: 0.75},
      ])]);

      const headers = component.columns.map(c => c.header);
      expect(headers).toContain('First Score');
      expect(headers).toContain('Second Score');
      expect(component.displayResults[0]['score_first']).toBe(0.25);
      expect(component.displayResults[0]['score_second']).toBe(0.75);
      // Nested results are flattened away so the CSV export stays tabular.
      expect(component.displayResults[0]['scorerResults']).toBeUndefined();
    });

    it('should show the default scorer\'s column when none is selected', () => {
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      const headers = component.columns.map(c => c.header);
      expect(headers).toContain('First Score');
      expect(headers).not.toContain('Second Score');
    });

    it('should attach errorKey and errorHeader to score columns without adding separate UI error columns',
       () => {
         select('first', 'second');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([]);

         const keys = component.columns.map(c => c.key);
         expect(keys).not.toContain('scoreError_first');
         expect(keys).not.toContain('scoreError_second');
         expect(component.columns.map(c => c.header))
             .not.toContain('Second Error');

         const firstCol = component.columns.find(c => c.key === 'score_first');
         const secondCol =
             component.columns.find(c => c.key === 'score_second');
         expect(firstCol?.errorKey).toBe('scoreError_first');
         expect(firstCol?.errorHeader).toBe('First Error');
         expect(secondCol?.errorKey).toBe('scoreError_second');
         expect(secondCol?.errorHeader).toBe('Second Error');
       });

    it('should collect score and error separately and leave score blank when an error is present',
       () => {
         select('first', 'second');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([rowWith([
           {scorerId: 'first', displayName: 'First', score: 0.25},
           {scorerId: 'second', displayName: 'Second', score: 0, error: 'boom'},
         ])]);

         expect(component.displayResults[0]['score_first']).toBe(0.25);
         expect(component.displayResults[0]['scoreError_first']).toBe('');
         expect(component.displayResults[0]['score_second']).toBe('');
         expect(component.displayResults[0]['scoreError_second']).toBe('boom');
       });

    it('should render the error in the score column in the UI when an error is not empty',
       () => {
         select('first', 'second');
         resultsSubject.next([rowWith([
           {scorerId: 'first', displayName: 'First', score: 0.85},
           {scorerId: 'second', displayName: 'Second', score: 0, error: 'boom'},
         ])]);
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         component.step = 3;
         fixture.detectChanges();

         const headers =
             Array.from(fixture.nativeElement.querySelectorAll('th'))
                 .map(th => (th as HTMLElement).textContent?.trim());
         expect(headers).toContain('First Score');
         expect(headers).toContain('Second Score');
         expect(headers).not.toContain('First Error');
         expect(headers).not.toContain('Second Error');

         const secondScoreIndex = headers.indexOf('Second Score');
         const cells = Array.from(
             fixture.nativeElement.querySelectorAll('tbody tr td')) as
             HTMLElement[];
         const secondScoreCell = cells[secondScoreIndex];
         expect(secondScoreCell.textContent?.trim()).toBe('boom');
         expect(secondScoreCell.querySelector('.text-red-600')).not.toBeNull();
       });

    it('should leave the score cell blank when the scorer failed', () => {
      select('first', 'second');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      resultsSubject.next([rowWith([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {
          scorerId: 'second',
          displayName: 'Second',
          score: 0,
          error: 'Score 2026 is outside the 0.0 to 1.0 range.',
          rowError: true,
        },
      ])]);

      // A blank cell keeps Compare Evals from reading the placeholder 0 as a
      // real score; the error column carries the reason.
      expect(component.displayResults[0]['score_first']).toBe(0.25);
      expect(component.displayResults[0]['score_second']).toBe('');
      expect(component.displayResults[0]['scoreError_second'])
          .toBe('Score 2026 is outside the 0.0 to 1.0 range.');
    });

    it('should flatten a row error into the same columns as a clean row', () => {
      select('first', 'second');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      resultsSubject.next([
        rowWith([
          {scorerId: 'first', displayName: 'First', score: 0.25},
          {scorerId: 'second', displayName: 'Second', score: 0.75},
        ]),
        rowWith([
          {scorerId: 'first', displayName: 'First', score: 0.25},
          {
            scorerId: 'second',
            displayName: 'Second',
            score: 0,
            error: 'Score 2026 is outside the 0.0 to 1.0 range.',
            rowError: true,
          },
        ]),
      ]);

      // The flag only steers the re-rate, so neither the table nor the CSV
      // export built from these rows gains a column for it.
      expect(Object.keys(component.displayResults[1]))
          .toEqual(Object.keys(component.displayResults[0]));
      expect(component.displayResults[1]['rowError']).toBeUndefined();
    });

    it('should not change the columns when rows bring errors or other scorers',
       () => {
         select('first');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();
         const columnsBeforeAnyRow = component.columns.map(c => c.key);

         resultsSubject.next([rowWith([
           {scorerId: 'first', displayName: 'First', score: 0, error: 'boom'},
           {scorerId: 'second', displayName: 'Second', score: 0.75},
         ])]);

         expect(component.columns.map(c => c.key)).toEqual(columnsBeforeAnyRow);
       });

    it('should not rebuild the columns on unrelated configuration edits', () => {
      select('first');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();
      resultsSubject.next([rowWith([
        {scorerId: 'first', displayName: 'First', score: 0.25},
        {scorerId: 'second', displayName: 'Second', score: 0.75},
      ])]);
      const columnsBefore = component.columns.map(c => c.key);

      configSubject.next({...configSubject.value, projectId: 'other'});

      expect(component.columns.map(c => c.key)).toEqual(columnsBefore);
    });

    it('should give every row the same score columns', () => {
      select('first', 'second');
      const fixture = TestBed.createComponent(RunEvaluationComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      resultsSubject.next([
        rowWith([
          {scorerId: 'first', displayName: 'First', score: 0.25},
          {scorerId: 'second', displayName: 'Second', score: 0.75},
        ]),
        // A row scored before 'second' was selected still needs both keys, or
        // the CSV export would misalign its columns.
        rowWith([{scorerId: 'first', displayName: 'First', score: 0.5}]),
      ]);

      expect(Object.keys(component.displayResults[0]))
          .toEqual(Object.keys(component.displayResults[1]));
      expect(component.displayResults[1]['score_second']).toBe('');
    });

    it('should display 0 for a genuine zero score and blank for a skipped scorer entry',
       () => {
         select('first', 'second');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([rowWith([
           {scorerId: 'first', displayName: 'First', score: 0},
           {scorerId: 'second', displayName: 'Second', score: 0, skipped: true},
         ])]);

         expect(component.displayResults[0]['score_first']).toBe(0);
         expect(component.displayResults[0]['score_second']).toBe('');
       });
  });

  describe('startReRate', () => {
    beforeEach(() => {
      // Scorers without required inputs, so the dialog's draft is valid as
      // seeded and the tests can focus on the re-scoring itself.
      TestBed.overrideProvider(SCORERS, {
        useValue: [
          new FakeScorer('first', 'First'),
          new FakeScorer('second', 'Second'),
        ],
      });
    });

    it('should re-score every row with all selected scorers', fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([
           {
             query: 'q1',
             golden: 'g1',
             fetched: 'f1',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.1)
           },
           {
             query: 'q2',
             golden: 'g2',
             fetched: 'f2',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.2)
           },
         ]);
         mockEvalService.scoreAll.and.callFake(async () => [
           {scorerId: 'first', displayName: 'First', score: 0.9},
           {scorerId: 'second', displayName: 'Second', score: 0.8},
         ]);

         component.openReRateModal();
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).toHaveBeenCalledTimes(2);
         const rescored = resultsSubject.value;
         expect(rescored.map(row => row.scorerResults)).toEqual([
           [
             {scorerId: 'first', displayName: 'First', score: 0.9},
             {scorerId: 'second', displayName: 'Second', score: 0.8},
           ],
           [
             {scorerId: 'first', displayName: 'First', score: 0.9},
             {scorerId: 'second', displayName: 'Second', score: 0.8},
           ],
         ]);
         expect(component.errorMessage).toBeNull();
       }));

    it('should stop at the first failing row and keep the rest unchanged',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([
           {
             query: 'q1',
             golden: 'g1',
             fetched: 'f1',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.1)
           },
           {
             query: 'q2',
             golden: 'g2',
             fetched: 'f2',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.2)
           },
         ]);
         mockEvalService.scoreAll.and.callFake(async () => [{
           scorerId: 'first',
           displayName: 'First',
           score: 0,
           error: 'quota exceeded'
         }]);

         component.openReRateModal();
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).toHaveBeenCalledTimes(1);
         expect(component.errorMessage).toContain('quota exceeded');
         expect(resultsSubject.value.map(row => row.scorerResults))
             .toEqual([scored(0.1), scored(0.2)]);
       }));

    it('should record a row error and keep re-rating the remaining rows',
       fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([
           {
             query: 'q1',
             golden: 'g1',
             fetched: 'f1',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.1)
           },
           {
             query: 'q2',
             golden: 'g2',
             fetched: 'f2',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.2)
           },
         ]);
         // The first row's judge answered in prose, which the contract check
         // reports on that row only; the second row scores normally.
         const outOfRange: ScorerRunResult = {
           scorerId: 'first',
           displayName: 'First',
           score: 0,
           error: 'Score 80 is outside the 0.0 to 1.0 range.',
           rowError: true,
         };
         mockEvalService.scoreAll.and.callFake(
             async request => request.query === 'q1' ?
                 [outOfRange] :
                 [{scorerId: 'first', displayName: 'First', score: 0.9}]);

         component.openReRateModal();
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).toHaveBeenCalledTimes(2);
         expect(resultsSubject.value.map(row => row.scorerResults)).toEqual([
           [outOfRange],
           [{scorerId: 'first', displayName: 'First', score: 0.9}],
         ]);
         expect(component.errorMessage)
             .toBe('Scoring failed for some rows: Score 80 is outside the ' +
                   '0.0 to 1.0 range.');
         expect(component.progress).toBe(100);
       }));

    it('should skip scoring a row that was never fetched', fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: '',
           errorCode: 'ERROR',
           ttft: 0,
           ttfa: 0,
           ttlt: 0,
           scorerResults: []
         }]);

         component.openReRateModal();
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).not.toHaveBeenCalled();
         expect(resultsSubject.value[0].scorerResults?.[0].skipped).toBeTrue();
       }));

    it('should skip scoring rows with a non-empty errorCode during re-rate',
       fakeAsync(() => {
         const warnSpy = spyOn(console, 'warn');
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();

         resultsSubject.next([
           {
             query: 'q-skipped',
             golden: 'g',
             fetched: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
             errorCode: 'SKIPPED',
             ttft: 0,
             ttfa: 0,
             ttlt: 1,
             scorerResults: [],
           },
           {
             query: 'q-failed',
             golden: 'g',
             fetched: 'FAILED: Assist operation failed.',
             errorCode: 'FAILED',
             ttft: 0,
             ttfa: 0,
             ttlt: 1,
             scorerResults: [],
           },
           {
             query: 'q-rate-limited',
             golden: 'g',
             fetched: 'Error: Rate limited: Quota exceeded',
             errorCode: 'RATE_LIMITED',
             ttft: 0,
             ttfa: 0,
             ttlt: 0,
             scorerResults: [],
           },
           {
             query: 'q-http',
             golden: 'g',
             fetched: 'Error: HTTP error! status: 500 Internal Server Error',
             errorCode: 'HTTP_500',
             ttft: 0,
             ttfa: 0,
             ttlt: 0,
             scorerResults: [],
           },
           {
             query: 'q-invalid-turn',
             golden: 'g',
             fetched: 'INVALID_TURN_ID: Incorrect or missing turn ID.',
             errorCode: 'INVALID_TURN_ID',
             ttft: 0,
             ttfa: 0,
             ttlt: 0,
             scorerResults: [],
           },
           {
             query: 'q-error',
             golden: 'g',
             fetched: 'Error: Network connection lost',
             errorCode: 'ERROR',
             ttft: 0,
             ttfa: 0,
             ttlt: 0,
             scorerResults: [],
           },
           {
             query: 'q-valid',
             golden: 'g',
             fetched: 'Valid response',
             errorCode: '',
             ttft: 1,
             ttfa: 2,
             ttlt: 3,
             scorerResults: scored(0.5),
           },
         ]);
         mockEvalService.scoreAll.and.resolveTo(scored(0.9));

         component.openReRateModal();
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).toHaveBeenCalledTimes(1);
         expect(mockEvalService.scoreAll)
             .toHaveBeenCalledWith(jasmine.objectContaining({
               query: 'q-valid',
               response: 'Valid response',
             }));
         expect(warnSpy).toHaveBeenCalledWith(
             jasmine.any(String),
             jasmine.objectContaining({errorCode: 'SKIPPED'}));
         expect(warnSpy).toHaveBeenCalledWith(
             jasmine.any(String),
             jasmine.objectContaining({errorCode: 'FAILED'}));

         const skipped: ScorerRunResult[] = [
           {scorerId: 'first', displayName: 'First', score: 0, skipped: true},
         ];
         expect(resultsSubject.value.map(row => row.scorerResults)).toEqual([
           skipped, skipped, skipped, skipped, skipped, skipped, scored(0.9),
         ]);
         expect(component.displayResults.map(row => row['score_first']))
             .toEqual(['', '', '', '', '', '', 0.9]);
       }));

    it('should do nothing while another run is in progress', fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();
         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.1)
         }]);
         component.openReRateModal();
         component.isProcessing = true;
         mockStateService.setConfig.calls.reset();
         mockStateService.setResults.calls.reset();

         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).not.toHaveBeenCalled();
         expect(mockStateService.setConfig).not.toHaveBeenCalled();
         expect(mockStateService.setResults).not.toHaveBeenCalled();
         // The dialog keeps its draft so nothing the user picked is lost.
         expect(component.reRateConfig).not.toBeNull();
         expect(component.isProcessing).toBeTrue();
       }));

    it('should do nothing when the re-rate dialog is not open', fakeAsync(() => {
         const fixture = TestBed.createComponent(RunEvaluationComponent);
         const component = fixture.componentInstance;
         fixture.detectChanges();
         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.1)
         }]);
         mockStateService.setResults.calls.reset();

         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).not.toHaveBeenCalled();
         expect(mockStateService.setResults).not.toHaveBeenCalled();
         expect(component.isProcessing).toBeFalse();
       }));
  });

  describe('re-rate dialog scoring setup', () => {
    let fixture: ComponentFixture<RunEvaluationComponent>;
    let component: RunEvaluationComponent;

    beforeEach(() => {
      TestBed.overrideProvider(SCORERS, {
        useValue: [
          new FakeScorer('a', 'A', ['autoRaterInstruction']),
          new FakeScorer('b', 'B')
        ]
      });
      fixture = TestBed.createComponent(RunEvaluationComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      // The configuration form on step 1 persists its normalized selection as
      // it initializes; only what the dialog does is of interest here.
      mockStateService.setConfig.calls.reset();
    });

    /** The open re-rate dialog, if any. */
    function dialog(): HTMLElement|null {
      return fixture.nativeElement.querySelector('[role="dialog"]');
    }

    /**
     * The scoring method checkboxes rendered by the dialog, in DOM order. The
     * configuration form on step 1 renders the same picker, so the query is
     * scoped to the dialog.
     */
    function checkboxes(): HTMLInputElement[] {
      const open = dialog();
      if (!open) {
        return [];
      }
      return Array.from(
          open.querySelectorAll('input[type="checkbox"][aria-label]') as
          NodeListOf<HTMLInputElement>);
    }

    /** The dialog's Re-rate button. */
    function reRateButton(): HTMLButtonElement {
      const buttons = Array.from(
          dialog()!.querySelectorAll('button') as
          NodeListOf<HTMLButtonElement>);
      return buttons.find(button => button.textContent?.trim() === 'Re-rate')!;
    }

    /** The overlay behind the open dialog. */
    function backdrop(): HTMLElement {
      return dialog()!.parentElement!;
    }

    /**
     * Presses the mouse on one element and releases it so that the click lands
     * on another, as a browser does for a drag.
     */
    function pressAndClick(pressed: HTMLElement, clicked: HTMLElement) {
      pressed.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
      clicked.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    }

    it('should offer every scoring method once the dialog is open', () => {
      expect(checkboxes().length).toBe(0);

      component.openReRateModal();
      fixture.detectChanges();

      expect(checkboxes().map(input => input.getAttribute('aria-label')))
          .toEqual(['A', 'B']);
      // Seeded from the active configuration, which names no method yet and so
      // falls back to the default.
      expect(checkboxes().map(input => input.checked)).toEqual([true, false]);
      expect(component.reRateConfig!.selectedScorers).toEqual(['a']);
    });

    it('should leave the run configuration alone until the re-rate starts',
       () => {
         component.openReRateModal();
         fixture.detectChanges();

         checkboxes()[1].click();
         fixture.detectChanges();

         expect(component.reRateConfig!.selectedScorers).toEqual(['a', 'b']);
         expect(mockStateService.setConfig).not.toHaveBeenCalled();
       });

    it('should discard the edited scoring setup when cancelled', () => {
      component.openReRateModal();
      fixture.detectChanges();
      checkboxes()[1].click();

      component.closeReRateModal();
      fixture.detectChanges();

      expect(component.reRateConfig).toBeNull();
      expect(checkboxes().length).toBe(0);
      expect(configSubject.value.selectedScorers).toBeUndefined();
      expect(mockStateService.setConfig).not.toHaveBeenCalled();
    });

    it('should re-score with the scoring methods picked in the dialog',
       fakeAsync(() => {
         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.1)
         }]);
         mockEvalService.scoreAll.and.callFake(async () => [
           {scorerId: 'a', displayName: 'A', score: 0.9},
           {scorerId: 'b', displayName: 'B', score: 0.8},
         ]);

         component.openReRateModal();
         fixture.detectChanges();
         checkboxes()[1].click();
         component.startReRate();
         tick();

         expect(mockStateService.setConfig)
             .toHaveBeenCalledWith(
                 jasmine.objectContaining({selectedScorers: ['a', 'b']}));
         expect(mockEvalService.scoreAll)
             .toHaveBeenCalledWith(jasmine.objectContaining({
               config: jasmine.objectContaining({selectedScorers: ['a', 'b']})
             }));
         expect(component.reRateConfig).toBeNull();
       }));

    it('should re-score with an instruction edited in the dialog',
       fakeAsync(() => {
         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.1)
         }]);
         mockEvalService.scoreAll.and.callFake(
             async () => [{scorerId: 'a', displayName: 'A', score: 0.9}]);

         component.openReRateModal();
         component.reRateConfig!.autoRaterInstruction = 'Be strict.';
         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll)
             .toHaveBeenCalledWith(jasmine.objectContaining({
               config:
                   jasmine.objectContaining({autoRaterInstruction: 'Be strict.'})
             }));
       }));

    it('should block the re-rate while no scoring method is selected', () => {
      component.openReRateModal();
      fixture.detectChanges();
      expect(component.reRateValidationError).toBeNull();

      checkboxes()[0].click();
      fixture.detectChanges();

      expect(component.reRateConfig!.selectedScorers).toEqual([]);
      expect(component.reRateValidationError)
          .toBe('Select at least one scoring method.');
      expect(reRateButton().disabled).toBeTrue();
    });

    it('should not re-rate with an empty selection even if called directly',
       fakeAsync(() => {
         resultsSubject.next([{
           query: 'q1',
           golden: 'g1',
           fetched: 'f1',
           ttft: 1,
           ttfa: 2,
           ttlt: 3,
           scorerResults: scored(0.1)
         }]);
         component.openReRateModal();
         component.reRateConfig!.selectedScorers = [];

         component.startReRate();
         tick();

         expect(mockEvalService.scoreAll).not.toHaveBeenCalled();
         expect(mockStateService.setConfig).not.toHaveBeenCalled();
         // The dialog stays open so its validation message stays visible.
         expect(component.reRateConfig).not.toBeNull();
         expect(resultsSubject.value[0].scorerResults).toEqual(scored(0.1));
       }));

    it('should name the selected scoring methods as they change', () => {
      component.openReRateModal();
      fixture.detectChanges();
      expect(component.selectedScorersLabel).toBe('A');

      checkboxes()[1].click();
      fixture.detectChanges();

      expect(component.selectedScorersLabel).toBe('A, B');
      expect(dialog()!.textContent).toContain('A, B');
    });

    it('should close when the backdrop is clicked', () => {
      component.openReRateModal();
      fixture.detectChanges();

      pressAndClick(backdrop(), backdrop());
      fixture.detectChanges();

      expect(component.reRateConfig).toBeNull();
      expect(dialog()).toBeNull();
      expect(mockStateService.setConfig).not.toHaveBeenCalled();
    });

    it('should stay open when the dialog itself is clicked', () => {
      component.openReRateModal();
      fixture.detectChanges();

      pressAndClick(dialog()!, dialog()!);
      fixture.detectChanges();

      expect(component.reRateConfig).not.toBeNull();
      expect(dialog()).not.toBeNull();
    });

    it('should stay open when a drag starts inside the dialog', () => {
      component.openReRateModal();
      fixture.detectChanges();

      // Selecting text in the instruction and releasing over the backdrop
      // fires the click on the backdrop.
      pressAndClick(dialog()!, backdrop());
      fixture.detectChanges();

      expect(component.reRateConfig).not.toBeNull();
    });
  });

  it('should render a question mark tooltip on the Trace column header explaining trace persistence delay',
     () => {
       const fixture = TestBed.createComponent(RunEvaluationComponent);
       const component = fixture.componentInstance;
       component.step = 3;
       fixture.detectChanges();

       const traceColumn = component.columns.find(c => c.key === 'traceUrl');
       expect(traceColumn?.tooltip).toBe(TRACE_COLUMN_TOOLTIP);
       expect(traceColumn?.tooltipAlign).toBe('right');

       const headers =
           Array.from(fixture.nativeElement.querySelectorAll('th')) as
           HTMLElement[];
       const traceHeader =
           headers.find(th => th.textContent?.includes('Trace'));
       expect(traceHeader).toBeDefined();

       const tooltipEl = traceHeader!.querySelector('app-info-tooltip');
       expect(tooltipEl).not.toBeNull();
       expect(tooltipEl!.querySelector('svg[role="img"][aria-label="Help"]'))
           .not.toBeNull();
       expect(tooltipEl!.textContent).toContain(TRACE_COLUMN_TOOLTIP);

       const triggerEl = tooltipEl!.querySelector('.group') as HTMLElement;
       const rectSpy = spyOn(triggerEl, 'getBoundingClientRect').and.returnValue({
         top: 100,
         right: 500,
         bottom: 120,
         left: 480,
         width: 20,
         height: 20,
         x: 480,
         y: 100,
         toJSON: () => ({})
       });

       triggerEl.dispatchEvent(new MouseEvent('mouseenter'));
       fixture.detectChanges();

       const popupEl = tooltipEl!.querySelector('.fixed') as HTMLElement;
       expect(popupEl.classList.contains('pointer-events-none')).toBeFalse();
       expect(popupEl.style.bottom).toBe(`${window.innerHeight - 100 + 8}px`);
       expect(popupEl.style.right).toBe(`${window.innerWidth - 500}px`);

       rectSpy.and.returnValue({
         top: 80,
         right: 450,
         bottom: 100,
         left: 430,
         width: 20,
         height: 20,
         x: 430,
         y: 80,
         toJSON: () => ({})
       });
       window.dispatchEvent(new Event('scroll'));
       fixture.detectChanges();

       expect(popupEl.style.bottom).toBe(`${window.innerHeight - 80 + 8}px`);
       expect(popupEl.style.right).toBe(`${window.innerWidth - 450}px`);

       triggerEl.dispatchEvent(new MouseEvent('mouseleave'));

       const queryHeader =
           headers.find(th => th.textContent?.trim() === 'Query');
       expect(queryHeader?.querySelector('app-info-tooltip')).toBeNull();
     });

  it('should apply amber row styling on SKIPPED rows and red row styling on error rows in the results table', () => {
    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    component.step = 3;
    resultsSubject.next([
      {
        query: 'Hi',
        golden: 'g1',
        fetched: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
        errorCode: 'SKIPPED',
        ttft: 0,
        ttfa: 0,
        ttlt: 1.8,
        scorerResults: [],
      },
      {
        query: 'Normal query',
        golden: 'g2',
        fetched: 'Valid response',
        errorCode: '',
        ttft: 1,
        ttfa: 2,
        ttlt: 3,
        scorerResults: scored(0.9),
      },
      {
        query: 'Failed query',
        golden: 'g3',
        fetched: 'Error: HTTP error! status: 500 Internal Server Error',
        errorCode: 'HTTP_500',
        ttft: 0,
        ttfa: 0,
        ttlt: 0,
        scorerResults: [],
      },
    ]);
    fixture.detectChanges();

    const rows = Array.from(
        fixture.nativeElement.querySelectorAll('tbody tr')) as
        HTMLTableRowElement[];
    expect(rows.length).toBe(3);

    expect(rows[0].classList.contains('bg-amber-50')).toBeTrue();
    expect(rows[0].classList.contains('hover:bg-amber-100')).toBeTrue();
    expect(rows[0].classList.contains('border-l-4')).toBeTrue();
    expect(rows[0].classList.contains('!border-l-amber-500')).toBeTrue();

    expect(rows[1].classList.contains('bg-red-50')).toBeFalse();
    expect(rows[1].classList.contains('bg-amber-50')).toBeFalse();
    expect(rows[1].classList.contains('!border-l-red-500')).toBeFalse();
    expect(rows[1].classList.contains('!border-l-amber-500')).toBeFalse();
    expect(rows[1].classList.contains('hover:bg-gray-50')).toBeTrue();

    expect(rows[2].classList.contains('bg-red-50')).toBeTrue();
    expect(rows[2].classList.contains('hover:bg-red-100')).toBeTrue();
    expect(rows[2].classList.contains('border-l-4')).toBeTrue();
    expect(rows[2].classList.contains('!border-l-red-500')).toBeTrue();
  });

  it('should include Error Code column when exporting results to CSV', () => {
    const csvService = TestBed.inject(CsvService);
    const exportSpy = spyOn(csvService, 'exportCSV').and.callFake(() => {});

    const fixture = TestBed.createComponent(RunEvaluationComponent);
    const component = fixture.componentInstance;
    component.step = 3;
    resultsSubject.next([
      {
        query: 'Hi',
        golden: 'g1',
        fetched: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
        errorCode: 'SKIPPED',
        ttft: 0,
        ttfa: 0,
        ttlt: 1.8,
        scorerResults: [],
      },
      {
        query: 'Normal query',
        golden: 'g2',
        fetched: 'Valid response',
        errorCode: '',
        ttft: 1,
        ttfa: 2,
        ttlt: 3,
        scorerResults: scored(0.9),
      },
      {
        query: 'Failed query',
        golden: 'g3',
        fetched: 'Error: HTTP error! status: 500 Internal Server Error',
        errorCode: 'HTTP_500',
        ttft: 0,
        ttfa: 0,
        ttlt: 0,
        scorerResults: [],
      },
    ]);
    fixture.detectChanges();

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
  });
});
