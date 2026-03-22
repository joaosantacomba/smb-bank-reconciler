import { Injectable } from '@angular/core';
import Dexie, { DexieOptions, Table } from 'dexie';
import { IRule } from '../models/rule.model';
import {
  DEFAULT_USER_PREFERENCES,
  IUserPreferences,
} from '../models/user-preferences.model';
import { ICanonicalEntity } from '../models/canonical-entity.model';
import { IDialect, DialectScope } from '../models/dialect.model';
import { MatchEvidence } from '../models/match-evidence.model';
import {
  levenshteinSimilarity,
  normalizeForSimilarity,
} from '../utils/levenshtein';

/** Single-row preferences record stored in Dexie. The id is always 1. */
interface IPreferencesRecord extends IUserPreferences {
  id: 1;
}

/**
 * @deprecated Use `MatchEvidence` instead.
 *
 * Kept for backward compatibility with any callers that still reference the
 * old `EntityMatch` type. All new code should import `MatchEvidence` from
 * `match-evidence.model.ts`.
 */
export interface EntityMatch {
  entity: ICanonicalEntity;
  dialect: IDialect;
  scope: DialectScope;
}

class AppDatabase extends Dexie {
  rules!: Table<IRule, number>;
  preferences!: Table<IPreferencesRecord, number>;
  entities!: Table<ICanonicalEntity, number>;
  dialects!: Table<IDialect, number>;

  constructor(options?: DexieOptions) {
    super('BankReconcilerDB', options);

    // ── v1: original rules table ─────────────────────────────────────────────
    this.version(1).stores({
      rules: '++id, targetLabel, priority',
    });

    // ── v2: add preferences ──────────────────────────────────────────────────
    this.version(2).stores({
      rules: '++id, targetLabel, priority',
      preferences: 'id',
    });

    // ── v3: entity/dialect hierarchy — migrate legacy rules ──────────────────
    this.version(3)
      .stores({
        rules: '++id, targetLabel, priority',
        preferences: 'id',
        // &name = unique index on the canonical name
        entities: '++id, &name',
        // entityId allows efficient lookup of all dialects for one entity
        dialects: '++id, entityId, pattern, scope, priority',
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const legacyRules = await tx.table<IRule>('rules').toArray();
        if (!legacyRules.length) return;

        // Map from lowercased canonical name → newly assigned entity id
        const entityIdCache = new Map<string, number>();

        for (const rule of legacyRules) {
          // ── 1. Find or create the canonical entity ─────────────────────────
          const nameKey = rule.targetLabel.trim().toLowerCase();
          let entityId = entityIdCache.get(nameKey);

          if (entityId === undefined) {
            entityId = (await tx.table<ICanonicalEntity>('entities').add({
              name: rule.targetLabel.trim(),
              createdAt: now,
              updatedAt: now,
            })) as number;
            entityIdCache.set(nameKey, entityId);
          }

          // ── 2. Create one exact dialect per condition ──────────────────────
          for (const condition of rule.conditions) {
            const pattern = condition.value.trim();
            if (!pattern) continue;

            await tx.table<IDialect>('dialects').add({
              entityId,
              pattern,
              scope: 'exact',
              sourceField: condition.field,
              // Legacy rules keep their original priority (default 0)
              priority: rule.priority ?? 0,
              createdAt: now,
            });
          }
        }

        // ── 3. Clear the legacy rules table ───────────────────────────────────
        await tx.table('rules').clear();
      });
  }
}

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private db: AppDatabase;

  constructor() {
    this.db = new AppDatabase();
  }

  /**
   * Replace the underlying database instance.
   * **Only for testing** — pass fresh `DexieOptions` (e.g. an in-memory
   * `FakeIndexedDB`) to guarantee test isolation without polluting the
   * Angular DI constructor signature.
   *
   * @internal
   */
  _useDatabase(options: DexieOptions): void {
    this.db = new AppDatabase(options);
  }

  // ── Canonical Entities ────────────────────────────────────────────────────

  /**
   * Return all canonical entities ordered by name ascending.
   */
  getAllEntities(): Promise<ICanonicalEntity[]> {
    return this.db.entities.orderBy('name').toArray();
  }

  /**
   * Look up an entity by its canonical name (case-insensitive, trimmed).
   * Returns `undefined` if not found.
   */
  async getEntityByName(name: string): Promise<ICanonicalEntity | undefined> {
    const all = await this.db.entities.toArray();
    const key = name.trim().toLowerCase();
    return all.find((e) => e.name.trim().toLowerCase() === key);
  }

  /**
   * Find an entity by canonical name (case-insensitive).
   * If none exists, create it and return it with its new id.
   *
   * This is the preferred creation path — it prevents duplicate entities
   * arising from minor casing differences ("Netflix" vs "netflix").
   */
  async findOrCreateEntity(name: string): Promise<ICanonicalEntity> {
    const trimmed = name.trim();
    const existing = await this.getEntityByName(trimmed);
    if (existing) return existing;

    const now = Date.now();
    const entity: ICanonicalEntity = { name: trimmed, createdAt: now, updatedAt: now };
    entity.id = (await this.db.entities.add(entity)) as number;
    return entity;
  }

  /**
   * Update only the `name` of an existing entity.
   * Also refreshes `updatedAt`.
   */
  async renameEntity(id: number, newName: string): Promise<void> {
    await this.db.entities.update(id, { name: newName.trim(), updatedAt: Date.now() });
  }

  /**
   * Delete a canonical entity **and all its dialects** (cascade).
   */
  async deleteEntity(id: number): Promise<void> {
    await this.db.transaction('rw', this.db.entities, this.db.dialects, async () => {
      await this.db.dialects.where('entityId').equals(id).delete();
      await this.db.entities.delete(id);
    });
  }

  // ── Dialects ──────────────────────────────────────────────────────────────

  /**
   * Add a new dialect. Returns the auto-assigned id.
   */
  addDialect(dialect: Omit<IDialect, 'id'>): Promise<number> {
    return this.db.dialects.add(dialect as IDialect);
  }

  /**
   * Update an existing dialect.
   */
  updateDialect(dialect: IDialect): Promise<number> {
    if (dialect.id === undefined) {
      return Promise.reject(new Error('Dialect id is required for update'));
    }
    return this.db.dialects.put(dialect);
  }

  /**
   * Delete a single dialect by id.
   */
  deleteDialect(id: number): Promise<void> {
    return this.db.dialects.delete(id);
  }

  /**
   * Return all dialects for a given entity, sorted by priority descending.
   */
  async getDialectsForEntity(entityId: number): Promise<IDialect[]> {
    const dialects = await this.db.dialects
      .where('entityId')
      .equals(entityId)
      .toArray();
    return dialects.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Return every dialect in the database, sorted by priority descending.
   */
  async getAllDialects(): Promise<IDialect[]> {
    const all = await this.db.dialects.toArray();
    return all.sort((a, b) => b.priority - a.priority);
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  /**
   * Run the three-tier matching pipeline against the provided description
   * values and return the best `MatchEvidence`, or `undefined` if no match
   * meets the required confidence.
   *
   * ### Pipeline tiers (evaluated in order — first match wins)
   *
   * **Level 1 — Exact**
   * Each `exact`-scoped dialect's `pattern` is compared verbatim
   * (case-insensitive, trimmed) against the raw values in
   * `rawDescriptions[sourceField]`. Score: `1.0`.
   *
   * **Level 2 — Structural**
   * Each `structural`-scoped dialect's `pattern` is compared against the
   * values in `searchKeys[sourceField]` (case-insensitive, trimmed).
   * Skipped when `searchKeys` is not provided. Score: `1.0`.
   *
   * **Level 3 — Similarity (Levenshtein)**
   * All dialects (both scopes) are tested using normalised Levenshtein
   * similarity. Inputs are stripped of dates/IDs before comparison.
   * Only matches with a score ≥ `similarityThreshold` (default `0.8`) are
   * considered. The highest-scoring dialect wins within this tier.
   * Skipped when `enableSimilarity` is `false`.
   *
   * `rawDescriptions` and `searchKeys` are maps of `sourceField → value`.
   *
   * @param rawDescriptions  Map of column header → raw bank description value.
   * @param searchKeys       Map of column header → tokenised search key.
   * @param similarityThreshold  Minimum Levenshtein similarity score (0–1).
   *                             Defaults to `0.8`.
   */
  async findMatchingEntity(
    rawDescriptions: Record<string, string>,
    searchKeys?: Record<string, string>,
    similarityThreshold = 0.8,
  ): Promise<MatchEvidence | undefined> {
    const allDialects = await this.getAllDialects(); // sorted by priority desc

    // ── Level 1: Exact matching ───────────────────────────────────────────────
    for (const dialect of allDialects) {
      if (dialect.scope !== 'exact') continue;
      const rawValue = (rawDescriptions[dialect.sourceField] ?? '').trim().toLowerCase();
      if (!rawValue) continue;
      if (rawValue === dialect.pattern.trim().toLowerCase()) {
        const entity = await this.db.entities.get(dialect.entityId);
        if (entity) {
          return {
            entity,
            dialect,
            level: 'exact',
            score: 1,
            inputValue: rawDescriptions[dialect.sourceField] ?? '',
            matchedPattern: dialect.pattern,
          };
        }
      }
    }

    // ── Level 2: Structural matching (requires searchKeys) ───────────────────
    if (searchKeys) {
      for (const dialect of allDialects) {
        if (dialect.scope !== 'structural') continue;
        const searchKey = (searchKeys[dialect.sourceField] ?? '').trim().toLowerCase();
        if (!searchKey) continue;
        if (searchKey === dialect.pattern.trim().toLowerCase()) {
          const entity = await this.db.entities.get(dialect.entityId);
          if (entity) {
            return {
              entity,
              dialect,
              level: 'structural',
              score: 1,
              inputValue: searchKeys[dialect.sourceField] ?? '',
              matchedPattern: dialect.pattern,
            };
          }
        }
      }
    }

    // ── Level 3: Similarity matching (Levenshtein) ───────────────────────────
    // Collect all candidate inputs (raw descriptions only — normalised).
    const normalisedInputs: Record<string, string> = {};
    for (const [field, value] of Object.entries(rawDescriptions)) {
      normalisedInputs[field] = normalizeForSimilarity(value);
    }

    let bestScore = -1;
    let bestDialect: IDialect | null = null;
    let bestInputValue = '';

    for (const dialect of allDialects) {
      const normalisedInput = normalisedInputs[dialect.sourceField];
      if (!normalisedInput) continue;

      const normalisedPattern = normalizeForSimilarity(dialect.pattern);
      if (!normalisedPattern) continue;

      const score = levenshteinSimilarity(normalisedInput, normalisedPattern);
      if (score >= similarityThreshold && score > bestScore) {
        bestScore = score;
        bestDialect = dialect;
        bestInputValue = rawDescriptions[dialect.sourceField] ?? '';
      }
    }

    if (bestDialect) {
      const entity = await this.db.entities.get(bestDialect.entityId);
      if (entity) {
        return {
          entity,
          dialect: bestDialect,
          level: 'similarity',
          score: bestScore,
          inputValue: bestInputValue,
          matchedPattern: bestDialect.pattern,
        };
      }
    }

    return undefined;
  }

  // ── Legacy rule API (deprecated — kept for backward compatibility) ─────────

  /**
   * @deprecated Use `findOrCreateEntity` + `addDialect` instead.
   * Adds an exact dialect backed by a canonical entity derived from
   * `rule.targetLabel`. Ignores `rule.id` and `rule.priority` beyond
   * setting dialect priority.
   */
  async addRule(rule: Omit<IRule, 'id'>): Promise<number> {
    const entity = await this.findOrCreateEntity(rule.targetLabel);
    const now = Date.now();
    let lastId = 0;
    for (const condition of rule.conditions) {
      lastId = await this.addDialect({
        entityId: entity.id!,
        pattern: condition.value.trim(),
        scope: 'exact',
        sourceField: condition.field,
        priority: rule.priority ?? 0,
        createdAt: now,
      });
    }
    return lastId;
  }

  /**
   * @deprecated Use `findMatchingEntity` instead.
   * Delegates to the exact-match pass of `findMatchingEntity`, returning an
   * `IRule`-shaped object for backward compatibility.
   */
  async findMatchingRule(
    row: Record<string, string>,
  ): Promise<IRule | undefined> {
    const match = await this.findMatchingEntity(row);
    if (!match) return undefined;
    // Reconstruct a minimal IRule shape so existing callers don't break.
    return {
      id: match.dialect.id,
      conditions: [
        { field: match.dialect.sourceField, value: match.dialect.pattern },
      ],
      targetLabel: match.entity.name,
      priority: match.dialect.priority,
    };
  }

  /**
   * @deprecated Use `getAllDialects` + `getAllEntities` instead.
   */
  async getAllRules(): Promise<IRule[]> {
    const dialects = await this.getAllDialects();
    const entityCache = new Map<number, ICanonicalEntity>();
    const rules: IRule[] = [];

    for (const dialect of dialects) {
      let entity = entityCache.get(dialect.entityId);
      if (!entity) {
        entity = await this.db.entities.get(dialect.entityId);
        if (entity) entityCache.set(dialect.entityId, entity);
      }
      if (!entity) continue;
      rules.push({
        id: dialect.id,
        conditions: [{ field: dialect.sourceField, value: dialect.pattern }],
        targetLabel: entity.name,
        priority: dialect.priority,
      });
    }

    return rules;
  }

  /**
   * @deprecated Use `deleteDialect` or `deleteEntity` instead.
   */
  deleteRule(id: number): Promise<void> {
    return this.deleteDialect(id);
  }

  /**
   * @deprecated Use `updateDialect` instead.
   */
  async updateRule(rule: IRule): Promise<number> {
    if (rule.id === undefined) {
      return Promise.reject(new Error('Rule id is required for update'));
    }
    const existing = await this.db.dialects.get(rule.id);
    if (!existing) {
      return Promise.reject(new Error(`Dialect with id ${rule.id} not found`));
    }
    const entity = await this.findOrCreateEntity(rule.targetLabel);
    const updated: IDialect = {
      ...existing,
      entityId: entity.id!,
      pattern: rule.conditions[0]?.value?.trim() ?? existing.pattern,
      sourceField: rule.conditions[0]?.field ?? existing.sourceField,
      priority: rule.priority,
    };
    return this.db.dialects.put(updated);
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