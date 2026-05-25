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

import {StateService} from '../../services/state.service';

/**
 * Sidebar component for navigation.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html'
})
export class SidebarComponent {
  /** Observable of the current active tab. */
  currentTab$: Observable<string>;
  isCollapsed = false;

  constructor(private stateService: StateService) {
    this.currentTab$ = this.stateService.currentTab$;
  }

  /** Sets the current active tab. */
  setTab(tab: string) {
    this.stateService.setTab(tab);
  }

  /** Toggles the sidebar collapse state. */
  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
  }
}
