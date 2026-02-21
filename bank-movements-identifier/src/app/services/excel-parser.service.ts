import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

@Injectable({
  providedIn: 'root'
})
export class ExcelParserService {

  constructor() { }

  /**
   * Parses the Excel file and returns a raw 2D array.
   * Now uses the modern ArrayBuffer approach.
   */
  async parseExcel(file: File): Promise<any[][]> {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      // header: 1 ensures we get a 2D array [row][column]
      // raw: false forces everything to string first, so we can handle localization
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];
      
      return data;
    } catch (error) {
      console.error('Error parsing Excel:', error);
      throw error;
    }
  }

  /**
   * Logic for Task 1.1: Handles Portuguese and English number formats.
   * Heuristic: Comma as decimal if it appears after the last dot.
   */
  parseLocalizedNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (!value || typeof value !== 'string') return NaN;

    let cleaned = value.replace(/\s/g, ''); // Remove spaces/non-breaking spaces

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    if (lastComma > lastDot) {
      // Format 1.250,50 -> 1250.50
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // Format 1,250.50 -> 1250.50
      cleaned = cleaned.replace(/,/g, '');
    } else if (lastComma !== -1) {
      // Format 1250,50 -> 1250.50
      cleaned = cleaned.replace(',', '.');
    }

    const result = parseFloat(cleaned);
    return isNaN(result) ? NaN : result;
  }

  /**
   * Logic for Task 1.2: Identify if a row is likely a bank movement.
   * Returns false for empty rows or rows that look like headers/totals.
   */
  isLikelyMovement(row: any[]): boolean {
    if (!row || row.length < 2) return false;
    
    const rowString = JSON.stringify(row).toLowerCase();
    const blacklist = ['saldo', 'total', 'extrato', 'iban', 'balanço'];
    
    // Check if row contains any blacklisted word
    if (blacklist.some(word => rowString.includes(word))) return false;

    // Check if there's at least one numeric-looking value in the row
    return row.some(cell => !isNaN(this.parseLocalizedNumber(cell)));
  }
}