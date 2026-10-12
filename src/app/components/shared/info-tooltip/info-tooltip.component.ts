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
import {ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, ViewChild} from '@angular/core';

/**
 * Component for displaying an information tooltip.
 */
@Component({
  selector: 'app-info-tooltip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './info-tooltip.component.html'
})
export class InfoTooltipComponent implements OnDestroy {
  @Input() text = '';
  @Input() icon: 'info'|'question' = 'info';
  @Input() align: 'left'|'right' = 'left';

  @ViewChild('trigger') triggerRef?: ElementRef<HTMLElement>;

  tooltipStyle: Record<string, string> = {};

  constructor(private readonly cdr: ChangeDetectorRef) {}

  private readonly onViewportChange = () => {
    this.updatePosition();
    this.cdr.markForCheck();
  };

  onMouseEnter() {
    this.updatePosition();
    if (this.align === 'right') {
      window.addEventListener('scroll', this.onViewportChange, true);
      window.addEventListener('resize', this.onViewportChange);
    }
  }

  onMouseLeave() {
    this.removeViewportListeners();
  }

  ngOnDestroy() {
    this.removeViewportListeners();
  }

  updatePosition() {
    if (this.align !== 'right' || !this.triggerRef) {
      return;
    }
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    this.tooltipStyle = {
      bottom: `${window.innerHeight - rect.top + 8}px`,
      right: `${window.innerWidth - rect.right}px`,
    };
  }

  private removeViewportListeners() {
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
  }
}
