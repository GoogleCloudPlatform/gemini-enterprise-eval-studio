import {CommonModule} from '@angular/common';
import {Component, Input} from '@angular/core';

/**
 * Component for displaying an information tooltip.
 */
@Component({
  selector: 'app-info-tooltip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './info-tooltip.component.html'
})
export class InfoTooltipComponent {
  @Input() text = '';
}
