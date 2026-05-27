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
  currentTab = 'golden';
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
