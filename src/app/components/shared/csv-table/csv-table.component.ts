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

import {CommonModule, formatDate} from '@angular/common';
import {Component, Input, OnChanges} from '@angular/core';

import {CsvService} from '../../../services/csv.service';
import {InfoTooltipComponent} from '../info-tooltip/info-tooltip.component';

declare var marked: any;

/**
 * Defines the structure of a column in the CSV table.
 */
export interface ColumnDef {
  header: string;
  key: string;
  type?: 'text'|'markdown'|'number'|'score'|'delta'|'link';
  hrefKey?: string;
  linkText?: string;
  /**
   * Row key holding an error message for this column (used by `score` columns).
   * When non-empty on a row, the UI renders the error in this column instead
   * of `row[key]`, while CSV export writes it under `errorHeader`.
   */
  errorKey?: string;
  /**
   * CSV column header for `errorKey` when exported. Kept separate in the CSV
   * even though the UI merges the error into this column.
   */
  errorHeader?: string;
  truncate?: boolean;
  width?: string;
  tooltip?: string;
  tooltipAlign?: 'left'|'right';
}

@Component({
  selector: 'app-csv-table',
  standalone: true,
  imports: [CommonModule, InfoTooltipComponent],
  templateUrl: './csv-table.component.html'
})
/**
 * Component for displaying CSV data in a table.
 * Supports markdown rendering, truncation, and expansion of cells.
 */
export class CsvTableComponent implements OnChanges {
  @Input() data: any[] = [];
  @Input() columns: ColumnDef[] = [];
  @Input() title = '';
  @Input() exportFileName: string = 'eval_results';
  @Input() rowErrorKey = '';
  @Input() rowWarningValues: string[] = [];

  hasTruncated = false;

  constructor(private csvService: CsvService) {}

  ngOnChanges() {
    this.hasTruncated = this.columns.some(col => col.truncate);
  }

  /**
   * Exports the table data to a CSV file.
   */
  exportResults() {
    const formattedDate =
        formatDate(new Date(), 'yyyy-MM-dd_HH-mm-ss', 'en-US');

    const exportedData = this.data.map(row => {
      const exportedRow: Record<string, any> = {};
      for (const col of this.columns) {
        exportedRow[col.header] = col.type === 'link' && col.hrefKey ?
            row[col.hrefKey] :
            row[col.key];
        if (col.errorHeader && col.errorKey) {
          exportedRow[col.errorHeader] = row[col.errorKey] ?? '';
        }
      }
      if ('thoughts' in row) {
        exportedRow['Thoughts'] = row.thoughts || '';
      }
      if (this.rowErrorKey && this.rowErrorKey in row) {
        exportedRow['Error Code'] = row[this.rowErrorKey] || '';
      }
      if ('projectId' in row) {
        exportedRow['Project ID'] = row.projectId || '';
      }
      if ('region' in row) {
        exportedRow['Region'] = row.region || '';
      }
      if ('engineId' in row) {
        exportedRow['Engine ID'] = row.engineId || '';
      }
      if ('agentId' in row) {
        exportedRow['Agent ID'] = row.agentId || '';
      }
      if ('assistToken' in row) {
        exportedRow['Assist Token'] = row.assistToken || '';
      }
      if ('traceId' in row) {
        exportedRow['Trace ID'] = row.traceId || '';
      }
      return exportedRow;
    });

    this.csvService.exportCSV(
        exportedData, `${this.exportFileName}_${formattedDate}.csv`);
  }

  expandedCells: Map<string, boolean> = new Map();

  /**
   * Renders markdown text to HTML using marked library.
   * @param text The markdown text to render.
   * @returns The rendered HTML string.
   */
  renderMarkdown(text: string): string {
    if (!text) return '';
    if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
      try {
        return marked.parse(text, {breaks: true, gfm: true});
      } catch (e) {
        console.error('Failed to parse markdown with marked:', e);
      }
    }
    // Fallback to raw text with basic escaping and line breaks
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
  }

  /**
   * Truncates text to a specified limit.
   * @param text The text to truncate.
   * @param limit The maximum length of the text.
   * @returns The truncated text.
   */
  truncate(text: string, limit: number = 100): string {
    if (!text) return '';
    return text.length > limit ? text.substring(0, limit) + '...' : text;
  }

  /**
   * Toggles the expansion state of a specific cell.
   * @param rowIndex The index of the row.
   * @param key The column key.
   */
  toggleExpand(rowIndex: number, key: string) {
    const cellKey = `${rowIndex}-${key}`;
    this.expandedCells.set(cellKey, !this.expandedCells.get(cellKey));
  }

  /**
   * Checks if a specific cell is expanded.
   * @param rowIndex The index of the row.
   * @param key The column key.
   * @returns True if the cell is expanded, false otherwise.
   */
  isExpanded(rowIndex: number, key: string): boolean {
    return this.expandedCells.get(`${rowIndex}-${key}`) || false;
  }

  /**
   * The text color of a score cell: green from 0.8, yellow from 0.5 and red
   * below that.
   *
   * This and `deltaClass` are computed here rather than with `[ngClass]`
   * objects in the template. Angular compiles such an object into a call like
   * `f(v > 0.1, v < -0.1, v >= -0.1 && v <= 0.1)`, which the JS coverage
   * instrumenter parses as TypeScript: it reads `v < -0.1, v >` as type
   * arguments and fails, breaking coverage builds.
   *
   * @param score The cell value.
   * @returns The CSS class, or an empty string when the value does not convert
   *     to a number.
   */
  scoreClass(score: number): string {
    if (score >= 0.8) {
      return 'text-green-600';
    }
    if (score >= 0.5) {
      return 'text-yellow-600';
    }
    // Any number left is below 0.5; a value that does not convert to a number
    // gets no color.
    return isNaN(score) ? '' : 'text-red-600';
  }

  /**
   * The text color of a delta cell: green above 0.1, red below -0.1 and gray
   * in between.
   * @param delta The cell value.
   * @returns The CSS class, or an empty string when the value does not convert
   *     to a number.
   */
  deltaClass(delta: number): string {
    if (delta > 0.1) {
      return 'text-green-600';
    }
    if (delta < -0.1) {
      return 'text-red-600';
    }
    // Any number left is within -0.1 to 0.1; a value that does not convert to
    // a number gets no color.
    return isNaN(delta) ? '' : 'text-gray-600';
  }
}
