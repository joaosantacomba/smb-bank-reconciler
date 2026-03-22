import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DecimalPipe, NgClass } from '@angular/common';
import { ExcelParserService } from './services/excel-parser.service';
import { ParsedSheet } from './models/parsed-sheet.model';
import { PersistenceService } from './services/persistence.service';
import { MovementTokenizerService } from './services/movement-tokenizer.service';
import { MatchLevel } from './models/match-evidence.model';

export type ColumnRole = 'date' | 'description' | 'amount';
export type TabId = 'upload' | 'mapping' | 'memory' | 'history';

export interface Tab {
  id: TabId;
  label: string;
}

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
  /** The match level when source === 'auto': 'exact', 'structural', or 'similarity'. */
  matchLevel?: MatchLevel;
  /** Confidence score [0,1]. Only meaningful for similarity matches. */
  matchScore?: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit {
  // ── Tab Navigation ────────────────────────────────────────────────────────

  readonly tabs: Tab[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'mapping', label: 'Mapping' },
    { id: 'memory', label: 'Memory' },
    { id: 'history', label: 'History' },
  ];

  activeTab: TabId = 'upload';
  configApproved = false;

  isTabEnabled(tab: TabId): boolean {
    if (tab === 'upload') return true;
    return this.configApproved;
  }

  selectTab(tab: TabId): void {
    if (this.isTabEnabled(tab)) {
      this.activeTab = tab;
    }
  }

  approveConfiguration(): void {
    this.configApproved = true;
    this.activeTab = 'mapping';
  }

  resetConfiguration(): void {
    this.configApproved = false;
    this.activeTab = 'upload';
    this.fileName = '';
    this.rawData = null;
    this.parsedSheet = null;
    this.rowOverrides = new Map();
    this.columnMapping = {};
    this.matchLabels = new Map<
      number,
      { label: string; source: 'auto' | 'manual' | ''; matchLevel?: MatchLevel; matchScore?: number }
    >();
    this.dragging = false;
  }

  // ── File Handling ─────────────────────────────────────────────────────────

  dragging = false;
  fileName = '';

  private rawData: any[][] | null = null;
  parsedSheet: ParsedSheet | null = null;
  selectedHeaderIndex = 0;

  /** rawData row index → true (force include) | false (force exclude) */
  rowOverrides = new Map<number, boolean>();

  /** column index → assigned role */
  columnMapping: Record<number, ColumnRole | ''> = {};

  /** rawIndex → { label, source, matchLevel, matchScore } for the matching view */
  matchLabels = new Map<
    number,
    { label: string; source: 'auto' | 'manual' | ''; matchLevel?: MatchLevel; matchScore?: number }
  >();

  // ── User Preferences ──────────────────────────────────────────────────────

  /** When false (default), negative-amount rows are hidden in the Mapping tab. */
  showNegativeAmounts = false;

  constructor(
    private excelParser: ExcelParserService,
    private persistence: PersistenceService,
    private tokenizer: MovementTokenizerService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    const prefs = await this.persistence.getPreferences();
    this.showNegativeAmounts = prefs.showNegativeAmounts;
  }

  async toggleShowNegativeAmounts(): Promise<void> {
    this.showNegativeAmounts = !this.showNegativeAmounts;
    await this.persistence.patchPreferences({ showNegativeAmounts: this.showNegativeAmounts });
  }

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
    // Reset approval when a new file is loaded
    this.configApproved = false;
    this.rowOverrides = new Map();
    this.columnMapping = {};
    this.matchLabels = new Map();
    try {
      this.rawData = await this.excelParser.parseExcel(file);
      this.reclassify();
      this.cdr.detectChanges();
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

  /**
   * Build a map of sourceField → searchKey for all description columns in
   * the given row. Used for structural (pattern-based) matching.
   */
  private buildSearchKeyRecord(rawDescriptions: Record<string, string>): Record<string, string> {
    const keys: Record<string, string> = {};
    for (const [field, value] of Object.entries(rawDescriptions)) {
      keys[field] = this.tokenizer.generateSearchKey(value);
    }
    return keys;
  }

  private async autoMatchRows(): Promise<void> {
    const movements = this.tableRows.filter((r) => r.type === 'movement');
    const newLabels = new Map<
      number,
      { label: string; source: 'auto' | 'manual' | ''; matchLevel?: MatchLevel; matchScore?: number }
    >();
    for (const r of movements) {
      const descRecord = this.buildDescriptionRecord(r.row);
      const searchKeys = this.buildSearchKeyRecord(descRecord);
      const match = await this.persistence.findMatchingEntity(descRecord, searchKeys);
      newLabels.set(r.rawIndex, {
        label: match?.entity.name ?? '',
        source: match ? 'auto' : '',
        matchLevel: match?.level,
        matchScore: match?.score,
      });
    }
    this.matchLabels = newLabels;
  }

  async onLabelCommit(rawIndex: number, value: string): Promise<void> {
    const trimmed = value.trim();
    const current = this.matchLabels.get(rawIndex);
    if (!trimmed || current?.label === trimmed) return;

    this.matchLabels.set(rawIndex, { label: trimmed, source: 'manual' });

    const rowDisplay = this.tableRows.find((r) => r.rawIndex === rawIndex);
    if (!rowDisplay || !this.parsedSheet) return;

    // Find or create the canonical entity for the typed label
    const entity = await this.persistence.findOrCreateEntity(trimmed);
    const now = Date.now();

    // Persist a dialect for every mapped description column
    for (const [colIdxStr, role] of Object.entries(this.columnMapping)) {
      if (role !== 'description') continue;
      const colIdx = Number(colIdxStr);
      const headerName = this.parsedSheet.headers[colIdx];
      const cellValue = String(rowDisplay.row[colIdx] ?? '').trim();
      if (!cellValue) continue;

      // ── Exact dialect ───────────────────────────────────────────────────
      await this.persistence.addDialect({
        entityId: entity.id!,
        pattern: cellValue,
        scope: 'exact',
        sourceField: headerName,
        priority: 1,
        createdAt: now,
      });

      // ── Structural dialect ──────────────────────────────────────────────
      const searchKey = this.tokenizer.generateSearchKey(cellValue);
      if (searchKey && searchKey !== cellValue.toLowerCase()) {
        await this.persistence.addDialect({
          entityId: entity.id!,
          pattern: searchKey,
          scope: 'structural',
          sourceField: headerName,
          priority: 1,
          createdAt: now,
        });
      }
    }
  }

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

    const rows = this.tableRows
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
          matchLevel: entry.matchLevel,
          matchScore: entry.matchScore,
        };
      });

    if (this.showNegativeAmounts) return rows;

    return rows.filter((row) => {
      const numeric = parseFloat(String(row.amount).replace(/[^\d.,-]/g, '').replace(',', '.'));
      return isNaN(numeric) || numeric >= 0;
    });
  }
}