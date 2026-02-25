export interface ExcludedRow {
  /** Original index in the raw 2D array */
  index: number;
  row: any[];
  /** Human-readable reason for exclusion, e.g. "empty", "no date-like value", "no numeric value" */
  reason: string;
}

export interface ParsedSheet {
  /** Full raw 2D array as returned by SheetJS */
  rawData: any[][];
  /** Best-guess index of the header row (0-based) */
  suggestedHeaderIndex: number;
  /** Cell values from the suggested header row */
  headers: string[];
  /** All rows above the header row (account info, bank name, etc.) */
  metadata: any[][];
  /** Rows below the header that pass movement detection */
  movements: any[][];
  /** Rows below the header that were skipped, with reasons */
  excluded: ExcludedRow[];
}