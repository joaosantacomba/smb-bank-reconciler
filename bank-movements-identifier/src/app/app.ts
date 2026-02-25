import { ChangeDetectorRef, Component } from '@angular/core';
import { NgClass } from '@angular/common';
import { ExcelParserService } from './services/excel-parser.service';
import { ParsedSheet } from './models/parsed-sheet.model';
import { PersistenceService } from './services/persistence.service';

export type ColumnRole = 'date' | 'description' | 'amount';

export interface RowDisplay {
  rawIndex: number;
  row: any[];
  type: 'metadata' | 'header' | 'movement' | 'excluded';
  exclusionReason?: string;
  isManualOverride: boolean;
}

export interface MatchRow {
  rawIndex: number;
  date: string;
  descriptions: string[];
  amount: string;
  label: string;
  source: 'auto' | 'manual' | '';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent {
  dragging = false;
  fileName = '';

  private rawData: any[][] | null = null;
  parsedSheet: ParsedSheet | null = null;
  selectedHeaderIndex = 0;

  /** rawData row index → true (force include) | false (force exclude) */
  rowOverrides = new Map<number, boolean>();

  /** column index → assigned role */
  columnMapping: Record<number, ColumnRole | ''> = {};

  /** rawIndex → { label, source } for the matching view */
  matchLabels = new Map<number, { label: string; source: 'auto' | 'manual' | '' }>();

  constructor(
    private excelParser: ExcelParserService,
    private persistence: PersistenceService,
    private cdr: ChangeDetectorRef,
  ) {}

  // ── File Handling ─────────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.handleFile(input.files[0]);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragging = false;
    if (event.dataTransfer?.files?.length) this.handleFile(event.dataTransfer.files[0]);
  }

  async handleFile(file: File): Promise<void> {
    this.fileName = file.name;
    try {
      this.rawData = await this.excelParser.parseExcel(file);
      this.reclassify();
    } catch {
      alert('Error reading the Excel file. Please check the format.');
      this.fileName = '';
    }
  }

  // ── Classification ────────────────────────────────────────────────────────

  private reclassify(headerIndex?: number): void {
    if (!this.rawData) return;
    this.parsedSheet = this.excelParser.classifyRows(this.rawData, headerIndex);
    this.selectedHeaderIndex = this.parsedSheet.suggestedHeaderIndex;
    this.rowOverrides = new Map();
    this.columnMapping = {};
    this.matchLabels = new Map();
  }

  setHeaderRow(rawIndex: number): void {
    this.reclassify(rawIndex);
  }

  toggleRowOverride(rawIndex: number, currentType: 'movement' | 'excluded'): void {
    this.rowOverrides.set(rawIndex, currentType === 'excluded');
  }

  // ── Display Helpers ───────────────────────────────────────────────────────

  get tableRows(): RowDisplay[] {
    if (!this.rawData || !this.parsedSheet) return [];

    return this.rawData.map((row, index) => {
      if (index < this.selectedHeaderIndex) {
        return { rawIndex: index, row, type: 'metadata' as const, isManualOverride: false };
      }
      if (index === this.selectedHeaderIndex) {
        return { rawIndex: index, row, type: 'header' as const, isManualOverride: false };
      }

      const override = this.rowOverrides.get(index);
      if (override === true) {
        return { rawIndex: index, row, type: 'movement' as const, isManualOverride: true };
      }
      if (override === false) {
        return {
          rawIndex: index,
          row,
          type: 'excluded' as const,
          exclusionReason: 'Manually excluded',
          isManualOverride: true,
        };
      }

      const excludedEntry = this.parsedSheet!.excluded.find((e) => e.index === index);
      if (excludedEntry) {
        return {
          rawIndex: index,
          row,
          type: 'excluded' as const,
          exclusionReason: excludedEntry.reason,
          isManualOverride: false,
        };
      }
      return { rawIndex: index, row, type: 'movement' as const, isManualOverride: false };
    });
  }

  get maxColumns(): number {
    if (!this.rawData?.length) return 0;
    return Math.max(...this.rawData.map((r) => r.length));
  }

  get columnIndices(): number[] {
    return Array.from({ length: this.maxColumns }, (_, i) => i);
  }

  get movementCount(): number {
    return this.tableRows.filter((r) => r.type === 'movement').length;
  }

  get excludedCount(): number {
    return this.tableRows.filter((r) => r.type === 'excluded').length;
  }

  get metadataCount(): number {
    return this.tableRows.filter((r) => r.type === 'metadata').length;
  }

  getRowClass(type: RowDisplay['type']): Record<string, boolean> {
    return {
      'bg-gray-50 text-gray-400': type === 'metadata',
      'bg-blue-50 text-gray-800': type === 'header',
      'bg-white text-gray-700 hover:bg-gray-50': type === 'movement',
      'bg-red-50 text-red-400': type === 'excluded',
    };
  }

  // ── Column Mapping ────────────────────────────────────────────────────────

  readonly allRoles: ColumnRole[] = ['date', 'description', 'amount'];

  getColumnRole(colIndex: number): ColumnRole | '' {
    return this.columnMapping[colIndex] ?? '';
  }

  /** Maximum number of columns that can share the 'description' role. */
  readonly maxDescriptionColumns = 3;

  isRoleDisabled(role: ColumnRole, forColIndex: number): boolean {
    if (role === 'description') {
      const assignedCols = Object.entries(this.columnMapping)
        .filter(([col, r]) => r === 'description' && Number(col) !== forColIndex)
        .length;
      const alreadyAssignedHere = this.columnMapping[forColIndex] === 'description';
      return assignedCols >= this.maxDescriptionColumns && !alreadyAssignedHere;
    }
    return Object.entries(this.columnMapping).some(
      ([col, r]) => r === role && Number(col) !== forColIndex,
    );
  }

  async onRoleChange(colIndex: number, event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as ColumnRole | '';
    if (value === '') {
      delete this.columnMapping[colIndex];
    } else {
      this.columnMapping[colIndex] = value;
    }
    if (this.allRolesMapped) {
      await this.autoMatchRows();
      this.cdr.detectChanges();
    }
  }

  get allRolesMapped(): boolean {
    const assigned = Object.values(this.columnMapping);
    return (
      assigned.includes('date') &&
      assigned.includes('description') &&
      assigned.includes('amount')
    );
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  /** Builds a Record of { headerName → cellValue } for all description columns. */
  private buildDescriptionRecord(row: any[]): Record<string, string> {
    if (!this.parsedSheet) return {};
    const record: Record<string, string> = {};
    for (const [colIdxStr, role] of Object.entries(this.columnMapping)) {
      if (role === 'description') {
        const colIdx = Number(colIdxStr);
        const headerName = this.parsedSheet.headers[colIdx];
        record[headerName] = String(row[colIdx] ?? '');
      }
    }
    return record;
  }

  /** Queries DB for every movement row and pre-fills matchLabels. */
  private async autoMatchRows(): Promise<void> {
    const movements = this.tableRows.filter((r) => r.type === 'movement');
    const newLabels = new Map<number, { label: string; source: 'auto' | 'manual' | '' }>();
    for (const r of movements) {
      const descRecord = this.buildDescriptionRecord(r.row);
      const match = await this.persistence.findMatchingRule(descRecord);
      newLabels.set(r.rawIndex, {
        label: match?.targetLabel ?? '',
        source: match ? 'auto' : '',
      });
    }
    this.matchLabels = newLabels;
  }

  /**
   * Called when the user finishes editing an entity label.
   * Persists a new rule keyed on the first description column value.
   */
  async onLabelCommit(rawIndex: number, value: string): Promise<void> {
    const trimmed = value.trim();
    const current = this.matchLabels.get(rawIndex);
    // Skip if value is empty or unchanged
    if (!trimmed || current?.label === trimmed) return;

    this.matchLabels.set(rawIndex, { label: trimmed, source: 'manual' });

    // Find source row data
    const rowDisplay = this.tableRows.find((r) => r.rawIndex === rawIndex);
    if (!rowDisplay || !this.parsedSheet) return;

    // Use the first description column to build the rule condition
    const firstDescEntry = Object.entries(this.columnMapping).find(([, r]) => r === 'description');
    if (!firstDescEntry) return;
    const descColIdx = Number(firstDescEntry[0]);
    const headerName = this.parsedSheet.headers[descColIdx];
    const cellValue = String(rowDisplay.row[descColIdx] ?? '').trim();
    if (!cellValue) return;

    await this.persistence.addRule({
      conditions: [{ field: headerName, value: cellValue }],
      targetLabel: trimmed,
      priority: 0,
    });
  }

  /** Movement rows projected for the matching view table. */
  get matchingRows(): MatchRow[] {
    if (!this.allRolesMapped || !this.parsedSheet) return [];

    const dateColIdx = Number(
      Object.entries(this.columnMapping).find(([, r]) => r === 'date')?.[0] ?? -1,
    );
    const amountColIdx = Number(
      Object.entries(this.columnMapping).find(([, r]) => r === 'amount')?.[0] ?? -1,
    );
    const descColIndices = Object.entries(this.columnMapping)
      .filter(([, r]) => r === 'description')
      .map(([k]) => Number(k));

    return this.tableRows
      .filter((r) => r.type === 'movement')
      .map((r) => {
        const entry = this.matchLabels.get(r.rawIndex) ?? { label: '', source: '' as const };
        return {
          rawIndex: r.rawIndex,
          date: String(r.row[dateColIdx] ?? ''),
          descriptions: descColIndices.map((i) => String(r.row[i] ?? '')),
          amount: String(r.row[amountColIdx] ?? ''),
          label: entry.label,
          source: entry.source,
        };
      });
  }
}