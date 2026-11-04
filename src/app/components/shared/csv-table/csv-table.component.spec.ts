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

import {CsvService} from '../../../services/csv.service';

import {CsvTableComponent} from './csv-table.component';

describe('CsvTableComponent', () => {
  let component: CsvTableComponent;
  let exportCSV: jasmine.Spy;

  beforeEach(() => {
    exportCSV = jasmine.createSpy('exportCSV');
    TestBed.configureTestingModule({
      imports: [CsvTableComponent],
      providers: [{provide: CsvService, useValue: {exportCSV}}],
    });
    component = TestBed.createComponent(CsvTableComponent).componentInstance;
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
