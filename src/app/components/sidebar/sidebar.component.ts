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
