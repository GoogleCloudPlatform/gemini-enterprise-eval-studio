import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, OnDestroy, OnInit} from '@angular/core';
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

@Component({
  selector: 'app-run-evaluation',
  standalone: true,
  imports: [
    CommonModule, ConfigFormComponent, FileUploadComponent, CsvTableComponent,
    ProgressBarComponent
  ],
  templateUrl: './run-evaluation.component.html'
})
/**
 * Container component for the Run Evaluation tab, managing steps and evaluation
 * process.
 */
export class RunEvaluationComponent implements OnInit, OnDestroy {
  step = 1;
  isProcessing = false;
  progress = 0;
  results: any[] = [];
  totalRows = 0;
  completedRows = 0;
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
}
