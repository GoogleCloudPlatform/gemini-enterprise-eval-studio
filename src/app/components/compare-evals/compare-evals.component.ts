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

import {ComparisonResult, ScoreComparison} from '../../models/comparison-result.model';
import {ScoreColumn, findScoreColumns, scoreColumnHeader} from '../../scoring/score-columns';
import {CsvService} from '../../services/csv.service';
import {CsvTableComponent, ColumnDef} from '../shared/csv-table/csv-table.component';

/** Columns, besides the score columns, that every uploaded CSV must have. */
const REQUIRED_COLUMNS = ['query', 'fetched'];

/** The Query column leading the comparison table. */
const QUERY_COLUMN: ColumnDef = {header: 'Query', key: 'query', truncate: true};

/**
 * A scorer present in both uploaded CSVs, with the normalized column keys its
 * scores sit under in each.
 */
interface SharedScorer {
  scorer: string;
  baselineKey: string;
  recentKey: string;
}

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
  baselineScoreColumns: ScoreColumn[] = [];
  recentFile: File|null = null;
  recentRows: Array<Record<string, string>> = [];
  recentScoreColumns: ScoreColumn[] = [];
  comparisonResults: ComparisonResult[] = [];
  isDraggingBaseline = false;
  isDraggingRecent = false;
  baselineError: string|null = null;
  recentError: string|null = null;
  /** Why the last comparison produced no results, if it failed. */
  compareError: string|null = null;

  /** The comparison table's columns: three per scorer shared by both CSVs. */
  columns: ColumnDef[] = [QUERY_COLUMN];

  /**
   * `comparisonResults` flattened for the table and the CSV export: one
   * baseline, recent and delta column per scorer.
   */
  displayResults: Array<Record<string, unknown>> = [];

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
      const headers =
          data.length > 0 ? Object.keys(data[0]).map(cleanHeader) : [];
      // Score columns are found before the headers are lowercased, so the
      // comparison can show the scorer names as they were exported.
      const scoreColumns = findScoreColumns(headers);
      const normalizedData = this.normalizeRows(data);

      if (normalizedData.length > 0) {
        const normalizedHeaders = headers.map(header => header.toLowerCase());
        const missingColumns = REQUIRED_COLUMNS.filter(
            col => !normalizedHeaders.includes(col));
        if (scoreColumns.length === 0) {
          missingColumns.push(scoreColumnHeader('<scoring method>'));
        }

        if (missingColumns.length > 0) {
          const error = `CSV must contain columns: query, fetched and at ` +
              `least one "${scoreColumnHeader('<scoring method>')}" ` +
              `column. Missing columns - ${missingColumns.join(', ')}`;
          if (type === 'baseline') {
            this.baselineFile = null;
            this.baselineError = error;
          } else {
            this.recentFile = null;
            this.recentError = error;
          }
          this.cdr.detectChanges();
          return;
        }
      }

      if (type === 'baseline') {
        this.baselineRows = normalizedData;
        this.baselineScoreColumns = scoreColumns;
      } else {
        this.recentRows = normalizedData;
        this.recentScoreColumns = scoreColumns;
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
        normalizedRow[cleanHeader(key).toLowerCase()] = value;
      }
      return normalizedRow;
    });
  }

  /**
   * The scorers present in both uploaded CSVs, matched by name regardless of
   * case, in baseline order.
   */
  private sharedScorers(): SharedScorer[] {
    const recentByScorer = new Map(this.recentScoreColumns.map(
        column => [column.scorer.toLowerCase(), column]));
    return this.baselineScoreColumns.flatMap(baseline => {
      const recent = recentByScorer.get(baseline.scorer.toLowerCase());
      if (!recent) {
        return [];
      }
      return [{
        scorer: baseline.scorer,
        baselineKey: baseline.header.toLowerCase(),
        recentKey: recent.header.toLowerCase(),
      }];
    });
  }

  /** Compares baseline and recent evaluations. */
  compareEvals() {
    this.comparisonResults = [];
    this.displayResults = [];
    this.compareError = null;

    const scorers = this.sharedScorers();
    this.columns = [
      QUERY_COLUMN,
      ...scorers.flatMap((shared, i) => [
        {
          header: `${shared.scorer} Baseline`,
          key: baselineScoreKey(i),
          type: 'number' as const
        },
        {
          header: `${shared.scorer} Recent`,
          key: recentScoreKey(i),
          type: 'number' as const
        },
        {
          header: `${shared.scorer} Delta`,
          key: deltaKey(i),
          type: 'delta' as const
        },
      ]),
    ];
    if (scorers.length === 0) {
      this.compareError =
          'The two CSVs share no scoring method, so there is nothing to ' +
          'compare. Re-run one of them with a common scoring method.';
      this.cdr.detectChanges();
      return;
    }

    const recentMap = new Map(this.recentRows.map(r => [r['query'], r]));

    this.baselineRows.forEach(baseRow => {
      const recentRow = recentMap.get(baseRow['query']);
      if (recentRow) {
        const scores = scorers.map((shared): ScoreComparison => {
          const baselineScore = parseScore(baseRow[shared.baselineKey]);
          const recentScore = parseScore(recentRow[shared.recentKey]);
          const delta = baselineScore === null || recentScore === null ?
              null :
              Number((recentScore - baselineScore).toFixed(2));
          return {scorer: shared.scorer, baselineScore, recentScore, delta};
        });

        const baselineResponse = baseRow['fetched'] || baseRow['fetchedresponse'] || 'N/A';
        const recentResponse = recentRow['fetched'] || recentRow['fetchedresponse'] || 'N/A';

        this.comparisonResults.push({
          query: baseRow['query'],
          scores,
          baselineResponse,
          recentResponse
        });
      }
    });

    this.displayResults = this.comparisonResults.map(result => {
      const flat: Record<string, unknown> = {query: result.query};
      result.scores.forEach((score, i) => {
        flat[baselineScoreKey(i)] = score.baselineScore ?? '';
        flat[recentScoreKey(i)] = score.recentScore ?? '';
        flat[deltaKey(i)] = score.delta ?? '';
      });
      return flat;
    });
    this.cdr.detectChanges();
  }
}

/** Strips the whitespace and byte order mark a CSV header may carry. */
function cleanHeader(header: string): string {
  return header.trim().replace(/^\ufeff/, '');
}

/**
 * Reads a score cell.
 * @param value The raw cell value.
 * @returns The score, or null when the cell is empty or not a number, such as
 *     for a row the scorer skipped.
 */
function parseScore(value: string|undefined): number|null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const score = Number(trimmed);
  return isNaN(score) ? null : score;
}

/** Column key of the i-th shared scorer's baseline score. */
function baselineScoreKey(i: number): string {
  return `baseline_${i}`;
}

/** Column key of the i-th shared scorer's recent score. */
function recentScoreKey(i: number): string {
  return `recent_${i}`;
}

/** Column key of the i-th shared scorer's score delta. */
function deltaKey(i: number): string {
  return `delta_${i}`;
}
