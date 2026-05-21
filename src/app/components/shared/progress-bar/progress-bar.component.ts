import {CommonModule} from '@angular/common';
import {Component, Input} from '@angular/core';

/**
 * Component for displaying a progress bar with optional text.
 */
@Component({
  selector: 'app-progress-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-bar.component.html'
})
export class ProgressBarComponent {
  @Input() progress = 0;
  @Input() text = '';
}
