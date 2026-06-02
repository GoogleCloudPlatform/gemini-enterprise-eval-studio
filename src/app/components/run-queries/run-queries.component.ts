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
      key: 'golden',
      type: 'markdown',
      truncate: true
    },
    {header: 'TTFT', key: 'ttft', type: 'number'},
    {header: 'TFUFT', key: 'tfuft', type: 'number'},
    {header: 'Latency', key: 'latency', type: 'number'}
  ];
  goldenFile: File|null = null;
  goldenCsvRows: Array<Record<string, string>> = [];
  goldenResults: any[] = [];
  isProcessingGolden = false;
  goldenProgress = 0;
  totalRows = 0;
  completedRows = 0;

  constructor(
      private csvService: CsvService, private evalService: EvalService,
      private stateService: StateService,
      private cdr: ChangeDetectorRef) {}

  isConfigValid(): boolean {
    const config = this.stateService.getCurrentConfig();
    return !!(config.gCloudToken && config.projectId &&
        config.selectedEngine && config.selectedModel);
  }

  isStepSelectable(targetStep: number): boolean {
    if (targetStep === 1) {
      return true;
    }
    if (targetStep === 2) {
      return this.isConfigValid();
    }
    if (targetStep === 3) {
      return this.goldenResults.length > 0;
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

  startGoldenGeneration(event: {file: File, rows: any[]}) {
    this.goldenFile = event.file;
    this.goldenCsvRows = event.rows;
    this.runGoldenGeneration();
  }

  /**
   * Runs the golden response generation process for all rows.
   */
  async runGoldenGeneration() {
    this.isProcessingGolden = true;
    this.goldenResults = [];
    this.goldenProgress = 0;
    this.totalRows = this.goldenCsvRows.length;
    this.completedRows = 0;

    for (let i = 0; i < this.goldenCsvRows.length; i++) {
      const row = this.goldenCsvRows[i];

      const csvRow: any = {query: row['query']};
      const result = await this.evalService.processRow(csvRow);

      this.goldenResults.push({
        query: result.query,
        golden: result.fetched,
        ttft: result.ttft,
        tfuft: result.tfuft,
        latency: result.latency,
        assistToken: result.assistToken,
        projectId: result.projectId,
        region: result.region,
        engineId: result.engineId
      });

      this.completedRows++;
      this.goldenProgress =
          Math.round((this.completedRows / this.totalRows) * 100);
      this.cdr.detectChanges();
    }

    this.isProcessingGolden = false;
    this.step = 3;
    this.cdr.detectChanges();
  }
}
