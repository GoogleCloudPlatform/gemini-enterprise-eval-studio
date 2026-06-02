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
import {ChangeDetectorRef, Component, EventEmitter, Input, Output} from '@angular/core';

import {CsvService} from '../../../services/csv.service';

/**
 * Component for uploading and parsing CSV files.
 * Validates required columns and emits events for navigation and execution.
 */
@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html'
})
export class FileUploadComponent {
  @Output() prev = new EventEmitter<void>();
  @Output() run = new EventEmitter<{file: File, rows: any[]}>();
  @Input() instruction = '';
  @Input() buttonText = 'Upload';
  @Input() requiredColumns: string[] = [];

  @Input() file: File|null = null;
  @Output() readonly fileChange = new EventEmitter<File|null>();
  @Input() csvRows: any[] = [];
  @Output() readonly csvRowsChange = new EventEmitter<any[]>();

  uploadError = '';
  isParsing = false;

  constructor(private csvService: CsvService, private cdr: ChangeDetectorRef) {}

  /** Prevents default drag behavior to allow drop. */
  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Handles the drop event for the file. */
  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  /** Handles the file selection event. */
  onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
    target.value = '';
  }

  /**
   * Handles the selected file, validates it, and parses CSV.
   * @param file The CSV file to handle.
   */
  handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.uploadError = 'Please upload a valid CSV file.';
      this.file = null;
      this.fileChange.emit(null);
      this.csvRows = [];
      this.csvRowsChange.emit([]);
      return;
    }
    this.file = file;
    this.fileChange.emit(file);
    this.uploadError = '';
    this.isParsing = true;
    this.csvService.parseCSV(file, (data) => {
      this.csvRows = data.map((row: any) => {
        const normalizedRow: any = {};
        for (const [key, value] of Object.entries(row)) {
          const normalizedKey = key.trim().replace(/^\ufeff/, '').toLowerCase();
          normalizedRow[normalizedKey] = value;
        }
        return normalizedRow;
      });
      this.isParsing = false;
      if (this.csvRows.length > 0) {
        const headers = Object.keys(this.csvRows[0]);
        // Normalize requiredColumns to lowercase to match the normalized headers.
        const lowerCaseRequiredColumns = this.requiredColumns.map(col => col.toLowerCase());
        const missingColumns = lowerCaseRequiredColumns.filter(col => !headers.includes(col));
        if (missingColumns.length > 0) {
          this.uploadError = `CSV must contain columns: ${this.requiredColumns.join(', ')}. Missing: ${missingColumns.join(', ')}`;
          this.file = null;
          this.fileChange.emit(null);
          this.csvRows = [];
          this.csvRowsChange.emit([]);
        } else {
          this.csvRowsChange.emit(this.csvRows);
        }
      } else {
        this.uploadError = 'CSV file is empty or contains no data rows.';
        this.file = null;
        this.fileChange.emit(null);
        this.csvRows = [];
        this.csvRowsChange.emit([]);
      }
      this.cdr.detectChanges();
    }, (err) => {
      this.uploadError = err;
      this.isParsing = false;
      this.file = null;
      this.fileChange.emit(null);
      this.csvRows = [];
      this.csvRowsChange.emit([]);
      this.cdr.detectChanges();
    });
  }

  /** Emits the prev event to go to the previous step. */
  onPrev() {
    this.prev.emit();
  }

  /** Emits the run event with the file and parsed rows. */
  onRun() {
    if (this.file) {
      this.run.emit({file: this.file, rows: this.csvRows});
    }
  }
}
