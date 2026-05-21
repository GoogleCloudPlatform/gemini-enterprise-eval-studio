import {Injectable, NgZone} from '@angular/core';

declare var Papa: any;

/**
 * Service for parsing and exporting CSV files.
 */
@Injectable({providedIn: 'root'})
export class CsvService {
  constructor(private ngZone: NgZone) {}

  /**
   * Parses a CSV file.
   * @param file The file to parse.
   * @param callback Callback function called with parsed data.
   * @param onError Callback function called on error.
   */
  parseCSV(
      file: File, callback: (data: Array<Record<string, string>>) => void,
      onError: (error: string) => void) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results: {data: Array<Record<string, string>>}) => {
        this.ngZone.run(() => {
          callback(results.data.slice(0, 100));
        });
      },
      error: (error: {message: string}) => {
        this.ngZone.run(() => {
          onError('Error parsing CSV: ' + error.message);
        });
      }
    });
  }

  /**
   * Exports data to a CSV file.
   * @param data The data to export.
   * @param filename The name of the file to create.
   */
  exportCSV(data: Array<object>, filename: string) {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], {type: 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
