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

  columns: ColumnDef[] = [
    {header: 'Query', key: 'query', truncate: true},
    {header: 'Golden', key: 'golden', truncate: true},
    {header: 'Fetched', key: 'fetched', type: 'markdown', truncate: true},
    {header: 'TTFT', key: 'ttft', type: 'number'},
    {header: 'TFUFT', key: 'tfuft', type: 'number'},
    {header: 'Latency', key: 'latency', type: 'number'},
    {header: 'Score', key: 'score', type: 'score'}
  ];

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
    return !!(config.gCloudToken && config.projectId &&
        config.selectedEngine && config.selectedModel &&
        hasValidEngine &&
        config.geminiApiKey);
  }

  isStepSelectable(targetStep: number): boolean {
    if (targetStep === 1) {
      return true;
    }
    if (targetStep === 2) {
      return this.isConfigValid();
    }
    if (targetStep === 3) {
      return this.results.length > 0;
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
    this.errorMessage = null;
    this.isProcessing = true;
    this.progress = 0;
    this.totalRows = event.rows.length;
    this.completedRows = 0;
    this.cdr.detectChanges();
    const results: ResultRow[] = [];

    const config = this.stateService.getCurrentConfig();
    const hasScoreStep = !!config.geminiApiKey;
    const stepsPerRow = hasScoreStep ? 2 : 1;
    const totalSteps = event.rows.length * stepsPerRow;
    if (totalSteps === 0) return;

    for (let i = 0; i < event.rows.length; i++) {
      const row = event.rows[i];

      const result = await this.evalService.processRow(row, (step) => {
        const currentStep = i * stepsPerRow + (step === 'fetch' ? 0 : 1);
        this.progress = Math.round((currentStep / totalSteps) * 100);
        this.cdr.detectChanges();
      });

      if (result.scoreError && !this.errorMessage) {
        this.errorMessage = `Scoring failed for some rows: ${result.scoreError}`;
      }

      results.push(result);
      this.completedRows++;
      this.cdr.detectChanges();
    }

    this.progress = 100;
    this.stateService.setResults(results);
    this.isProcessing = false;
    this.step = 3;
    this.cdr.detectChanges();
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
      const row = this.results[i];
      this.progress = Math.round((i / this.totalRows) * 100);
      this.cdr.detectChanges();

      let score = 0;
      if (config.geminiApiKey && row.golden && row.fetched) {
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

      newResults.push({
        ...row,
        score
      });

      this.completedRows++;
      this.cdr.detectChanges();
    }

    if (!this.errorMessage) {
      this.progress = 100;
    }
    this.stateService.setResults(newResults);
    this.isProcessing = false;
    this.cdr.detectChanges();
  }
}
