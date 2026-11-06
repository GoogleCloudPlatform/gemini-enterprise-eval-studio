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

import {ComponentFixture, TestBed} from '@angular/core/testing';

import {CsvService} from '../../services/csv.service';

import {CompareEvalsComponent} from './compare-evals.component';

describe('CompareEvalsComponent', () => {
  let mockCsvService: jasmine.SpyObj<CsvService>;
  let fixture: ComponentFixture<CompareEvalsComponent>;
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

    fixture = TestBed.createComponent(CompareEvalsComponent);
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

  it('should surface Error Code and status transitions when an evaluation row was not scored due to an error',
     () => {
       upload('baseline', [
         {
           'Query': 'q-errored',
           'Fetched': 'ok',
           'Error Code': '',
           'A Score': '0.9',
         },
         {
           'Query': 'q-skipped',
           'Fetched': 'ok',
           'Error Code': '',
           'A Score': '0.8',
         },
         {
           'Query': 'q-recovered',
           'Fetched': 'FAILED: Assist operation failed.',
           'Error Code': 'FAILED',
           'A Score': '',
         },
         {
           'Query': 'q-both-errored',
           'Fetched': 'FAILED: Assist operation failed.',
           'Error Code': 'FAILED',
           'A Score': '',
         },
         {
           'Query': 'q-both-skipped',
           'Fetched': 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           'Error Code': 'SKIPPED',
           'A Score': '',
         },
         {
           'Query': 'q-skip-to-fail',
           'Fetched': 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           'Error Code': 'SKIPPED',
           'A Score': '',
         },
         {
           'Query': 'q-fail-to-skip',
           'Fetched': 'FAILED: Assist operation failed.',
           'Error Code': 'FAILED',
           'A Score': '',
         },
       ]);
       upload('recent', [
         {
           'Query': 'q-errored',
           'Fetched': 'FAILED: Assist operation failed.',
           'Error Code': 'FAILED',
           'A Score': '',
         },
         {
           'Query': 'q-skipped',
           'Fetched': 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           'Error Code': 'SKIPPED',
           'A Score': '',
         },
         {
           'Query': 'q-recovered',
           'Fetched': 'fixed',
           'Error Code': '',
           'A Score': '0.85',
         },
         {
           'Query': 'q-both-errored',
           'Fetched': 'Error: timeout',
           'Error Code': 'ERROR',
           'A Score': '',
         },
         {
           'Query': 'q-both-skipped',
           'Fetched': 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           'Error Code': 'SKIPPED',
           'A Score': '',
         },
         {
           'Query': 'q-skip-to-fail',
           'Fetched': 'FAILED: Assist operation failed.',
           'Error Code': 'FAILED',
           'A Score': '',
         },
         {
           'Query': 'q-fail-to-skip',
           'Fetched': 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           'Error Code': 'SKIPPED',
           'A Score': '',
         },
       ]);

       component.compareEvals();

       expect(component.comparisonResults).toEqual([
         {
           query: 'q-errored',
           scores: [{
             scorer: 'A',
             baselineScore: 0.9,
             recentScore: null,
             delta: null,
             statusChange: 'recent_failure',
           }],
           baselineResponse: 'ok',
           recentResponse: 'FAILED: Assist operation failed.',
           recentErrorCode: 'FAILED',
         },
         {
           query: 'q-skipped',
           scores: [{
             scorer: 'A',
             baselineScore: 0.8,
             recentScore: null,
             delta: null,
             statusChange: 'recent_skip',
           }],
           baselineResponse: 'ok',
           recentResponse: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           recentErrorCode: 'SKIPPED',
         },
         {
           query: 'q-recovered',
           scores: [{
             scorer: 'A',
             baselineScore: null,
             recentScore: 0.85,
             delta: null,
             statusChange: 'recovered',
           }],
           baselineResponse: 'FAILED: Assist operation failed.',
           recentResponse: 'fixed',
           baselineErrorCode: 'FAILED',
         },
         {
           query: 'q-both-errored',
           scores: [{
             scorer: 'A',
             baselineScore: null,
             recentScore: null,
             delta: null,
             statusChange: 'persistent_failure',
           }],
           baselineResponse: 'FAILED: Assist operation failed.',
           recentResponse: 'Error: timeout',
           baselineErrorCode: 'FAILED',
           recentErrorCode: 'ERROR',
         },
         {
           query: 'q-both-skipped',
           scores: [{
             scorer: 'A',
             baselineScore: null,
             recentScore: null,
             delta: null,
             statusChange: 'persistent_skip',
           }],
           baselineResponse: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           recentResponse: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           baselineErrorCode: 'SKIPPED',
           recentErrorCode: 'SKIPPED',
         },
         {
           query: 'q-skip-to-fail',
           scores: [{
             scorer: 'A',
             baselineScore: null,
             recentScore: null,
             delta: null,
             statusChange: 'recent_failure',
           }],
           baselineResponse: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           recentResponse: 'FAILED: Assist operation failed.',
           baselineErrorCode: 'SKIPPED',
           recentErrorCode: 'FAILED',
         },
         {
           query: 'q-fail-to-skip',
           scores: [{
             scorer: 'A',
             baselineScore: null,
             recentScore: null,
             delta: null,
             statusChange: 'recent_skip',
           }],
           baselineResponse: 'FAILED: Assist operation failed.',
           recentResponse: 'SKIPPED: NON_ASSIST_SEEKING_QUERY_IGNORED',
           baselineErrorCode: 'FAILED',
           recentErrorCode: 'SKIPPED',
         },
       ]);
       expect(component.displayResults).toEqual([
         {
           query: 'q-errored',
           baseline_0: 0.9,
           recent_0: 'FAILED',
           delta_0: 'Recent Failure',
         },
         {
           query: 'q-skipped',
           baseline_0: 0.8,
           recent_0: 'SKIPPED',
           delta_0: 'Recent Skip',
         },
         {
           query: 'q-recovered',
           baseline_0: 'FAILED',
           recent_0: 0.85,
           delta_0: 'Recovered',
         },
         {
           query: 'q-both-errored',
           baseline_0: 'FAILED',
           recent_0: 'ERROR',
           delta_0: 'Persistent Failure',
         },
         {
           query: 'q-both-skipped',
           baseline_0: 'SKIPPED',
           recent_0: 'SKIPPED',
           delta_0: 'Persistent Skip',
         },
         {
           query: 'q-skip-to-fail',
           baseline_0: 'SKIPPED',
           recent_0: 'FAILED',
           delta_0: 'Recent Failure',
         },
         {
           query: 'q-fail-to-skip',
           baseline_0: 'FAILED',
           recent_0: 'SKIPPED',
           delta_0: 'Recent Skip',
         },
       ]);
     });

  it('should report when the CSVs share no scoring method', () => {
    upload('baseline', [{'Query': 'q', 'Fetched': 'f', 'A Score': '0.5'}]);
    upload('recent', [{'Query': 'q', 'Fetched': 'f', 'B Score': '0.5'}]);

    component.compareEvals();

    expect(component.comparisonResults).toEqual([]);
    expect(component.compareError).toContain('share no scoring method');
  });

  describe('deltaClass', () => {
    it('should color deltas beyond 0.1 green or red and the rest gray', () => {
      expect(component.deltaClass(0.11)).toBe('bg-green-100 text-green-700');
      expect(component.deltaClass(0.1)).toBe('bg-gray-100 text-gray-600');
      expect(component.deltaClass(0)).toBe('bg-gray-100 text-gray-600');
      expect(component.deltaClass(-0.1)).toBe('bg-gray-100 text-gray-600');
      expect(component.deltaClass(-0.11)).toBe('bg-red-100 text-red-700');
    });

    it('should leave a delta that is not a number uncolored', () => {
      expect(component.deltaClass(Number.NaN)).toBe('');
    });

    it('should color the delta badges of the side-by-side comparison', () => {
      upload('baseline', [
        {'Query': 'q', 'Fetched': 'f', 'A Score': '0.5', 'B Score': '0.5'},
      ]);
      upload('recent', [
        {'Query': 'q', 'Fetched': 'f', 'A Score': '0.75', 'B Score': '0.45'},
      ]);

      component.compareEvals();
      fixture.detectChanges();

      const badges = Array.from(
          fixture.nativeElement.querySelectorAll('div.rounded-full') as
          NodeListOf<HTMLElement>);
      expect(badges.map(badge => badge.textContent?.trim())).toEqual([
        '+0.25',
        '-0.05',
      ]);
      expect(badges[0].classList.contains('text-green-700')).toBeTrue();
      expect(badges[1].classList.contains('text-gray-600')).toBeTrue();
    });
  });
});
