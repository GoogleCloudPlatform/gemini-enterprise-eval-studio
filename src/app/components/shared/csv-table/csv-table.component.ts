import {CommonModule} from '@angular/common';
import {Component, Input} from '@angular/core';

import {CsvService} from '../../../services/csv.service';

declare var marked: any;

/**
 * Defines the structure of a column in the CSV table.
 */
export interface ColumnDef {
  header: string;
  key: string;
  type?: 'text'|'markdown'|'number'|'score'|'delta';
  truncate?: boolean;
}

@Component({
  selector: 'app-csv-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './csv-table.component.html'
})
/**
 * Component for displaying CSV data in a table.
 * Supports markdown rendering, truncation, and expansion of cells.
 */
export class CsvTableComponent {
  @Input() data: any[] = [];
  @Input() columns: ColumnDef[] = [];
  @Input() title = '';
  @Input() exportFileName: string = 'eval_results';

  constructor(private csvService: CsvService) {}

  /**
   * Exports the table data to a CSV file.
   */
  exportResults() {
    this.csvService.exportCSV(
        this.data, `${this.exportFileName}_${new Date().getTime()}.csv`);
  }

  expandedCells: Map<string, boolean> = new Map();

  /**
   * Renders markdown text to HTML using marked library.
   * @param text The markdown text to render.
   * @returns The rendered HTML string.
   */
  renderMarkdown(text: string): string {
    if (!text) return '';
    return marked.parse(text);
  }

  /**
   * Truncates text to a specified limit.
   * @param text The text to truncate.
   * @param limit The maximum length of the text.
   * @returns The truncated text.
   */
  truncate(text: string, limit: number = 100): string {
    if (!text) return '';
    return text.length > limit ? text.substring(0, limit) + '...' : text;
  }

  /**
   * Toggles the expansion state of a specific cell.
   * @param rowIndex The index of the row.
   * @param key The column key.
   */
  toggleExpand(rowIndex: number, key: string) {
    const cellKey = `${rowIndex}-${key}`;
    this.expandedCells.set(cellKey, !this.expandedCells.get(cellKey));
  }

  /**
   * Checks if a specific cell is expanded.
   * @param rowIndex The index of the row.
   * @param key The column key.
   * @returns True if the cell is expanded, false otherwise.
   */
  isExpanded(rowIndex: number, key: string): boolean {
    return this.expandedCells.get(`${rowIndex}-${key}`) || false;
  }
}
