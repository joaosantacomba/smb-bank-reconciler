import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { IRule } from '../models/rule.model';

class AppDatabase extends Dexie {
  rules!: Table<IRule, number>;

  constructor() {
    super('BankReconcilerDB');
    this.version(1).stores({
      // ++id = auto-increment PK; targetLabel and priority are indexed for queries
      rules: '++id, targetLabel, priority',
    });
  }
}

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private db = new AppDatabase();

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
}