/**
 * Represents a row in the input CSV file.
 */
export interface CSVRow {
  query: string;
  golden: string;
  [key: string]: string;
}
