import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe, NgClass } from '@angular/common';
import { ExcelParserService } from './services/excel-parser.service';
import { ParsedSheet } from './models/parsed-sheet.model';
import { PersistenceService } from './services/persistence.service';
import { MovementTokenizerService } from './services/movement-tokenizer.service';
import { MatchEvidence, MatchLevel } from './models/match-evidence.model';
import { IMovement } from './models/movement.model';
import { ICanonicalEntity } from './models/canonical-entity.model';
import { IDialect } from './models/dialect.model';

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
  source: 'auto' | 'manual' | 'ambiguous' | '';
  /** The match level when source === 'auto': 'exact', 'structural', or 'similarity'. */
  matchLevel?: MatchLevel;
  /** Confidence score [0,1]. Only meaningful for similarity matches. */
  matchScore?: number;
  /** All candidate entities when source === 'ambiguous'. */
  candidates?: MatchEvidence[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass, DecimalPipe, DatePipe],
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
      if (tab === 'memory') {
        this.loadMemory().then(() => this.cdr.detectChanges());
      }
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
    this.matchLabels = new Map();
    this.openCandidatesFor = null;
    this.dragging = false;
    this.lastSaveSummary = null;
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

  /** rawIndex → match state for the matching view */
  matchLabels = new Map<
    number,
    {
      label: string;
      source: 'auto' | 'manual' | 'ambiguous' | '';
      matchLevel?: MatchLevel;
      matchScore?: number;
      candidates?: MatchEvidence[];
    }
  >();

  /** rawIndex of the row whose candidate dropdown is currently open. */
  openCandidatesFor: number | null = null;

  // ── Memory Tab (Task 4.4) ─────────────────────────────────────────────────

  memoryEntities: Array<ICanonicalEntity & { dialects: IDialect[] }> = [];
  memorySearchQuery = '';
  editingEntityId: number | null = null;
  editingEntityName = '';
  importSummary: { entities: number; dialects: number; movements: number } | null = null;
  importing = false;

  onMemorySearch(event: Event): void {
    this.memorySearchQuery = (event.target as HTMLInputElement).value;
  }

  get filteredMemoryEntities(): Array<ICanonicalEntity & { dialects: IDialect[] }> {
    const q = this.memorySearchQuery.trim().toLowerCase();
    if (!q) return this.memoryEntities;
    return this.memoryEntities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.dialects.some((d) => d.pattern.toLowerCase().includes(q)),
    );
  }

  get totalDialectCount(): number {
    return this.memoryEntities.reduce((sum, e) => sum + e.dialects.length, 0);
  }

  private async loadMemory(): Promise<void> {
    const entities = await this.persistence.getAllEntities();
    this.memoryEntities = await Promise.all(
      entities.map(async (e) => ({
        ...e,
        dialects: await this.persistence.getDialectsForEntity(e.id!),
      })),
    );
  }

  startEditEntity(entity: ICanonicalEntity): void {
    this.editingEntityId = entity.id!;
    this.editingEntityName = entity.name;
  }

  cancelEditEntity(): void {
    this.editingEntityId = null;
    this.editingEntityName = '';
  }

  async commitRenameEntity(id: number, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      this.cancelEditEntity();
      return;
    }
    await this.persistence.renameEntity(id, trimmed);
    this.cancelEditEntity();
    await this.loadMemory();
    this.cdr.detectChanges();
  }

  async onDeleteEntity(id: number): Promise<void> {
    if (!confirm('Delete this entity and all its patterns? This cannot be undone.')) return;
    await this.persistence.deleteEntity(id);
    await this.loadMemory();
    this.cdr.detectChanges();
  }

  async onDeleteDialect(dialectId: number): Promise<void> {
    if (!confirm('Delete this pattern? This cannot be undone.')) return;
    await this.persistence.deleteDialect(dialectId);
    await this.loadMemory();
    this.cdr.detectChanges();
  }

  async clearMemory(): Promise<void> {
    if (!confirm('Delete ALL rules and patterns permanently? This cannot be undone.')) return;
    await this.persistence.clearEntitiesAndDialects();
    await this.loadMemory();
    this.cdr.detectChanges();
  }

  // ── History ───────────────────────────────────────────────────────────────

  /** All movements stored in the vault, used to populate the History tab. */
  historyMovements: IMovement[] = [];

  /** True while a Save to History operation is in progress. */
  savingToHistory = false;

  /** Summary shown after the last Save to History: { saved, skipped } counts. */
  lastSaveSummary: { saved: number; skipped: number } | null = null;

  // ── History tab filters (Task 4.3) ────────────────────────────────────────

  /** Current value of the global search bar on the History tab. */
  historySearchQuery = '';

  /** Selected month filter key in `YYYY-MM` format, or `''` for "All". */
  historySelectedMonth = '';

  /** Update the search query (bound to the history search input). */
  onHistorySearch(event: Event): void {
    this.historySearchQuery = (event.target as HTMLInputElement).value;
  }

  /** Select a month filter pill. */
  selectHistoryMonth(month: string): void {
    this.historySelectedMonth = month;
  }

  /**
   * Try to extract a `YYYY-MM` key from a date string in common bank formats:
   * - ISO: `YYYY-MM-DD`
   * - European / ambiguous: `D/M/YY`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`
   *   (also handles 2-digit years from legacy Excel formatting)
   *
   * Disambiguation strategy for `A/B/Y` format:
   *   - If A > 12 → must be DD/MM (A is day)
   *   - If B > 12 → must be MM/DD, but since we target Portuguese bank files
   *     and B being a day > 12 is valid, we default to DD/MM
   *   - When both A and B ≤ 12 → prefer DD/MM (European default)
   *
   * Returns `null` when the date cannot be parsed.
   */
  private extractMonthKey(date: string): string | null {
    const trimmed = date.trim();

    // ISO: YYYY-MM-DD[…]
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-\d{2}/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10);
      if (m >= 1 && m <= 12 && y >= 1900 && y <= 2100) {
        return `${isoMatch[1]}-${isoMatch[2]}`;
      }
    }

    // D/M/YY, DD/MM/YYYY and variants (2- or 4-digit year, any separator)
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (dmyMatch) {
      const a = parseInt(dmyMatch[1], 10);
      const b = parseInt(dmyMatch[2], 10);
      let y = parseInt(dmyMatch[3], 10);
      // Expand 2-digit year: treat as 2000s (valid for modern bank data)
      if (y < 100) y += 2000;

      if (y < 1900 || y > 2100) return null;

      // Determine which component is the month:
      //   - If a > 12 → a is definitely the day, b is the month (DD/MM)
      //   - Otherwise  → prefer European DD/MM (b as month) by default
      const month = b; // European: second component is month
      const day = a;

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return `${y}-${String(month).padStart(2, '0')}`;
      }

      // Last resort: try swapping (MM/DD — US format from Excel M/D/YY code)
      if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
        return `${y}-${String(a).padStart(2, '0')}`;
      }
    }

    return null;
  }

  /**
   * Distinct `YYYY-MM` keys present in `historyMovements` (derived from
   * the movement's own date, not `reconciledAt`), sorted newest-first.
   * Only well-formed dates are included.
   */
  get availableMonths(): string[] {
    const keys = new Set<string>();
    for (const m of this.historyMovements) {
      const key = this.extractMonthKey(m.date);
      if (key) keys.add(key);
    }
    return [...keys].sort((a, b) => b.localeCompare(a));
  }

  /**
   * Format a `YYYY-MM` key for display, e.g. `"2024-03"` → `"Mar 2024"`.
   */
  formatMonthLabel(key: string): string {
    const [year, month] = key.split('-');
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString('default', { month: 'short', year: 'numeric' });
  }

  /**
   * `historyMovements` after applying the month filter and search query.
   * The month filter matches by the extracted `YYYY-MM` key, so it works
   * regardless of whether the stored date is ISO or European format.
   */
  get filteredHistoryMovements(): IMovement[] {
    let list = this.historyMovements;

    if (this.historySelectedMonth) {
      list = list.filter(
        (m) => this.extractMonthKey(m.date) === this.historySelectedMonth,
      );
    }

    const q = this.historySearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.description.toLowerCase().includes(q) ||
          m.entity.toLowerCase().includes(q) ||
          String(m.amount).includes(q),
      );
    }

    return list;
  }

  /**
   * Sum of amounts in the currently filtered history view.
   */
  get filteredHistoryTotal(): number {
    return this.filteredHistoryMovements.reduce((sum, m) => sum + m.amount, 0);
  }

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
    await this.loadHistory();
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
      {
        label: string;
        source: 'auto' | 'manual' | 'ambiguous' | '';
        matchLevel?: MatchLevel;
        matchScore?: number;
        candidates?: MatchEvidence[];
      }
    >();
    for (const r of movements) {
      const descRecord = this.buildDescriptionRecord(r.row);
      const searchKeys = this.buildSearchKeyRecord(descRecord);
      const matches = await this.persistence.findAllMatchingEntities(descRecord, searchKeys);

      if (matches.length === 0) {
        newLabels.set(r.rawIndex, { label: '', source: '' });
      } else if (matches.length === 1) {
        newLabels.set(r.rawIndex, {
          label: matches[0].entity.name,
          source: 'auto',
          matchLevel: matches[0].level,
          matchScore: matches[0].score,
        });
      } else {
        // More than one distinct entity matches → ambiguous
        newLabels.set(r.rawIndex, {
          label: '',
          source: 'ambiguous',
          candidates: matches,
        });
      }
    }
    this.matchLabels = newLabels;
    this.openCandidatesFor = null;
  }

  async onLabelCommit(rawIndex: number, value: string): Promise<void> {
    const trimmed = value.trim();
    const current = this.matchLabels.get(rawIndex);
    if (!trimmed || current?.label === trimmed) return;

    this.matchLabels.set(rawIndex, { label: trimmed, source: 'manual' });

    const rowDisplay = this.tableRows.find((r) => r.rawIndex === rawIndex);
    if (!rowDisplay || !this.parsedSheet) return;

    // Find or create the canonical entity for the typed label (additive —
    // we never remove existing dialects for other entities on this pattern).
    const entity = await this.persistence.findOrCreateEntity(trimmed);
    const now = Date.now();

    // Persist a dialect for every mapped description column, skipping exact
    // duplicates (same pattern + scope + sourceField + entityId quad).
    for (const [colIdxStr, role] of Object.entries(this.columnMapping)) {
      if (role !== 'description') continue;
      const colIdx = Number(colIdxStr);
      const headerName = this.parsedSheet.headers[colIdx];
      const cellValue = String(rowDisplay.row[colIdx] ?? '').trim();
      if (!cellValue) continue;

      // ── Exact dialect ───────────────────────────────────────────────────
      const exactExists = await this.persistence.dialectExists(
        entity.id!, cellValue, 'exact', headerName,
      );
      if (!exactExists) {
        await this.persistence.addDialect({
          entityId: entity.id!,
          pattern: cellValue,
          scope: 'exact',
          sourceField: headerName,
          priority: 1,
          createdAt: now,
        });
      }

      // ── Structural dialect ──────────────────────────────────────────────
      const searchKey = this.tokenizer.generateSearchKey(cellValue);
      if (searchKey && searchKey !== cellValue.toLowerCase()) {
        const structExists = await this.persistence.dialectExists(
          entity.id!, searchKey, 'structural', headerName,
        );
        if (!structExists) {
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
  }

  /** Clear the entity match for a row, resetting it to unknown state. */
  onClearMatch(rawIndex: number): void {
    this.matchLabels.set(rawIndex, { label: '', source: '' });
    if (this.openCandidatesFor === rawIndex) {
      this.openCandidatesFor = null;
    }
  }

  /** Toggle the candidate dropdown for an ambiguous row. */
  toggleCandidates(rawIndex: number): void {
    this.openCandidatesFor = this.openCandidatesFor === rawIndex ? null : rawIndex;
  }

  /** Select a candidate entity for an ambiguous row. */
  selectCandidate(rawIndex: number, evidence: MatchEvidence): void {
    this.matchLabels.set(rawIndex, {
      label: evidence.entity.name,
      source: 'manual',
      matchLevel: evidence.level,
      matchScore: evidence.score,
    });
    this.openCandidatesFor = null;
  }

  // ── History ───────────────────────────────────────────────────────────────

  async clearHistory(): Promise<void> {
    if (!confirm('Delete ALL saved movements permanently? This cannot be undone.')) return;
    await this.persistence.clearMovements();
    this.historySelectedMonth = '';
    await this.loadHistory();
    this.cdr.detectChanges();
  }

  async onImportFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.importing = true;
    this.importSummary = null;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await this.persistence.importAll(data);
      this.importSummary = result;
      await this.loadMemory();
      await this.loadHistory();
      this.cdr.detectChanges();
    } catch (e) {
      alert('Import failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.importing = false;
      (event.target as HTMLInputElement).value = '';
    }
  }

  /** Reload the vault contents into `historyMovements`. */
  private async loadHistory(): Promise<void> {
    this.historyMovements = await this.persistence.getAllMovements();
    // Auto-select the most recent month on first load (or if the previously
    // selected month no longer exists in the new data set).
    const months = this.availableMonths;
    if (months.length && (!this.historySelectedMonth || !months.includes(this.historySelectedMonth))) {
      this.historySelectedMonth = months[0]; // newest first
    }
  }

  /**
   * The number of labeled rows in the current mapping session
   * (both auto and manual).
   */
  get labeledRowCount(): number {
    return this.matchingRows.filter((r) => r.label.trim()).length;
  }

  /**
   * Save all labeled rows in the current session to the permanent vault.
   * Only rows with a non-empty entity label are persisted.
   * Can be triggered at any time — iterative, not a one-shot "finalize".
   */
  async saveToHistory(): Promise<void> {
    if (this.savingToHistory) return;
    const labeled = this.matchingRows.filter((r) => r.label.trim());
    if (!labeled.length) return;

    this.savingToHistory = true;
    this.lastSaveSummary = null;

    try {
      const now = Date.now();
      const movements: Omit<IMovement, 'id'>[] = labeled.map((r) => {
        const rawAmount = String(r.amount).replace(/[^\d.,-]/g, '').replace(',', '.');
        const amount = parseFloat(rawAmount);
        return {
          date: r.date,
          description: r.descriptions.filter(Boolean).join(' | '),
          amount: isNaN(amount) ? 0 : amount,
          entity: r.label.trim(),
          reconciledAt: now,
        };
      });

      const result = await this.persistence.addMovements(movements);
      await this.loadHistory();
      this.lastSaveSummary = { saved: result.saved, skipped: result.skipped };
    } finally {
      this.savingToHistory = false;
      this.cdr.detectChanges();
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
          candidates: entry.candidates,
        };
      });

    if (this.showNegativeAmounts) return rows;

    return rows.filter((row) => {
      const numeric = parseFloat(String(row.amount).replace(/[^\d.,-]/g, '').replace(',', '.'));
      return isNaN(numeric) || numeric >= 0;
    });
  }
}