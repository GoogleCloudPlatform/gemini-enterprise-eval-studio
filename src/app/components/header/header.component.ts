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
import {Component} from '@angular/core';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';

import {StateService} from '../../services/state.service';

/**
 * Component for the application header.
 * It displays the title based on the current active tab.
 */
@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html'
})
export class HeaderComponent {
  /** Observable of the mapped title string for the current active tab. */
  tabTitle$: Observable<string>;

  constructor(public stateService: StateService) {
    this.tabTitle$ = this.stateService.currentTab$.pipe(map(tab => this.getTabTitle(tab)));
  }

  /**
   * Returns the title string for the current active tab.
   */
  private getTabTitle(tab: string|null) {
    switch (tab) {
      case 'run':
        return 'Run Evaluation';
      case 'compare':
        return 'Compare Evals';
      case 'golden':
        return 'Get Golden';
      case 'about':
        return 'About Eval Studio';
      default:
        return 'Eval Studio';
    }
  }
}
