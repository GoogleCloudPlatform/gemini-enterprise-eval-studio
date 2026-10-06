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

import {CsvService} from '../../services/csv.service';

import {CompareEvalsComponent} from './compare-evals.component';

describe('CompareEvalsComponent', () => {
  let mockCsvService: jasmine.SpyObj<CsvService>;
  let component: CompareEvalsComponent;

  beforeEach(async () => {
    mockCsvService =
        jasmine.createSpyObj('CsvService', ['parseCSV', 'exportCSV']);

    await TestBed
        .configureTestingModule({
          imports: [CompareEvalsComponent],
          providers: [{provide: CsvService, useValue: mockCsvService}],
        })
        .compileComponents();

    const fixture = TestBed.createComponent(CompareEvalsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  /** Uploads a CSV whose parsed rows are the given records. */
  function upload(
      type: 'baseline'|'recent', rows: Array<Record<string, string>>) {
    mockCsvService.parseCSV.and.callFake((file, callback) => {
      callback(rows);
    });
    const file = new File([], `${type}.csv`);
    if (type === 'baseline') {
      component.onBaselineSelected({target: {files: [file]}} as unknown as Event);
    } else {
      component.onRecentSelected({target: {files: [file]}} as unknown as Event);
    }
  }

  it('should reject a CSV without any score column', () => {
    upload('baseline', [{'Query': 'q', 'Fetched': 'f', 'Score': '0.5'}]);

    expect(component.baselineFile).toBeNull();
    expect(component.baselineError).toContain('<scoring method> Score');
  });

  it('should compare every scorer present in both CSVs', () => {
    upload('baseline', [{
      '\ufeffQuery': 'q',
      'Fetched': 'old',
      'Auto Rater Score': '0.5',
      'Exact Match Score': '1',
      'Baseline Only Score': '0.1',
    }]);
    upload('recent', [{
      'Query': 'q',
      'Fetched': 'new',
      // Matched by name regardless of case.
      'auto rater score': '0.75',
      'Exact Match Score': '0',
    }]);

    component.compareEvals();

    expect(component.compareError).toBeNull();
    expect(component.columns.map(c => c.header)).toEqual([
      'Query',
      'Auto Rater Baseline',
      'Auto Rater Recent',
      'Auto Rater Delta',
      'Exact Match Baseline',
      'Exact Match Recent',
      'Exact Match Delta',
    ]);
    expect(component.comparisonResults).toEqual([{
      query: 'q',
      scores: [
        {
          scorer: 'Auto Rater',
          baselineScore: 0.5,
          recentScore: 0.75,
          delta: 0.25
        },
        {scorer: 'Exact Match', baselineScore: 1, recentScore: 0, delta: -1},
      ],
      baselineResponse: 'old',
      recentResponse: 'new',
    }]);
    expect(component.displayResults).toEqual([{
      query: 'q',
      baseline_0: 0.5,
      recent_0: 0.75,
      delta_0: 0.25,
      baseline_1: 1,
      recent_1: 0,
      delta_1: -1,
    }]);
  });

  it('should leave the delta empty when a score is missing', () => {
    upload('baseline', [{'Query': 'q', 'Fetched': 'f', 'A Score': ''}]);
    upload('recent', [{'Query': 'q', 'Fetched': 'f', 'A Score': '0.5'}]);

    component.compareEvals();

    expect(component.comparisonResults[0].scores).toEqual([
      {scorer: 'A', baselineScore: null, recentScore: 0.5, delta: null},
    ]);
    expect(component.displayResults[0]['delta_0']).toBe('');
  });

  it('should report when the CSVs share no scoring method', () => {
    upload('baseline', [{'Query': 'q', 'Fetched': 'f', 'A Score': '0.5'}]);
    upload('recent', [{'Query': 'q', 'Fetched': 'f', 'B Score': '0.5'}]);

    component.compareEvals();

    expect(component.comparisonResults).toEqual([]);
    expect(component.compareError).toContain('share no scoring method');
  });
});
