import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { ExcludedRow, ParsedSheet } from '../models/parsed-sheet.model';

/**
 * Matches common date formats regardless of locale:
 *   DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, D.M.YY, etc.
 * A cell is "date-like" if it contains two separators of the same type
 * surrounding short numeric groups.
 */
const DATE_PATTERN = /^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/;

@Injectable({
  providedIn: 'root',
})
export class ExcelParserService {
  // ---------------------------------------------------------------------------
  // Task 1.1 – Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parses an Excel file and returns a raw 2D array.
   * Uses the modern ArrayBuffer approach to avoid SheetJS auto-conversion issues.
   */
  async parseExcel(file: File): Promise<any[][]> {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // header: 1  → 2D array [row][column]
      // raw: false → everything as string so we control number/date parsing
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];

      return data;
    } catch (error) {
      console.error('Error parsing Excel:', error);
      throw error;
    }
  }

  /**
   * Handles Portuguese and English number formats.
   * Heuristic: comma is the decimal separator when it appears after the last dot.
   */
  parseLocalizedNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (!value || typeof value !== 'string') return NaN;

    let cleaned = value.replace(/\s/g, ''); // remove spaces / non-breaking spaces

    // Reject strings that contain characters that can never appear in a number
    // (e.g. "01/02/2026" or "Reference 123")
    if (!/^[+\-]?[\d.,]+$/.test(cleaned)) return NaN;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    if (lastComma > lastDot) {
      // European: 1.250,50 → 1250.50
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // US/UK: 1,250.50 → 1250.50
      cleaned = cleaned.replace(/,/g, '');
    } else if (lastComma !== -1) {
      // No thousands separator: 1250,50 → 1250.50
      cleaned = cleaned.replace(',', '.');
    }

    const result = parseFloat(cleaned);
    return isNaN(result) ? NaN : result;
  }

  // ---------------------------------------------------------------------------
  // Task 1.2 – Row & Column Identification
  // ---------------------------------------------------------------------------

  /**
   * Returns true when a cell value looks like a date (language-agnostic).
   * Accepts formats such as DD/MM/YYYY, YYYY-MM-DD, D.M.YY, etc.
   */
  isDateLike(value: any): boolean {
    if (!value || typeof value !== 'string') return false;
    return DATE_PATTERN.test(value.trim());
  }

  /**
   * Returns true when a cell value is purely non-numeric text (no digits form
   * a parseable number and the cell is not date-like).
   * Used to identify header cells.
   */
  isTextOnly(value: any): boolean {
    if (!value || typeof value !== 'string') return false;
    if (this.isDateLike(value)) return false;
    return isNaN(this.parseLocalizedNumber(value));
  }

  /**
   * Determines whether a row is likely an actual bank movement.
   *
   * Language-agnostic criteria (ALL must pass):
   *   1. At least 3 non-empty cells.
   *   2. At least one cell is date-like.
   *   3. At least one cell parses as a number.
   */
  isLikelyMovement(row: any[]): boolean {
    if (!row || row.length === 0) return false;

    const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');

    if (nonEmpty.length < 3) return false;
    if (!nonEmpty.some((c) => this.isDateLike(c))) return false;
    if (!nonEmpty.some((c) => !isNaN(this.parseLocalizedNumber(c)))) return false;

    return true;
  }

  /**
   * Scans the first `scanLimit` rows to find the most likely header row using
   * two language-agnostic heuristics:
   *
   *   H1 – All-string row: the first row where every non-empty cell is a
   *        non-numeric string (no dates, no amounts).
   *
   *   H2 – Transition point: the last row, within the scan window, before
   *        a run of rows that consistently pass `isLikelyMovement`.
   *        "Consistent" = ≥ 3 consecutive movement rows immediately after.
   *
   * H2 takes precedence over H1 when both are found, because a pure-text row
   * of metadata could also satisfy H1.
   *
   * Returns 0 if no convincing header is found (first row is assumed).
   */
  detectHeaderRow(data: any[][], scanLimit = 30): number {
    const limit = Math.min(scanLimit, data.length);

    // H1 – last all-text row with ≥2 non-empty cells within the scan window.
    // Using the *last* match avoids treating metadata rows above the real header
    // as the header itself.
    let h1Index: number | null = null;
    for (let i = 0; i < limit; i++) {
      const row = data[i];
      const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
      if (nonEmpty.length >= 2 && nonEmpty.every((c) => this.isTextOnly(c))) {
        h1Index = i; // keep updating – we want the last match
      }
    }

    // H2 – last row before ≥3 consecutive movement rows
    let h2Index: number | null = null;
    for (let i = 0; i < limit - 3; i++) {
      const nextThreeAreMovements =
        this.isLikelyMovement(data[i + 1]) &&
        this.isLikelyMovement(data[i + 2]) &&
        this.isLikelyMovement(data[i + 3]);

      if (nextThreeAreMovements && !this.isLikelyMovement(data[i])) {
        h2Index = i;
        break;
      }
    }

    // H2 takes precedence; fall back to H1; default to 0
    if (h2Index !== null) return h2Index;
    if (h1Index !== null) return h1Index;
    return 0;
  }

  /**
   * Classifies all rows in a parsed sheet into metadata, movements, and
   * excluded rows.
   *
   * @param data          Raw 2D array from `parseExcel`.
   * @param headerIndex   Optional override. When omitted, `detectHeaderRow`
   *                      supplies the suggested index.
   * @returns             A `ParsedSheet` with all classification results.
   */
  classifyRows(data: any[][], headerIndex?: number): ParsedSheet {
    const suggestedHeaderIndex = headerIndex ?? this.detectHeaderRow(data);

    const metadata = data.slice(0, suggestedHeaderIndex);
    const headers = (data[suggestedHeaderIndex] ?? []).map((c: any) =>
      c !== null && c !== undefined ? String(c) : '',
    );

    const movements: any[][] = [];
    const excluded: ExcludedRow[] = [];

    for (let i = suggestedHeaderIndex + 1; i < data.length; i++) {
      const row = data[i];

      if (!row || row.length === 0) {
        excluded.push({ index: i, row: row ?? [], reason: 'empty row' });
        continue;
      }

      const nonEmpty = row.filter(
        (c: any) => c !== null && c !== undefined && String(c).trim() !== '',
      );

      if (nonEmpty.length === 0) {
        excluded.push({ index: i, row, reason: 'empty row' });
        continue;
      }

      if (nonEmpty.length < 3) {
        excluded.push({ index: i, row, reason: 'too few non-empty cells' });
        continue;
      }

      if (!nonEmpty.some((c: any) => this.isDateLike(c))) {
        excluded.push({ index: i, row, reason: 'no date-like value' });
        continue;
      }

      if (!nonEmpty.some((c: any) => !isNaN(this.parseLocalizedNumber(c)))) {
        excluded.push({ index: i, row, reason: 'no numeric value' });
        continue;
      }

      movements.push(row);
    }

    return {
      rawData: data,
      suggestedHeaderIndex,
      headers,
      metadata,
      movements,
      excluded,
    };
  }
}