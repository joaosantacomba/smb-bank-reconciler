import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { IRule } from '../models/rule.model';
import {
  DEFAULT_USER_PREFERENCES,
  IUserPreferences,
} from '../models/user-preferences.model';

/** Single-row preferences record stored in Dexie. The id is always 1. */
interface IPreferencesRecord extends IUserPreferences {
  id: 1;
}

class AppDatabase extends Dexie {
  rules!: Table<IRule, number>;
  preferences!: Table<IPreferencesRecord, number>;

  constructor() {
    super('BankReconcilerDB');
    this.version(1).stores({
      // ++id = auto-increment PK; targetLabel and priority are indexed for queries
      rules: '++id, targetLabel, priority',
    });
    this.version(2).stores({
      rules: '++id, targetLabel, priority',
      preferences: 'id',
    });
  }
}

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private db = new AppDatabase();

  // ── Rules ─────────────────────────────────────────────────────────────────

  /** Add a new rule. Returns the auto-assigned id. */
  addRule(rule: Omit<IRule, 'id'>): Promise<number> {
    return this.db.rules.add(rule as IRule);
  }

  /** Update an existing rule. Returns the id. */
  updateRule(rule: IRule): Promise<number> {
    if (rule.id === undefined) {
      return Promise.reject(new Error('Rule id is required for update'));
    }
    return this.db.rules.put(rule);
  }

  /** Delete a rule by id. */
  deleteRule(id: number): Promise<void> {
    return this.db.rules.delete(id);
  }

  /** Return all rules ordered by priority descending (highest first). */
  getAllRules(): Promise<IRule[]> {
    return this.db.rules.orderBy('priority').reverse().toArray();
  }

  /**
   * Find the highest-priority rule whose every condition matches
   * the provided row object (field -> value map).
   * Comparison is case-insensitive and trimmed.
   */
  async findMatchingRule(
    row: Record<string, string>,
  ): Promise<IRule | undefined> {
    const rules = await this.getAllRules(); // already sorted by priority desc
    return rules.find((rule) =>
      rule.conditions.every((condition) => {
        const rowValue = (row[condition.field] ?? '').trim().toLowerCase();
        const ruleValue = condition.value.trim().toLowerCase();
        return rowValue === ruleValue;
      }),
    );
  }

  // ── User Preferences ──────────────────────────────────────────────────────

  /** Load the stored preferences, or return the defaults if none exist yet. */
  async getPreferences(): Promise<IUserPreferences> {
    const record = await this.db.preferences.get(1);
    if (!record) return { ...DEFAULT_USER_PREFERENCES };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, ...prefs } = record;
    return prefs;
  }

  /** Persist the full preferences object (upsert). */
  async savePreferences(prefs: IUserPreferences): Promise<void> {
    await this.db.preferences.put({ id: 1, ...prefs });
  }

  /**
   * Update a single preference key without overwriting others.
   * Reads current state first to merge cleanly.
   */
  async patchPreferences(patch: Partial<IUserPreferences>): Promise<void> {
    const current = await this.getPreferences();
    await this.savePreferences({ ...current, ...patch });
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  /**
   * Export user preferences as a plain JSON-serialisable object.
   * Intended to be bundled into a larger export payload alongside rules.
   */
  async exportPreferences(): Promise<IUserPreferences> {
    return this.getPreferences();
  }

  /**
   * Import (replace) user preferences from a JSON-parsed object.
   * Only known keys are applied; unknown keys are ignored.
   */
  async importPreferences(data: unknown): Promise<void> {
    if (typeof data !== 'object' || data === null) return;
    const patch: Partial<IUserPreferences> = {};
    const d = data as Record<string, unknown>;
    if (typeof d['showNegativeAmounts'] === 'boolean') {
      patch.showNegativeAmounts = d['showNegativeAmounts'];
    }
    await this.patchPreferences(patch);
  }
}