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
import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {CSVRow} from '../../models/csv-row.model';
import {ResultRow} from '../../models/result-row.model';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {ConfigFormComponent} from '../shared/config-form/config-form.component';
import {ColumnDef, CsvTableComponent} from '../shared/csv-table/csv-table.component';
import {FileUploadComponent} from '../shared/file-upload/file-upload.component';
import {ProgressBarComponent} from '../shared/progress-bar/progress-bar.component';

const MAX_CONCURRENT_REQUESTS_FOR_EVALUATION = 5;

/**
 * Container component for the Run Evaluation tab, managing steps and evaluation
 * process.
 */
@Component({
  selector: 'app-run-evaluation',
  standalone: true,
  imports: [
    CommonModule, ConfigFormComponent, FileUploadComponent, CsvTableComponent,
    ProgressBarComponent, FormsModule
  ],
  templateUrl: './run-evaluation.component.html'
})
export class RunEvaluationComponent implements OnInit, OnDestroy {
  step = 1;
  isProcessing = false;
  progress = 0;
  results: any[] = [];
  uploadedFile: File|null = null;
  uploadedRows: any[] = [];
  totalRows = 0;
  completedRows = 0;
  showReRateModal = false;
  reRateInstruction = '';
  errorMessage: string | null = null;
  private readonly destroy$ = new Subject<void>();
  private currentRunId = 0;

  private readonly allColumns: ColumnDef[] = [
    {header: 'Query', key: 'query', truncate: true},
    {header: 'Golden', key: 'golden', type: 'markdown', truncate: true},
    {header: 'Fetched', key: 'fetched', type: 'markdown', truncate: true},
    {header: 'Conversation', key: 'conversationId', truncate: true},
    {header: 'Turn', key: 'turn', type: 'number'},
    {header: 'TTFT (s)', key: 'ttft', type: 'number'},
    {header: 'TTFA (s)', key: 'ttfa', type: 'number'},
    {header: 'TTLT (s)', key: 'ttlt', type: 'number'},
    {header: 'Score', key: 'score', type: 'score'}, {
      header: 'Trace',
      key: 'traceUrl',
      type: 'link',
      linkText: 'View Trace'
    }
  ];

  get columns(): ColumnDef[] {
    const hasMultiTurn =
        this.uploadedRows.some(
            r => Boolean(r.conversationId?.trim() || r.turn?.trim())) ||
        this.results.some(
            r => r.conversationId !== undefined || r.turn !== undefined);
    return hasMultiTurn ?
        this.allColumns :
        this.allColumns.filter(
            c => c.key !== 'conversationId' && c.key !== 'turn');
  }

  constructor(
      private stateService: StateService, private evalService: EvalService,
      private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.stateService.results$.pipe(takeUntil(this.destroy$))
        .subscribe(r => this.results = r);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isConfigValid(): boolean {
    const config = this.stateService.getCurrentConfig();
    const engines = this.stateService.getEngines();
    const hasValidEngine = engines.some(e => e.name === config.selectedEngine);
    return !!(config.projectId &&
        config.selectedEngine && config.selectedModel &&
        hasValidEngine);
  }

  /** Determines if a specific step in the evaluation wizard is accessible. */
  isStepSelectable(targetStep: number): boolean {
    if (targetStep === 1) {
      return true;
    }
    if (targetStep === 2) {
      return this.isConfigValid();
    }
    if (targetStep === 3) {
      return this.results.length > 0 || this.isProcessing;
    }
    return false;
  }

  goToStep(targetStep: number) {
    if (this.isStepSelectable(targetStep)) {
      this.step = targetStep;
      this.cdr.detectChanges();
    }
  }

  /** Moves to the next step in the wizard. */
  nextStep() {
    if (this.step < 3) this.step++;
  }

  /** Moves to the previous step in the wizard. */
  prevStep() {
    if (this.step > 1) this.step--;
  }

  /**
   * Starts the evaluation process for the uploaded CSV rows.
   * @param event The event containing the file and parsed rows.
   */
  async startEvaluation(event: {file: File, rows: CSVRow[]}) {
    if (this.isProcessing) return;
    const runId = ++this.currentRunId;
    this.uploadedRows = event.rows;
    this.errorMessage = null;
    this.isProcessing = true;
    this.progress = 0;
    this.totalRows = event.rows.length;
    this.completedRows = 0;
    this.step = 3;
    this.stateService.setResults([]);
    this.cdr.detectChanges();
    const results: Array<ResultRow | undefined> = new Array(this.totalRows);

    if (this.totalRows === 0) return;

    // Rows sharing a conversationId are turns of one multi-turn
    // conversation and must run sequentially against the same Assistant
    // session (concurrent calls against one session race on context
    // visibility). Rows without a conversationId are independent
    // single-turn queries, each its own one-row "conversation" below, and
    // continue to run freely across the worker pool as before.
    const conversations = this.groupIntoConversations(event.rows);

    let targetIndex = 0;
    const tasks = conversations.map(turns => {
      const isMultiTurn = turns.length > 1;
      const indexedTurns =
          turns.map(row => ({row, resultIndex: targetIndex++}));

      return async () => {
        let session: string|undefined;
        let expectedTurn: number|undefined;
        let sequenceBroken = false;

        for (let i = 0; i < indexedTurns.length; i++) {
          if (runId !== this.currentRunId || !this.isProcessing) return;
          const {row, resultIndex} = indexedTurns[i];
          const currentTurn = this.toTurn(row.turn);

          if (isMultiTurn) {
            if (i === 0) {
              if (currentTurn === 0 || currentTurn === 1) {
                expectedTurn = currentTurn;
              } else {
                sequenceBroken = true;
              }
            }
            if (!sequenceBroken && currentTurn !== expectedTurn) {
              sequenceBroken = true;
            }
            if (sequenceBroken) {
              results[resultIndex] = {
                query: row.query,
                golden: row.golden,
                fetched: 'SKIPPED: Incorrect or missing turn ID.',
                ttft: 0,
                ttfa: 0,
                ttlt: 0,
                score: 0,
                conversationId: row.conversationId,
                turn: Number.isFinite(currentTurn) ? currentTurn : undefined,
              };
              this.stateService.setResults(
                  results.filter((r): r is ResultRow => r !== undefined));
              this.completedRows++;
              this.progress =
                  Math.round((this.completedRows / this.totalRows) * 100);
              this.cdr.detectChanges();
              continue;
            }
            expectedTurn!++;
          }

          const result =
              await this.evalService.processRow(row, undefined, session);
          session = result.session;
          if (runId !== this.currentRunId || !this.isProcessing) return;

          if (result.scoreError && !this.errorMessage) {
            this.errorMessage =
                `Scoring failed for some rows: ${result.scoreError}`;
          }

          results[resultIndex] = {
            ...result,
            conversationId: isMultiTurn ? row.conversationId : undefined,
            turn: isMultiTurn ? currentTurn : undefined,
          };
          this.stateService.setResults(
              results.filter((r): r is ResultRow => r !== undefined));
          this.completedRows++;
          this.progress =
              Math.round((this.completedRows / this.totalRows) * 100);
          this.cdr.detectChanges();
        }
      };
    });

    let index = 0;
    const worker = async () => {
      while (index < tasks.length) {
        const currentIndex = index++;
        await tasks[currentIndex]();
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT_REQUESTS_FOR_EVALUATION, tasks.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (this.isProcessing) {
      this.progress = 100;
    }
    if (runId === this.currentRunId) {
      this.isProcessing = false;
      this.cdr.detectChanges();
    }
  }

  /** Opens the re-rate modal and loads active instructions. */
  openReRateModal() {
    const config = this.stateService.getCurrentConfig();
    this.reRateInstruction = config.autoRaterInstruction || '';
    this.showReRateModal = true;
    this.cdr.detectChanges();
  }

  /** Re-rates current evaluation results using updated instructions. */
  async startReRate() {
    if (this.isProcessing) return;
    this.showReRateModal = false;
    this.isProcessing = true;
    this.progress = 0;
    this.totalRows = this.results.length;
    this.completedRows = 0;
    this.cdr.detectChanges();

    const config = this.stateService.getCurrentConfig();
    config.autoRaterInstruction = this.reRateInstruction;
    this.stateService.setConfig(config);

    this.errorMessage = null;
    const newResults: ResultRow[] = [];

    for (let i = 0; i < this.results.length; i++) {
      if (!this.isProcessing) {
        for (let j = i; j < this.results.length; j++) {
          newResults.push(this.results[j]);
        }
        break;
      }
      const row = this.results[i];
      this.progress = Math.round((i / this.totalRows) * 100);
      this.cdr.detectChanges();

      let score = 0;
      if (row.golden && row.fetched) {
        try {
          score = await this.evalService.scoreResponse(
              row.query, row.fetched, row.golden, config);
        } catch (error) {
          this.errorMessage = `Re-rating failed: ${(error as Error).message}`;
          // Push the remaining rows unchanged
          for (let j = i; j < this.results.length; j++) {
            newResults.push(this.results[j]);
          }
          break;
        }
      }
      if (!this.isProcessing) {
        for (let j = i; j < this.results.length; j++) {
          newResults.push(this.results[j]);
        }
        break;
      }

      newResults.push({
        ...row,
        score
      });

      this.completedRows++;
      this.cdr.detectChanges();
    }

    if (!this.errorMessage && this.isProcessing) {
      this.progress = 100;
    }
    this.stateService.setResults(newResults);
    this.isProcessing = false;
    this.cdr.detectChanges();
  }

  /** Stops the current evaluation or re-rating process mid-way. */
  stopEvaluation() {
    this.isProcessing = false;
    this.cdr.detectChanges();
  }

  /**
   * Groups rows by conversationId, preserving each group's first-seen
   * position in the input. Rows within a group are sorted by their `turn`
   * value (ascending); rows without a `turn` keep their original relative
   * order. Rows with no conversationId each become their own
   * single-row group, matching today's single-turn behavior.
   */
  private groupIntoConversations(rows: CSVRow[]): CSVRow[][] {
    const order: string[] = [];
    const groups = new Map<string, CSVRow[]>();
    let singletonIndex = 0;

    for (const row of rows) {
      const id = row.conversationId?.trim();
      if (!id) {
        const key = `__single_${singletonIndex++}`;
        order.push(key);
        groups.set(key, [row]);
        continue;
      }
      if (!groups.has(id)) {
        order.push(id);
        groups.set(id, []);
      }
      groups.get(id)!.push(row);
    }

    for (const [id, groupRows] of groups) {
      if (!id.startsWith('__single_')) {
        groupRows.sort(
            (a, b) => (this.toTurn(a.turn) - this.toTurn(b.turn)) || 0);
      }
    }

    return order.map(id => groups.get(id)!);
  }

  private toTurn(t?: string, fallback = Infinity): number {
    const num = t?.trim() ? Number(t) : fallback;
    return Number.isNaN(num) ? fallback : num;
  }
}
