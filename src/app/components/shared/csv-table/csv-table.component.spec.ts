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

import {CsvService} from '../../../services/csv.service';

import {CsvTableComponent} from './csv-table.component';

describe('CsvTableComponent', () => {
  let fixture: ComponentFixture<CsvTableComponent>;
  let component: CsvTableComponent;
  let exportCSV: jasmine.Spy;

  beforeEach(() => {
    exportCSV = jasmine.createSpy('exportCSV');
    TestBed.configureTestingModule({
      imports: [CsvTableComponent],
      providers: [{provide: CsvService, useValue: {exportCSV}}],
    });
    fixture = TestBed.createComponent(CsvTableComponent);
    component = fixture.componentInstance;
    component.columns = [{header: 'Query', key: 'query'}];
  });

  /** The rows handed to CsvService by the last export. */
  function exportedRows(): Array<Record<string, unknown>> {
    return exportCSV.calls.mostRecent().args[0];
  }

  describe('exportResults', () => {
    it('should export the agent ID alongside the engine ID', () => {
      component.data = [{query: 'q', engineId: 'engine', agentId: 'support-bot'}];

      component.exportResults();

      expect(exportedRows()).toEqual([
        jasmine.objectContaining(
            {'Query': 'q', 'Engine ID': 'engine', 'Agent ID': 'support-bot'}),
      ]);
    });

    it('should export an empty agent ID for a default assistant run', () => {
      component.data = [{query: 'q', engineId: 'engine', agentId: ''}];

      component.exportResults();

      expect(exportedRows()[0]['Agent ID']).toBe('');
    });

    it('should leave the agent column out for rows that have no agent field',
       () => {
         component.data = [{query: 'q'}];

         component.exportResults();

         expect('Agent ID' in exportedRows()[0]).toBeFalse();
       });

    it('should export score and error as separate CSV columns when errorHeader and errorKey are set',
       () => {
         component.columns = [
           {header: 'Query', key: 'query'},
           {
             header: 'First Score',
             key: 'score_first',
             errorHeader: 'First Error',
             errorKey: 'scoreError_first',
             type: 'score',
           },
         ];
         component.data = [
           {query: 'q1', score_first: 0.9, scoreError_first: ''},
           {query: 'q2', score_first: '', scoreError_first: 'boom'},
         ];

         component.exportResults();

         expect(exportedRows()).toEqual([
           {'Query': 'q1', 'First Score': 0.9, 'First Error': ''},
           {'Query': 'q2', 'First Score': '', 'First Error': 'boom'},
         ]);
       });
  });

  describe('score column with inline error', () => {
    beforeEach(() => {
      component.columns = [
        {
          header: 'First Score',
          key: 'score_first',
          errorHeader: 'First Error',
          errorKey: 'scoreError_first',
          type: 'score',
        },
      ];
    });

    it('should render the score when error is empty and the error when error is not empty',
       () => {
         component.data = [
           {score_first: 0.9, scoreError_first: ''},
           {score_first: '', scoreError_first: 'Rate limit exceeded'},
         ];
         fixture.detectChanges();

         const cells = Array.from(
             fixture.nativeElement.querySelectorAll('tbody tr td')) as
             HTMLElement[];
         expect(cells.length).toBe(2);
         expect(cells[0].textContent?.trim()).toBe('0.9');
         expect(cells[0].querySelector('.text-green-600')).not.toBeNull();

         expect(cells[1].textContent?.trim()).toBe('Rate limit exceeded');
         expect(cells[1].querySelector('.text-red-600')).not.toBeNull();
       });

    it('should truncate long error messages in the score column and toggle expansion',
       () => {
         const longError = 'E'.repeat(120);
         component.data = [{score_first: '', scoreError_first: longError}];
         fixture.detectChanges();

         const cell = fixture.nativeElement.querySelector('tbody tr td') as
             HTMLElement;
         const span = cell.querySelector('span.text-red-600') as HTMLElement;
         const button = cell.querySelector('button') as HTMLButtonElement;

         expect(span.textContent).toBe('E'.repeat(100) + '...');
         expect(button).not.toBeNull();
         expect(button.textContent?.trim()).toBe('Show more');

         button.click();
         fixture.detectChanges();

         expect(span.textContent).toBe(longError);
         expect(button.textContent?.trim()).toBe('Show less');
       });
  });

  describe('scoreClass', () => {
    it('should color scores green from 0.8, yellow from 0.5 and red below',
       () => {
         expect(component.scoreClass(1)).toBe('text-green-600');
         expect(component.scoreClass(0.8)).toBe('text-green-600');
         expect(component.scoreClass(0.79)).toBe('text-yellow-600');
         expect(component.scoreClass(0.5)).toBe('text-yellow-600');
         expect(component.scoreClass(0.49)).toBe('text-red-600');
         expect(component.scoreClass(0)).toBe('text-red-600');
       });

    it('should leave a value that does not convert to a number uncolored',
       () => {
         expect(component.scoreClass(Number.NaN)).toBe('');
         // Cells come from parsed CSV data, so they are not always numbers.
         expect(component.scoreClass('n/a' as unknown as number)).toBe('');
       });
  });

  describe('deltaClass', () => {
    it('should color deltas beyond 0.1 green or red and the rest gray', () => {
      expect(component.deltaClass(0.11)).toBe('text-green-600');
      expect(component.deltaClass(0.1)).toBe('text-gray-600');
      expect(component.deltaClass(0)).toBe('text-gray-600');
      expect(component.deltaClass(-0.1)).toBe('text-gray-600');
      expect(component.deltaClass(-0.11)).toBe('text-red-600');
    });

    it('should leave a value that does not convert to a number uncolored',
       () => {
         expect(component.deltaClass(Number.NaN)).toBe('');
         expect(component.deltaClass('n/a' as unknown as number)).toBe('');
       });
  });

  it('should color score and delta cells by their values', () => {
    const fixture = TestBed.createComponent(CsvTableComponent);
    fixture.componentInstance.columns = [
      {header: 'Score', key: 'score', type: 'score'},
      {header: 'Delta', key: 'delta', type: 'delta'},
    ];
    fixture.componentInstance.data = [{score: 0.6, delta: -0.25}];
    fixture.detectChanges();

    const [scoreCell, deltaCell] = Array.from(
        fixture.nativeElement.querySelectorAll('tbody td') as
        NodeListOf<HTMLElement>);
    expect(scoreCell.querySelector('span')?.className)
        .toContain('text-yellow-600');
    expect(deltaCell.querySelector('span')?.className)
        .toContain('text-red-600');
  });
});
