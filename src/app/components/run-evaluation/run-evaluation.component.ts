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
import {Subject} from 'rxjs';
import {distinctUntilChanged, map, takeUntil} from 'rxjs/operators';

import {AppConfig} from '../../models/app-config.model';
import {CSVRow} from '../../models/csv-row.model';
import {ResultRow} from '../../models/result-row.model';
import {scoreColumnHeader, scoreErrorColumnHeader} from '../../scoring/score-columns';
import {Scorer, ScorerRunResult, firstScorerError} from '../../scoring/scorer';
import {ScorerRegistry} from '../../scoring/scorer.registry';
import {ScorerSelection} from '../../scoring/scorer-selection';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {ConfigFormComponent} from '../shared/config-form/config-form.component';
import {ColumnDef, CsvTableComponent} from '../shared/csv-table/csv-table.component';
import {FileUploadComponent} from '../shared/file-upload/file-upload.component';
import {ProgressBarComponent} from '../shared/progress-bar/progress-bar.component';
import {ScoringSetupComponent} from '../shared/scoring-setup/scoring-setup.component';

const MAX_CONCURRENT_REQUESTS_FOR_EVALUATION = 5;

/** The columns shown before the scores, whichever scorers ran. */
const BASE_COLUMNS: readonly ColumnDef[] = [
  {header: 'Query', key: 'query', truncate: true},
  {header: 'Golden', key: 'golden', type: 'markdown', truncate: true},
  {header: 'Fetched', key: 'fetched', type: 'markdown', truncate: true},
  {header: 'Conversation', key: 'conversationId', truncate: true},
  {header: 'Turn', key: 'turn', type: 'number'},
  {header: 'TTFT (s)', key: 'ttft', type: 'number'},
  {header: 'TTFA (s)', key: 'ttfa', type: 'number'},
  {header: 'TTLT (s)', key: 'ttlt', type: 'number'},
];

/** The Trace link column shown after the score columns. */
const TRACE_COLUMN: ColumnDef = {
  header: 'Trace',
  key: 'traceUrl',
  type: 'link',
  linkText: 'View Trace'
};

/** Column key holding a given scorer's score on a displayed row. */
function scoreKey(scorerId: string): string {
  return `score_${scorerId}`;
}

/** Column key holding a given scorer's error on a displayed row. */
function scoreErrorKey(scorerId: string): string {
  return `scoreError_${scorerId}`;
}

/** Whether two scorer id lists name the same scorers in the same order. */
function sameIds(
    a: readonly string[]|undefined, b: readonly string[]|undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Container component for the Run Evaluation tab, managing steps and evaluation
 * process.
 */
@Component({
  selector: 'app-run-evaluation',
  standalone: true,
  imports: [
    CommonModule, ConfigFormComponent, FileUploadComponent, CsvTableComponent,
    ProgressBarComponent, ScoringSetupComponent
  ],
  templateUrl: './run-evaluation.component.html'
})
export class RunEvaluationComponent implements OnInit, OnDestroy {
  step = 1;
  isProcessing = false;
  progress = 0;
  results: ResultRow[] = [];
  uploadedFile: File|null = null;
  uploadedRows: any[] = [];
  totalRows = 0;
  completedRows = 0;
  /**
   * A draft copy of the run configuration for the re-rate dialog to edit.
   * Null while the dialog is closed. Cancelling discards the draft; re-rating
   * saves it.
   */
  reRateConfig: AppConfig|null = null;
  /** Names of the scoring methods selected in the re-rate dialog. */
  selectedScorersLabel = '';
  /**
   * Why the re-rate dialog's scoring setup cannot run, or null if it can.
   * Uses the same validation as the configuration form.
   */
  reRateValidationError: string|null = null;
  errorMessage: string | null = null;
  private readonly destroy$ = new Subject<void>();
  private currentRunId = 0;
  /**
   * Whether the current click started with a press on the re-rate dialog's
   * backdrop, so a text selection dragged out of the dialog does not close it.
   */
  private reRateBackdropPressed = false;

  /**
   * Every column the results table can show. `columns` hides the
   * conversation and turn columns for single-turn runs.
   */
  private allColumns: ColumnDef[] = [...BASE_COLUMNS, TRACE_COLUMN];

  /** The selected scorers, each with a score column, in display order. */
  private scorerColumns: readonly Scorer[] = [];

  /**
   * `results` flattened for the table and the CSV export: one column per
   * scorer instead of the nested `scorerResults` array.
   */
  displayResults: Array<Record<string, unknown>> = [];

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
      private scorerRegistry: ScorerRegistry,
      private scorerSelection: ScorerSelection, private cdr: ChangeDetectorRef) {
  }

  ngOnInit() {
    // config$ emits on every form edit; only a change of scorer selection
    // should touch the columns.
    this.stateService.config$
        .pipe(
            map(config => config.selectedScorers),
            distinctUntilChanged(sameIds), takeUntil(this.destroy$))
        .subscribe(selectedIds => {
          this.updateColumns(selectedIds);
          this.refreshDisplayResults();
        });
    this.stateService.results$.pipe(takeUntil(this.destroy$)).subscribe(r => {
      this.results = r;
      this.refreshDisplayResults();
    });
  }

  /**
   * Rebuilds the table columns from the scorers selected in the configuration.
   * Runs only when that selection changes, so the columns stay fixed for the
   * whole run instead of shifting as rows arrive. Each score column is paired
   * with its error column up front for the same reason.
   * @param selectedIds The scorer ids selected in the configuration.
   */
  private updateColumns(selectedIds?: readonly string[]) {
    this.scorerColumns = this.scorerRegistry.resolveAll(selectedIds);
    this.allColumns = [
      ...BASE_COLUMNS,
      ...this.scorerColumns.flatMap((scorer): ColumnDef[] => [
        {
          header: scoreColumnHeader(scorer.displayName),
          key: scoreKey(scorer.id),
          type: 'score'
        },
        {
          header: scoreErrorColumnHeader(scorer.displayName),
          key: scoreErrorKey(scorer.id),
          truncate: true
        },
      ]),
      TRACE_COLUMN,
    ];
  }

  /**
   * Flattens `results` into `displayResults` against the current score
   * columns, so the table and the CSV export stay tabular. Leaves the columns
   * themselves untouched.
   */
  private refreshDisplayResults() {
    this.displayResults = this.results.map(row => {
      const {scorerResults, ...rest} = row;
      const flat: Record<string, unknown> = {...rest};
      for (const {id} of this.scorerColumns) {
        const result = scorerResults.find(r => r.scorerId === id);
        flat[scoreKey(id)] = result ? result.score : '';
        flat[scoreErrorKey(id)] = result?.error ?? '';
      }
      return flat;
    });
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
                scorerResults: [],
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

          const scoreError = firstScorerError(result.scorerResults);
          if (scoreError && !this.errorMessage) {
            this.errorMessage = `Scoring failed for some rows: ${scoreError}`;
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

  /** Gets the scoring strategies selected in the configuration, in run order. */
  private getSelectedScorers(): readonly Scorer[] {
    return this.scorerRegistry.resolveAll(
        this.stateService.getCurrentConfig().selectedScorers);
  }

  /**
   * Opens the re-rate dialog on a copy of the active configuration, so the
   * whole scoring setup can be adjusted and then either applied or dropped.
   */
  openReRateModal() {
    const draft = structuredClone(this.stateService.getCurrentConfig());
    this.scorerSelection.normalize(draft);
    this.reRateConfig = draft;
    this.refreshReRateDialog();
    this.cdr.detectChanges();
  }

  /** Closes the re-rate dialog, discarding any unapplied edits. */
  closeReRateModal() {
    this.reRateConfig = null;
    this.refreshReRateDialog();
    this.cdr.detectChanges();
  }

  /**
   * Recomputes the dialog's scorer names and validation error from the draft.
   * Called on open and on every edit, rather than evaluating them from the
   * template on each change detection pass.
   */
  refreshReRateDialog() {
    const draft = this.reRateConfig;
    this.selectedScorersLabel = draft ?
        this.scorerSelection.selected(draft)
            .map(scorer => scorer.displayName)
            .join(', ') :
        '';
    this.reRateValidationError =
        draft ? this.scorerSelection.validate(draft) ?? null : null;
  }

  /** Records whether a press on the re-rate overlay landed on the backdrop. */
  onReRateBackdropMouseDown(event: MouseEvent) {
    this.reRateBackdropPressed = event.target === event.currentTarget;
  }

  /**
   * Closes the re-rate dialog when the backdrop around it is clicked. Clicks
   * inside the dialog, or drags that start inside it, leave it open.
   */
  onReRateBackdropClick(event: MouseEvent) {
    const onBackdrop =
        this.reRateBackdropPressed && event.target === event.currentTarget;
    this.reRateBackdropPressed = false;
    if (onBackdrop) {
      this.closeReRateModal();
    }
  }

  /**
   * Re-scores the current results with the re-rate dialog's scoring setup,
   * without re-fetching the responses. Does nothing unless the dialog is open
   * with a valid setup and no other run is in progress.
   */
  async startReRate() {
    // The Re-rate button only exists inside the open dialog, so there is
    // always a draft to apply.
    const config = this.reRateConfig;
    if (!config || this.isProcessing) return;
    // The button is disabled while the setup is invalid, and the dialog shows
    // why. Checking again keeps an empty selection from silently falling back
    // to the default scorer.
    if (this.scorerSelection.validate(config)) return;

    // The dialog's edits become the run's configuration, so the results table
    // and any later run agree on which methods were applied.
    this.stateService.setConfig(config);
    this.reRateConfig = null;
    this.refreshReRateDialog();

    this.isProcessing = true;
    this.progress = 0;
    this.totalRows = this.results.length;
    this.completedRows = 0;
    this.cdr.detectChanges();

    const scorers = this.scorerSelection.selected(config);

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

      // Every scorer runs, one after another, so an unfetched row still gets
      // an entry per scorer and the score columns stay aligned.
      const scorerResults: ScorerRunResult[] = row.fetched ?
          await this.evalService.scoreAll({
            query: row.query,
            response: row.fetched,
            golden: row.golden,
            config
          }) :
          scorers.map(scorer => ({
                        scorerId: scorer.id,
                        displayName: scorer.displayName,
                        score: 0,
                        skipped: true
                      }));

      if (!this.isProcessing) {
        for (let j = i; j < this.results.length; j++) {
          newResults.push(this.results[j]);
        }
        break;
      }

      const scoreError = firstScorerError(scorerResults);
      if (scoreError) {
        // Stop on the first failure rather than replaying the same broken
        // credentials or quota against every remaining row.
        this.errorMessage = `Re-rating failed: ${scoreError}`;
        for (let j = i; j < this.results.length; j++) {
          newResults.push(this.results[j]);
        }
        break;
      }
      newResults.push({...row, scorerResults});

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
