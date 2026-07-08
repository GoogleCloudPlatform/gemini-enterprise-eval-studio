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

import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component} from '@angular/core';
import {FormsModule} from '@angular/forms';

import {ComparisonResult} from '../../models/comparison-result.model';
import {CsvService} from '../../services/csv.service';
import {CsvTableComponent, ColumnDef} from '../shared/csv-table/csv-table.component';

@Component({
  selector: 'app-compare-evals',
  standalone: true,
  imports: [CommonModule, FormsModule, CsvTableComponent],
  templateUrl: './compare-evals.component.html'
})
/**
 * Component for comparing two evaluation results.
 */
export class CompareEvalsComponent {
  baselineFile: File|null = null;
  baselineRows: Array<Record<string, string>> = [];
  recentFile: File|null = null;
  recentRows: Array<Record<string, string>> = [];
  comparisonResults: ComparisonResult[] = [];
  isDraggingBaseline = false;
  isDraggingRecent = false;
  baselineError: string|null = null;
  recentError: string|null = null;

  columns: ColumnDef[] = [
    {header: 'Query', key: 'query', truncate: true},
    {header: 'Baseline Score', key: 'baselineScore', type: 'number'},
    {header: 'Recent Score', key: 'recentScore', type: 'number'},
    {header: 'Delta', key: 'delta', type: 'delta'}
  ];

  constructor(private csvService: CsvService, private cdr: ChangeDetectorRef) {}

  /** Prevents default drag behavior to allow drop. */
  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Handles dragover for baseline dropzone. */
  onDragOverBaseline(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingBaseline = true;
  }

  /** Handles dragleave for baseline dropzone. */
  onDragLeaveBaseline(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingBaseline = false;
  }

  /** Handles dragover for recent dropzone. */
  onDragOverRecent(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingRecent = true;
  }

  /** Handles dragleave for recent dropzone. */
  onDragLeaveRecent(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingRecent = false;
  }

  /** Handles the drop event for the baseline file. */
  onDropBaseline(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingBaseline = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFileSelection(files[0], 'baseline');
    }
  }

  /** Handles the file selection event for the baseline file. */
  onBaselineSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      this.handleFileSelection(files[0], 'baseline');
    }
  }

  /** Handles the drop event for the recent file. */
  onDropRecent(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingRecent = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFileSelection(files[0], 'recent');
    }
  }

  /** Handles the file selection event for the recent file. */
  onRecentSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      this.handleFileSelection(files[0], 'recent');
    }
  }

  /** Core logic to parse and store selected files. */
  private handleFileSelection(file: File, type: 'baseline'|'recent') {
    if (type === 'baseline') {
      this.baselineFile = file;
      this.baselineError = null;
    } else {
      this.recentFile = file;
      this.recentError = null;
    }

    this.csvService.parseCSV(file, (data) => {
      const normalizedData = this.normalizeRows(data);

      if (normalizedData.length > 0) {
        const headers = Object.keys(normalizedData[0]);
        const requiredColumns = ['query', 'score', 'fetched'];
        const missingColumns =
            requiredColumns.filter(col => !headers.includes(col));

        if (missingColumns.length > 0) {
          if (type === 'baseline') {
            this.baselineFile = null;
            this.baselineError =
                `CSV must contain columns: query, score, fetched. Missing columns - ${
                    missingColumns.join(', ')}`;

          } else {
            this.recentFile = null;
            this.recentError =
                `CSV must contain columns: query, score, fetched. Missing columns - ${
                    missingColumns.join(', ')}`;
          }
          this.cdr.detectChanges();
          return;
        }
      }

      if (type === 'baseline') {
        this.baselineRows = normalizedData;
      } else {
        this.recentRows = normalizedData;
      }
      this.cdr.detectChanges();
    }, (err) => console.error(err));
  }

  /**
   * Normalizes CSV headers to lowercase to prevent case-sensitive header
   * issues.
   */
  private normalizeRows(rows: Array<Record<string, string>>):
      Array<Record<string, string>> {
    return rows.map((row) => {
      const normalizedRow: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        const normalizedKey = key.trim().replace(/^\ufeff/, '').toLowerCase();
        normalizedRow[normalizedKey] = value;
      }
      return normalizedRow;
    });
  }

  /** Compares baseline and recent evaluations. */
  compareEvals() {
    this.comparisonResults = [];
    const recentMap = new Map(this.recentRows.map(r => [r['query'], r]));

    this.baselineRows.forEach(baseRow => {
      const recentRow = recentMap.get(baseRow['query']);
      if (recentRow) {
        const baselineScore = Number(baseRow['score'] || baseRow['autoraterscore'] || baseRow['bertscore']) || 0;
        const recentScore = Number(recentRow['score'] || recentRow['autoraterscore'] || recentRow['bertscore']) || 0;
        const delta = Number((recentScore - baselineScore).toFixed(2));
        
        const baselineResponse = baseRow['fetched'] || baseRow['fetchedresponse'] || 'N/A';
        const recentResponse = recentRow['fetched'] || recentRow['fetchedresponse'] || 'N/A';

        this.comparisonResults.push({
          query: baseRow['query'],
          baselineScore,
          recentScore,
          delta,
          baselineResponse,
          recentResponse
        });
      }
    });
    this.cdr.detectChanges();
  }
}
