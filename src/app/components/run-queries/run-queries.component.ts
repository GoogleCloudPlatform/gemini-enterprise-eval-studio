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

import {CsvService} from '../../services/csv.service';
import {EvalService} from '../../services/eval.service';
import {StateService} from '../../services/state.service';
import {ConfigFormComponent} from '../shared/config-form/config-form.component';
import {ColumnDef, CsvTableComponent} from '../shared/csv-table/csv-table.component';
import {FileUploadComponent} from '../shared/file-upload/file-upload.component';
import {ProgressBarComponent} from '../shared/progress-bar/progress-bar.component';

const MAX_CONCURRENT_REQUESTS_FOR_QUERIES = 5;

/**
 * Component for running queries and generating responses.
 * It handles file upload, processing, and exporting results.
 */
@Component({
  selector: 'app-run-queries',
  standalone: true,
  imports: [
    CommonModule, ConfigFormComponent, FileUploadComponent,
    CsvTableComponent, ProgressBarComponent
  ],
  templateUrl: './run-queries.component.html'
})
export class RunQueriesComponent {
  step = 1;
  columns: ColumnDef[] = [
    {header: 'Query', key: 'query', truncate: true}, {
      header: 'Response',
      key: 'response',
      type: 'markdown',
      truncate: true
    },
    {header: 'TTFT (s)', key: 'ttft', type: 'number'},
    {header: 'TTFA (s)', key: 'ttfa', type: 'number'},
    {header: 'TTLT (s)', key: 'ttlt', type: 'number'}
  ];
  responseFile: File|null = null;
  responseCsvRows: Array<Record<string, string>> = [];
  responseResults: any[] = [];
  isProcessingResponse = false;
  responseProgress = 0;
  totalRows = 0;
  completedRows = 0;
  private currentRunId = 0;

  constructor(
      private csvService: CsvService, private evalService: EvalService,
      private stateService: StateService,
      private cdr: ChangeDetectorRef) {}

  isConfigValid(): boolean {
    const config = this.stateService.getCurrentConfig();
    const engines = this.stateService.getEngines();
    const hasValidEngine = engines.some(e => e.name === config.selectedEngine);
    return !!(config.gCloudToken && config.projectId &&
        config.selectedEngine && config.selectedModel &&
        hasValidEngine);
  }

  isStepSelectable(targetStep: number): boolean {
    if (targetStep === 1) {
      return true;
    }
    if (targetStep === 2) {
      return this.isConfigValid();
    }
    if (targetStep === 3) {
      return this.responseResults.length > 0 || this.isProcessingResponse;
    }
    return false;
  }

  goToStep(targetStep: number) {
    if (this.isStepSelectable(targetStep)) {
      this.step = targetStep;
      this.cdr.detectChanges();
    }
  }

  nextStep() {
    if (this.step < 3) {
      this.step++;
    }
  }

  prevStep() {
    if (this.step > 1) {
      this.step--;
    }
  }

  startResponseGeneration(event: {file: File, rows: any[]}) {
    this.responseFile = event.file;
    this.responseCsvRows = event.rows;
    this.runResponseGeneration();
  }

  /**
   * Runs the response generation process for all rows.
   */
  async runResponseGeneration() {
    if (this.isProcessingResponse) return;
    const runId = ++this.currentRunId;
    this.isProcessingResponse = true;
    this.responseResults = [];
    this.responseProgress = 0;
    this.totalRows = this.responseCsvRows.length;
    this.completedRows = 0;
    this.step = 3;
    this.cdr.detectChanges();

    const tasks = this.responseCsvRows.map(row => async () => {
      if (runId !== this.currentRunId || !this.isProcessingResponse) return;

      const csvRow: any = {query: row['query']};
      const result = await this.evalService.processRow(csvRow);
      if (runId !== this.currentRunId || !this.isProcessingResponse) return;

      this.responseResults = [
        ...this.responseResults, {
          query: result.query,
          response: result.fetched,
          ttft: result.ttft,
          ttfa: result.ttfa,
          ttlt: result.ttlt,
          assistToken: result.assistToken,
          projectId: result.projectId,
          region: result.region,
          engineId: result.engineId
        }
      ];

      this.completedRows++;
      this.responseProgress =
          Math.round((this.completedRows / this.totalRows) * 100);
      this.cdr.detectChanges();
    });

    let index = 0;
    const worker = async () => {
      while (index < tasks.length) {
        const currentIndex = index++;
        await tasks[currentIndex]();
      }
    };

    const workers = [];
    for (let i = 0;
         i < Math.min(MAX_CONCURRENT_REQUESTS_FOR_QUERIES, tasks.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (runId === this.currentRunId) {
      this.isProcessingResponse = false;
      this.cdr.detectChanges();
    }
  }

  stopResponseGeneration() {
    this.isProcessingResponse = false;
    this.cdr.detectChanges();
  }
}
