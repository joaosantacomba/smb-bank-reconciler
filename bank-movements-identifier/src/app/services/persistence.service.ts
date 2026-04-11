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
import { IMovement } from '../models/movement.model';
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
  movements!: Table<IMovement, number>;

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

    // ── v4: add movements vault ───────────────────────────────────────────────
    this.version(4).stores({
      rules: '++id, targetLabel, priority',
      preferences: 'id',
      entities: '++id, &name',
      dialects: '++id, entityId, pattern, scope, priority',
      // [date+amount+description] compound index for duplicate detection (Task 4.2)
      movements: '++id, date, entity, reconciledAt, [date+amount+description]',
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
   * Run the three-tier matching pipeline and return **all** matching entities,
   * one `MatchEvidence` per unique canonical entity (best match per entity).
   *
   * Results are sorted by tier priority (exact > structural > similarity) and
   * then by score descending. This powers the ambiguity-detection logic: when
   * the returned array contains more than one entry, the pattern is ambiguous.
   *
   * ### Pipeline tiers (all evaluated — not first-match-wins)
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
   * similarity. Only matches with a score ≥ `similarityThreshold` (default
   * `0.8`) are considered.
   * Skipped when a given entity already has a higher-tier match.
   *
   * @param rawDescriptions  Map of column header → raw bank description value.
   * @param searchKeys       Map of column header → tokenised search key.
   * @param similarityThreshold  Minimum Levenshtein similarity score (0–1).
   *                             Defaults to `0.8`.
   */
  async findAllMatchingEntities(
    rawDescriptions: Record<string, string>,
    searchKeys?: Record<string, string>,
    similarityThreshold = 0.8,
  ): Promise<MatchEvidence[]> {
    const allDialects = await this.getAllDialects(); // sorted by priority desc

    // Best evidence per entity id — we keep at most one MatchEvidence per entity,
    // preferring: exact > structural > similarity, then higher score.
    const bestPerEntity = new Map<number, MatchEvidence>();

    const tierRank: Record<MatchEvidence['level'], number> = {
      exact: 2,
      structural: 1,
      similarity: 0,
    };

    const isBetter = (candidate: MatchEvidence, existing: MatchEvidence): boolean => {
      const cr = tierRank[candidate.level];
      const er = tierRank[existing.level];
      if (cr !== er) return cr > er;
      return candidate.score > existing.score;
    };

    const maybeStore = (evidence: MatchEvidence): void => {
      const entityId = evidence.entity.id!;
      const existing = bestPerEntity.get(entityId);
      if (!existing || isBetter(evidence, existing)) {
        bestPerEntity.set(entityId, evidence);
      }
    };

    // ── Level 1: Exact matching ───────────────────────────────────────────────
    for (const dialect of allDialects) {
      if (dialect.scope !== 'exact') continue;
      const rawValue = (rawDescriptions[dialect.sourceField] ?? '').trim().toLowerCase();
      if (!rawValue) continue;
      if (rawValue === dialect.pattern.trim().toLowerCase()) {
        const entity = await this.db.entities.get(dialect.entityId);
        if (entity) {
          maybeStore({
            entity,
            dialect,
            level: 'exact',
            score: 1,
            inputValue: rawDescriptions[dialect.sourceField] ?? '',
            matchedPattern: dialect.pattern,
          });
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
            maybeStore({
              entity,
              dialect,
              level: 'structural',
              score: 1,
              inputValue: searchKeys[dialect.sourceField] ?? '',
              matchedPattern: dialect.pattern,
            });
          }
        }
      }
    }

    // ── Level 3: Similarity matching (Levenshtein) ───────────────────────────
    const normalisedInputs: Record<string, string> = {};
    for (const [field, value] of Object.entries(rawDescriptions)) {
      normalisedInputs[field] = normalizeForSimilarity(value);
    }

    // Build: entityId → best similarity evidence for that entity so far
    const simBestPerEntity = new Map<
      number,
      { score: number; dialect: IDialect; inputValue: string }
    >();

    for (const dialect of allDialects) {
      const normalisedInput = normalisedInputs[dialect.sourceField];
      if (!normalisedInput) continue;
      const normalisedPattern = normalizeForSimilarity(dialect.pattern);
      if (!normalisedPattern) continue;

      const score = levenshteinSimilarity(normalisedInput, normalisedPattern);
      if (score < similarityThreshold) continue;

      const existing = simBestPerEntity.get(dialect.entityId);
      if (!existing || score > existing.score) {
        simBestPerEntity.set(dialect.entityId, {
          score,
          dialect,
          inputValue: rawDescriptions[dialect.sourceField] ?? '',
        });
      }
    }

    for (const [entityId, best] of simBestPerEntity) {
      const entity = await this.db.entities.get(entityId);
      if (entity) {
        maybeStore({
          entity,
          dialect: best.dialect,
          level: 'similarity',
          score: best.score,
          inputValue: best.inputValue,
          matchedPattern: best.dialect.pattern,
        });
      }
    }

    // Sort: tier rank desc, then score desc
    return [...bestPerEntity.values()].sort((a, b) => {
      const rd = tierRank[b.level] - tierRank[a.level];
      if (rd !== 0) return rd;
      return b.score - a.score;
    });
  }

  /**
   * Run the three-tier matching pipeline against the provided description
   * values and return the best `MatchEvidence`, or `undefined` if no match
   * meets the required confidence.
   *
   * Delegates to `findAllMatchingEntities` and returns the single top result.
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
    const all = await this.findAllMatchingEntities(rawDescriptions, searchKeys, similarityThreshold);
    return all[0];
  }
  /**
   * Check whether a dialect with the same `pattern + scope + sourceField +
   * entityId` quad already exists in the database.
   * Used by `onLabelCommit` to prevent duplicate dialect entries when the
   * same pattern is committed more than once for the same entity.
   */
  async dialectExists(
    entityId: number,
    pattern: string,
    scope: IDialect['scope'],
    sourceField: string,
  ): Promise<boolean> {
    const existing = await this.getDialectsForEntity(entityId);
    return existing.some(
      (d) =>
        d.pattern === pattern &&
        d.scope === scope &&
        d.sourceField === sourceField,
    );
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

  // ── Movements Vault ───────────────────────────────────────────────────────

  /**
   * Build a composite string key used for duplicate detection.
   * The key is `date|amount|description` — normalised and lowercased.
   */
  private movementKey(date: string, amount: number, description: string): string {
    return `${date.trim().toLowerCase()}|${amount}|${description.trim().toLowerCase()}`;
  }

  /**
   * Given a batch of candidate movements, return the subset whose
   * `date + amount + description` composite already exists in the vault.
   * Uses the compound index `[date+amount+description]` for efficiency.
   */
  async findDuplicates(
    movements: Omit<IMovement, 'id'>[],
  ): Promise<Set<string>> {
    const duplicateKeys = new Set<string>();
    if (!movements.length) return duplicateKeys;

    // We query with the compound index; Dexie requires exact value arrays.
    for (const m of movements) {
      const count = await this.db.movements
        .where('[date+amount+description]')
        .equals([m.date, m.amount, m.description])
        .count();
      if (count > 0) {
        duplicateKeys.add(this.movementKey(m.date, m.amount, m.description));
      }
    }

    return duplicateKeys;
  }

  /**
   * Persist a batch of reconciled movements to the permanent history,
   * silently skipping any entry whose `date + amount + description`
   * composite already exists in the vault.
   *
   * Returns `{ saved, skipped }` counts.
   */
  async addMovements(
    movements: Omit<IMovement, 'id'>[],
  ): Promise<{ saved: number; skipped: number }> {
    if (!movements.length) return { saved: 0, skipped: 0 };

    const duplicates = await this.findDuplicates(movements);
    const toInsert = movements.filter(
      (m) => !duplicates.has(this.movementKey(m.date, m.amount, m.description)),
    );

    if (toInsert.length) {
      await this.db.movements.bulkAdd(toInsert as IMovement[]);
    }

    return { saved: toInsert.length, skipped: duplicates.size };
  }

  /**
   * Return all stored movements, ordered by `reconciledAt` descending
   * (most recently saved first).
   */
  async getAllMovements(): Promise<IMovement[]> {
    const all = await this.db.movements.toArray();
    return all.sort((a, b) => b.reconciledAt - a.reconciledAt);
  }

  /**
   * Return stored movements for a given ISO calendar month.
   * Both `year` and `month` are 1-based (January = 1).
   *
   * Filtering is done in-memory after a full table scan because `date`
   * is stored as the original bank string (not a normalised ISO date).
   * For Task 4.3 we may add a normalised `dateISO` index for efficiency.
   */
  async getMovementsByMonth(year: number, month: number): Promise<IMovement[]> {
    const all = await this.db.movements.toArray();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return all
      .filter((m) => m.date.startsWith(prefix))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Delete a single movement record by id.
   */
  deleteMovement(id: number): Promise<void> {
    return this.db.movements.delete(id);
  }

  /**
   * Remove all movements from the vault.
   * Intended for development/testing use only.
   * @internal
   */
  clearMovements(): Promise<void> {
    return this.db.movements.clear();
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

  // ── Full Database Export / Import ─────────────────────────────────────────

  /**
   * Export the entire database as a single JSON-serialisable object.
   * Includes all entities, dialects, movements, and user preferences.
   */
  async exportAll(): Promise<{
    version: number;
    exportedAt: number;
    entities: ICanonicalEntity[];
    dialects: IDialect[];
    movements: IMovement[];
    preferences: IUserPreferences;
  }> {
    const [entities, dialects, movements, preferences] = await Promise.all([
      this.getAllEntities(),
      this.getAllDialects(),
      this.getAllMovements(),
      this.getPreferences(),
    ]);
    return {
      version: 1,
      exportedAt: Date.now(),
      entities,
      dialects,
      movements,
      preferences,
    };
  }

  /**
   * Import data from a backup JSON object **additively** (never replaces
   * existing data — only adds new records that are not already present).
   *
   * - **Entities**: found-or-created by canonical name (case-insensitive).
   *   Old `id` values from the backup are remapped to their new local ids.
   * - **Dialects**: added only when no existing dialect for that entity has
   *   the same `pattern + scope + sourceField` triple.
   * - **Movements**: de-duplicated by `date + amount + description` composite
   *   (delegates to `addMovements` which already handles this).
   * - **Preferences**: merged (only known keys applied).
   *
   * Returns counts of *newly inserted* records for display in the UI.
   */
  async importAll(
    data: unknown,
  ): Promise<{ entities: number; dialects: number; movements: number }> {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid backup format');
    }
    const d = data as Record<string, unknown>;

    let importedEntities = 0;
    let importedDialects = 0;

    // old backup id → new local id (needed to remap dialect.entityId)
    const entityIdMap = new Map<number, number>();

    // ── 1. Entities ──────────────────────────────────────────────────────────
    if (Array.isArray(d['entities'])) {
      for (const e of d['entities'] as ICanonicalEntity[]) {
        if (!e.name) continue;
        const existing = await this.getEntityByName(e.name);
        if (existing) {
          if (e.id !== undefined) entityIdMap.set(e.id, existing.id!);
        } else {
          const created = await this.findOrCreateEntity(e.name);
          if (e.id !== undefined) entityIdMap.set(e.id, created.id!);
          importedEntities++;
        }
      }
    }

    // ── 2. Dialects ──────────────────────────────────────────────────────────
    if (Array.isArray(d['dialects'])) {
      for (const dial of d['dialects'] as IDialect[]) {
        if (dial.entityId === undefined) continue;
        const newEntityId = entityIdMap.get(dial.entityId);
        if (newEntityId === undefined) continue;

        // Skip if an identical dialect already exists for this entity.
        const existing = await this.getDialectsForEntity(newEntityId);
        const isDuplicate = existing.some(
          (ed) =>
            ed.pattern === dial.pattern &&
            ed.scope === dial.scope &&
            ed.sourceField === dial.sourceField,
        );
        if (!isDuplicate) {
          await this.addDialect({
            entityId: newEntityId,
            pattern: dial.pattern,
            scope: dial.scope,
            sourceField: dial.sourceField,
            priority: dial.priority,
            createdAt: dial.createdAt ?? Date.now(),
          });
          importedDialects++;
        }
      }
    }

    // ── 3. Movements ─────────────────────────────────────────────────────────
    let savedMovements = 0;
    if (Array.isArray(d['movements'])) {
      const movements = (d['movements'] as IMovement[]).map((m) => ({
        date: m.date,
        description: m.description,
        amount: m.amount,
        entity: m.entity,
        category: m.category,
        reconciledAt: m.reconciledAt ?? Date.now(),
      })) as Omit<IMovement, 'id'>[];
      const result = await this.addMovements(movements);
      savedMovements = result.saved;
    }

    // ── 4. Preferences (merge) ────────────────────────────────────────────────
    if (d['preferences']) {
      await this.importPreferences(d['preferences']);
    }

    return { entities: importedEntities, dialects: importedDialects, movements: savedMovements };
  }

  // ── Destructive Utilities ─────────────────────────────────────────────────

  /**
   * Remove **all** entities and their associated dialects from the database.
   * This is the "Clean Memory" operation. Irreversible — confirm with the
   * user before calling.
   */
  async clearEntitiesAndDialects(): Promise<void> {
    await this.db.transaction('rw', this.db.entities, this.db.dialects, async () => {
      await this.db.dialects.clear();
      await this.db.entities.clear();
    });
  }
}
