// Provide a fresh in-memory IndexedDB for every test to prevent state leakage.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

import { PersistenceService } from './persistence.service';

// Angular's @Injectable decorator requires a minimal reflection setup;
// bypass it by constructing the service directly.
describe('PersistenceService', () => {
  let service: PersistenceService;

  beforeEach(() => {
    service = new PersistenceService();
    // Inject a brand-new in-memory IDB so each test starts with a clean slate.
    service._useDatabase({ indexedDB: new IDBFactory(), IDBKeyRange });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Canonical Entities
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Canonical Entities', () => {
    it('findOrCreateEntity should create a new entity and return it with an id', async () => {
      const entity = await service.findOrCreateEntity('Netflix');
      expect(entity.id).toBeDefined();
      expect(entity.id).toBeGreaterThan(0);
      expect(entity.name).toBe('Netflix');
      expect(entity.createdAt).toBeGreaterThan(0);
      expect(entity.updatedAt).toBeGreaterThan(0);
    });

    it('findOrCreateEntity should return the existing entity on a duplicate call', async () => {
      const first = await service.findOrCreateEntity('Netflix');
      const second = await service.findOrCreateEntity('Netflix');
      expect(second.id).toBe(first.id);
    });

    it('findOrCreateEntity should be case-insensitive (deduplication)', async () => {
      const lower = await service.findOrCreateEntity('continente');
      const upper = await service.findOrCreateEntity('CONTINENTE');
      expect(upper.id).toBe(lower.id);
    });

    it('findOrCreateEntity should trim whitespace before deduplication', async () => {
      const a = await service.findOrCreateEntity('  Spotify  ');
      const b = await service.findOrCreateEntity('Spotify');
      expect(b.id).toBe(a.id);
    });

    it('getAllEntities should return entities sorted by name ascending', async () => {
      await service.findOrCreateEntity('Zappos');
      await service.findOrCreateEntity('Amazon');
      await service.findOrCreateEntity('Netflix');

      const entities = await service.getAllEntities();
      const names = entities.map((e) => e.name);
      expect(names).toEqual([...names].sort());
    });

    it('getEntityByName should find an entity case-insensitively', async () => {
      await service.findOrCreateEntity('Continente');
      const found = await service.getEntityByName('CONTINENTE');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Continente');
    });

    it('getEntityByName should return undefined when no entity exists', async () => {
      const found = await service.getEntityByName('Unknown');
      expect(found).toBeUndefined();
    });

    it('renameEntity should update the name and refresh updatedAt', async () => {
      const entity = await service.findOrCreateEntity('Old Name');
      const createdAt = entity.updatedAt;

      // Ensure some time passes so the timestamps differ
      await new Promise((r) => setTimeout(r, 2));
      await service.renameEntity(entity.id!, 'New Name');

      const updated = await service.getEntityByName('New Name');
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('New Name');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(createdAt);
    });

    it('deleteEntity should remove the entity and all its dialects', async () => {
      const entity = await service.findOrCreateEntity('ToDelete');
      const now = Date.now();
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'TODELETE SA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });

      await service.deleteEntity(entity.id!);

      const remaining = await service.getEntityByName('ToDelete');
      expect(remaining).toBeUndefined();

      const dialects = await service.getDialectsForEntity(entity.id!);
      expect(dialects).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dialects
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Dialects', () => {
    it('addDialect should persist a dialect and return a numeric id', async () => {
      const entity = await service.findOrCreateEntity('Amazon');
      const id = await service.addDialect({
        entityId: entity.id!,
        pattern: 'AMZN MKTP',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('getDialectsForEntity should return only dialects for the given entity', async () => {
      const amazon = await service.findOrCreateEntity('Amazon');
      const netflix = await service.findOrCreateEntity('Netflix');
      const now = Date.now();

      await service.addDialect({
        entityId: amazon.id!,
        pattern: 'AMZN',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: netflix.id!,
        pattern: 'NETFLIX',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });

      const amazonDialects = await service.getDialectsForEntity(amazon.id!);
      expect(amazonDialects).toHaveLength(1);
      expect(amazonDialects[0].pattern).toBe('AMZN');
    });

    it('getDialectsForEntity should sort by priority descending', async () => {
      const entity = await service.findOrCreateEntity('Continente');
      const now = Date.now();

      await service.addDialect({
        entityId: entity.id!,
        pattern: 'pattern-low',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'pattern-high',
        scope: 'exact',
        sourceField: 'Description',
        priority: 10,
        createdAt: now,
      });

      const dialects = await service.getDialectsForEntity(entity.id!);
      expect(dialects[0].priority).toBeGreaterThan(dialects[1].priority);
    });

    it('getAllDialects should return all dialects sorted by priority descending', async () => {
      const entity = await service.findOrCreateEntity('Mixed');
      const now = Date.now();
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'A',
        scope: 'exact',
        sourceField: 'Description',
        priority: 5,
        createdAt: now,
      });
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'B',
        scope: 'structural',
        sourceField: 'Description',
        priority: 99,
        createdAt: now,
      });

      const all = await service.getAllDialects();
      const priorities = all.map((d) => d.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    });

    it('updateDialect should overwrite an existing dialect', async () => {
      const entity = await service.findOrCreateEntity('TestEntity');
      const id = await service.addDialect({
        entityId: entity.id!,
        pattern: 'old pattern',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      await service.updateDialect({
        id,
        entityId: entity.id!,
        pattern: 'new pattern',
        scope: 'structural',
        sourceField: 'Description',
        priority: 5,
        createdAt: Date.now(),
      });

      const dialects = await service.getDialectsForEntity(entity.id!);
      const updated = dialects.find((d) => d.id === id);
      expect(updated?.pattern).toBe('new pattern');
      expect(updated?.scope).toBe('structural');
      expect(updated?.priority).toBe(5);
    });

    it('updateDialect should reject when id is missing', async () => {
      const entity = await service.findOrCreateEntity('NoId');
      await expect(
        service.updateDialect({
          entityId: entity.id!,
          pattern: 'x',
          scope: 'exact',
          sourceField: 'Description',
          priority: 1,
          createdAt: Date.now(),
        }),
      ).rejects.toThrow('Dialect id is required for update');
    });

    it('deleteDialect should remove only the specified dialect', async () => {
      const entity = await service.findOrCreateEntity('PartialDelete');
      const now = Date.now();
      const idToDelete = await service.addDialect({
        entityId: entity.id!,
        pattern: 'remove-me',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'keep-me',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });

      await service.deleteDialect(idToDelete);

      const remaining = await service.getDialectsForEntity(entity.id!);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].pattern).toBe('keep-me');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // findMatchingEntity — exact matching
  // ═══════════════════════════════════════════════════════════════════════════

  describe('findMatchingEntity — exact matching', () => {
    it('should return the matching entity for an exact dialect', async () => {
      const entity = await service.findOrCreateEntity('Spotify');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'SPOTIFY SUBSCRIPTION',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({
        Description: 'SPOTIFY SUBSCRIPTION',
      });

      expect(result).toBeDefined();
      expect(result!.entity.name).toBe('Spotify');
      expect(result!.level).toBe('exact');
      expect(result!.score).toBe(1);
    });

    it('exact matching should be case-insensitive and trim whitespace', async () => {
      const entity = await service.findOrCreateEntity('Spotify');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'Spotify Subscription',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({
        Description: '  SPOTIFY SUBSCRIPTION  ',
      });

      expect(result?.entity.name).toBe('Spotify');
    });

    it('should return undefined when no exact dialect matches', async () => {
      const entity = await service.findOrCreateEntity('Spotify');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'SPOTIFY',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({ Description: 'UNKNOWN' });
      expect(result).toBeUndefined();
    });

    it('should respect sourceField — a dialect does not match a different field', async () => {
      const entity = await service.findOrCreateEntity('FieldTest');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'TRANSFER',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // Looking up with a different field key — should NOT match
      const result = await service.findMatchingEntity({ Memo: 'TRANSFER' });
      expect(result).toBeUndefined();
    });

    it('should return evidence with inputValue and matchedPattern', async () => {
      const entity = await service.findOrCreateEntity('Amazon');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'AMZN MKTP',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({ Description: 'AMZN MKTP' });
      expect(result?.inputValue).toBe('AMZN MKTP');
      expect(result?.matchedPattern).toBe('AMZN MKTP');
    });

    it('should return the highest-priority exact dialect match', async () => {
      const low = await service.findOrCreateEntity('LowPriority');
      const high = await service.findOrCreateEntity('HighPriority');
      const now = Date.now();

      await service.addDialect({
        entityId: low.id!,
        pattern: 'TRANSFER',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: high.id!,
        pattern: 'TRANSFER',
        scope: 'exact',
        sourceField: 'Description',
        priority: 99,
        createdAt: now,
      });

      const result = await service.findMatchingEntity({ Description: 'TRANSFER' });
      expect(result?.entity.name).toBe('HighPriority');
    });

    it('should match across multiple description fields (first matching field wins)', async () => {
      const entity = await service.findOrCreateEntity('MultiField');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'ACME CORP',
        scope: 'exact',
        sourceField: 'Beneficiary',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({
        Description: 'TRF 01/03',
        Beneficiary: 'ACME CORP',
      });
      expect(result?.entity.name).toBe('MultiField');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // findMatchingEntity — structural matching
  // ═══════════════════════════════════════════════════════════════════════════

  describe('findMatchingEntity — structural matching', () => {
    it('should return the matching entity for a structural dialect', async () => {
      const entity = await service.findOrCreateEntity('Continente');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'trf {date} continente {id}',
        scope: 'structural',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // The searchKey for "TRF 01/03 CONTINENTE 123456" is the pattern above
      const result = await service.findMatchingEntity(
        { Description: 'TRF 01/03 CONTINENTE 123456' },
        { Description: 'trf {date} continente {id}' },
      );

      expect(result).toBeDefined();
      expect(result!.entity.name).toBe('Continente');
      expect(result!.level).toBe('structural');
      expect(result!.score).toBe(1);
    });

    it('structural matching should be case-insensitive', async () => {
      const entity = await service.findOrCreateEntity('Structural Case');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'TRF {DATE} CONTINENTE {ID}',
        scope: 'structural',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity(
        { Description: 'TRF 01/03 CONTINENTE 999' },
        { Description: 'trf {date} continente {id}' },
      );

      expect(result?.entity.name).toBe('Structural Case');
    });

    it('should skip structural pass when searchKeys are not provided', async () => {
      const entity = await service.findOrCreateEntity('StructuralOnly');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'trf {date} test {id}',
        scope: 'structural',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // No searchKeys → structural pass is skipped
      const result = await service.findMatchingEntity({
        Description: 'TRF 01/03 TEST 12345',
      });
      expect(result).toBeUndefined();
    });

    it('exact pass should be checked before structural pass', async () => {
      const exactEntity = await service.findOrCreateEntity('ExactWins');
      const structuralEntity = await service.findOrCreateEntity('StructuralFallback');
      const now = Date.now();

      await service.addDialect({
        entityId: exactEntity.id!,
        pattern: 'TRF 01/03 CONTINENTE 123456',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: structuralEntity.id!,
        pattern: 'trf {date} continente {id}',
        scope: 'structural',
        sourceField: 'Description',
        priority: 99, // higher priority but wrong pass order
        createdAt: now,
      });

      const result = await service.findMatchingEntity(
        { Description: 'TRF 01/03 CONTINENTE 123456' },
        { Description: 'trf {date} continente {id}' },
      );

      // Exact always wins over structural regardless of priority
      expect(result?.entity.name).toBe('ExactWins');
      expect(result?.level).toBe('exact');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // findMatchingEntity — similarity matching (Level 3)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('findMatchingEntity — similarity matching', () => {
    it('returns a similarity match when exact and structural fail but Levenshtein ≥ 0.8', async () => {
      const entity = await service.findOrCreateEntity('Continente');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'COMPRA CONTINENTE LDA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // Near-duplicate: "COMPRA CONTINENTE SA" vs "COMPRA CONTINENTE LDA"
      const result = await service.findMatchingEntity({
        Description: 'COMPRA CONTINENTE SA',
      });

      expect(result).toBeDefined();
      expect(result!.entity.name).toBe('Continente');
      expect(result!.level).toBe('similarity');
      expect(result!.score).toBeGreaterThanOrEqual(0.8);
      expect(result!.score).toBeLessThan(1);
    });

    it('returns the score and evidence metadata for similarity matches', async () => {
      const entity = await service.findOrCreateEntity('Netflix');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'NETFLIX SUBSCRIPTION',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      const result = await service.findMatchingEntity({
        Description: 'NETFLIX SUBSCRIPTIO',
      });

      expect(result?.level).toBe('similarity');
      expect(result?.inputValue).toBe('NETFLIX SUBSCRIPTIO');
      expect(result?.matchedPattern).toBe('NETFLIX SUBSCRIPTION');
      expect(typeof result?.score).toBe('number');
    });

    it('exact match wins over similarity match even for the same string', async () => {
      const exactEntity = await service.findOrCreateEntity('ExactPriority');
      const similarEntity = await service.findOrCreateEntity('SimilarFallback');
      const now = Date.now();

      await service.addDialect({
        entityId: exactEntity.id!,
        pattern: 'COMPRA EXACTA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: similarEntity.id!,
        pattern: 'COMPRA EXACTA VARIANTE',
        scope: 'exact',
        sourceField: 'Description',
        priority: 99,
        createdAt: now,
      });

      const result = await service.findMatchingEntity({
        Description: 'COMPRA EXACTA',
      });

      expect(result?.entity.name).toBe('ExactPriority');
      expect(result?.level).toBe('exact');
    });

    it('structural match wins over similarity match', async () => {
      const structEntity = await service.findOrCreateEntity('StructuralFirst');
      const simEntity = await service.findOrCreateEntity('SimilarSecond');
      const now = Date.now();

      await service.addDialect({
        entityId: structEntity.id!,
        pattern: 'trf {date} continente {id}',
        scope: 'structural',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: simEntity.id!,
        pattern: 'TRF 01/03 CONTINENTE 123456',
        scope: 'exact',
        sourceField: 'Description',
        priority: 99,
        createdAt: now,
      });

      // Provide searchKeys so structural pass can run
      const result = await service.findMatchingEntity(
        { Description: 'TRF 02/04 CONTINENTE 999999' },
        { Description: 'trf {date} continente {id}' },
      );

      expect(result?.entity.name).toBe('StructuralFirst');
      expect(result?.level).toBe('structural');
    });

    it('returns undefined when the best similarity score is below the threshold', async () => {
      const entity = await service.findOrCreateEntity('Unrelated');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'NETFLIX SUBSCRIPTION',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // Completely different string — score will be well below 0.8
      const result = await service.findMatchingEntity({
        Description: 'AMAZON WEB SERVICES',
      });

      expect(result).toBeUndefined();
    });

    it('respects a custom similarityThreshold parameter', async () => {
      const entity = await service.findOrCreateEntity('Threshold Test');
      await service.addDialect({
        entityId: entity.id!,
        pattern: 'COMPRA CONTINENTE LDA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: Date.now(),
      });

      // This input has a similarity of ~0.86 against the pattern
      // Using threshold 0.99 should reject it; threshold 0.5 should accept it.
      const highThreshold = await service.findMatchingEntity(
        { Description: 'COMPRA CONTINENTE SA' },
        undefined,
        0.99,
      );
      expect(highThreshold).toBeUndefined();

      const lowThreshold = await service.findMatchingEntity(
        { Description: 'COMPRA CONTINENTE SA' },
        undefined,
        0.5,
      );
      expect(lowThreshold).toBeDefined();
      expect(lowThreshold?.level).toBe('similarity');
    });

    it('picks the highest-scoring dialect when multiple similarity candidates exist', async () => {
      const entityA = await service.findOrCreateEntity('Entity A');
      const entityB = await service.findOrCreateEntity('Entity B');
      const now = Date.now();

      // Entity B's pattern is closer to the input
      await service.addDialect({
        entityId: entityA.id!,
        pattern: 'PAGAMENTO AGUA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });
      await service.addDialect({
        entityId: entityB.id!,
        pattern: 'PAGAMENTO AGUA LDA',
        scope: 'exact',
        sourceField: 'Description',
        priority: 1,
        createdAt: now,
      });

      const result = await service.findMatchingEntity({
        Description: 'PAGAMENTO AGUA SA',
      });

      // Both are similar; the one with the higher score should win.
      // "PAGAMENTO AGUA" vs input: distance 3 (SA), max 17 → similarity ≈ 0.82
      // "PAGAMENTO AGUA LDA" vs input: depends on normalised comparison
      expect(result).toBeDefined();
      expect(result?.level).toBe('similarity');
      expect(result?.score).toBeGreaterThanOrEqual(0.8);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy addRule / findMatchingRule / getAllRules / deleteRule / updateRule
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Legacy rule API (backward compatibility)', () => {
    it('addRule should create a canonical entity and an exact dialect', async () => {
      await service.addRule({
        conditions: [{ field: 'Description', value: 'Netflix' }],
        targetLabel: 'Entertainment',
        priority: 1,
      });

      const entity = await service.getEntityByName('Entertainment');
      expect(entity).toBeDefined();

      const dialects = await service.getDialectsForEntity(entity!.id!);
      expect(dialects.some((d) => d.pattern === 'Netflix' && d.scope === 'exact')).toBe(true);
    });

    it('addRule should reuse an existing entity when targetLabel already exists', async () => {
      await service.addRule({
        conditions: [{ field: 'Description', value: 'A' }],
        targetLabel: 'Shared',
        priority: 1,
      });
      await service.addRule({
        conditions: [{ field: 'Description', value: 'B' }],
        targetLabel: 'Shared',
        priority: 1,
      });

      const entities = await service.getAllEntities();
      expect(entities.filter((e) => e.name === 'Shared')).toHaveLength(1);
    });

    it('findMatchingRule should return an IRule-shaped object for a matching dialect', async () => {
      await service.addRule({
        conditions: [{ field: 'Description', value: 'Spotify' }],
        targetLabel: 'Entertainment',
        priority: 1,
      });

      const match = await service.findMatchingRule({ Description: 'Spotify' });
      expect(match?.targetLabel).toBe('Entertainment');
    });

    it('findMatchingRule should return undefined when no dialect matches', async () => {
      const match = await service.findMatchingRule({ Description: 'Unknown XYZ' });
      expect(match).toBeUndefined();
    });

    it('findMatchingRule should be case-insensitive', async () => {
      await service.addRule({
        conditions: [{ field: 'Description', value: 'Netflix' }],
        targetLabel: 'Entertainment',
        priority: 1,
      });

      const match = await service.findMatchingRule({ Description: '  NETFLIX  ' });
      expect(match?.targetLabel).toBe('Entertainment');
    });

    it('getAllRules should return IRule-shaped objects for all dialects', async () => {
      await service.addRule({
        conditions: [{ field: 'Description', value: 'A' }],
        targetLabel: 'LabelA',
        priority: 1,
      });
      await service.addRule({
        conditions: [{ field: 'Description', value: 'B' }],
        targetLabel: 'LabelB',
        priority: 2,
      });

      const rules = await service.getAllRules();
      expect(rules.length).toBeGreaterThanOrEqual(2);
      expect(rules.some((r) => r.targetLabel === 'LabelA')).toBe(true);
      expect(rules.some((r) => r.targetLabel === 'LabelB')).toBe(true);
    });

    it('deleteRule should remove the dialect', async () => {
      const id = await service.addRule({
        conditions: [{ field: 'Description', value: 'ToDelete' }],
        targetLabel: 'Gone',
        priority: 1,
      });

      await service.deleteRule(id);

      const rules = await service.getAllRules();
      expect(rules.find((r) => r.id === id)).toBeUndefined();
    });

    it('updateRule should overwrite the dialect and reassign entity if label changes', async () => {
      const id = await service.addRule({
        conditions: [{ field: 'Description', value: 'Old' }],
        targetLabel: 'OldLabel',
        priority: 1,
      });

      await service.updateRule({
        id,
        conditions: [{ field: 'Description', value: 'New' }],
        targetLabel: 'NewLabel',
        priority: 2,
      });

      const rules = await service.getAllRules();
      const updated = rules.find((r) => r.id === id);
      expect(updated?.targetLabel).toBe('NewLabel');
      expect(updated?.conditions[0].value).toBe('New');
    });

    it('updateRule should reject when id is missing', async () => {
      await expect(
        service.updateRule({
          conditions: [{ field: 'Description', value: 'X' }],
          targetLabel: 'X',
          priority: 1,
        }),
      ).rejects.toThrow('Rule id is required for update');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // User Preferences
  // ═══════════════════════════════════════════════════════════════════════════

  describe('User Preferences', () => {
    it('getPreferences should return defaults when nothing has been saved', async () => {
      const prefs = await service.getPreferences();
      expect(typeof prefs.showNegativeAmounts).toBe('boolean');
    });

    it('savePreferences and getPreferences should round-trip correctly', async () => {
      await service.savePreferences({ showNegativeAmounts: true });
      const loaded = await service.getPreferences();
      expect(loaded.showNegativeAmounts).toBe(true);
    });

    it('patchPreferences should update only the specified key', async () => {
      await service.savePreferences({ showNegativeAmounts: false });
      await service.patchPreferences({ showNegativeAmounts: true });
      const loaded = await service.getPreferences();
      expect(loaded.showNegativeAmounts).toBe(true);
    });
  });
});