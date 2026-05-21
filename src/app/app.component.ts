import {CommonModule} from '@angular/common';
import {Component, OnDestroy, OnInit} from '@angular/core';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';

import {AboutComponent} from './components/about/about.component';
import {CompareEvalsComponent} from './components/compare-evals/compare-evals.component';
import {GetGoldenComponent} from './components/get-golden/get-golden.component';
import {HeaderComponent} from './components/header/header.component';
import {RunEvaluationComponent} from './components/run-evaluation/run-evaluation.component';
import {SidebarComponent} from './components/sidebar/sidebar.component';
import {StateService} from './services/state.service';

/**
 * Main shell component for the application.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, SidebarComponent, HeaderComponent, RunEvaluationComponent,
    CompareEvalsComponent, GetGoldenComponent, AboutComponent
  ],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  currentTab = 'run';
  private readonly destroy$ = new Subject<void>();

  constructor(private stateService: StateService) {}

  ngOnInit() {
    this.stateService.currentTab$
      .pipe(takeUntil(this.destroy$))
      .subscribe(tab => this.currentTab = tab);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
