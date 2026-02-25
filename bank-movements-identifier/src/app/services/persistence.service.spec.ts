// fake-indexeddb/auto registers an in-memory IndexedDB in the Node environment
import 'fake-indexeddb/auto';

import { PersistenceService } from './persistence.service';

// Angular's @Injectable decorator requires a minimal reflection setup;
// bypass it by constructing the service directly.
describe('PersistenceService', () => {
  let service: PersistenceService;

  beforeEach(() => {
    service = new PersistenceService();
  });

  // ── CRUD ────────────────────────────────────────────────────────────────────

  it('addRule should persist a rule and return a numeric id', async () => {
    const id = await service.addRule({
      conditions: [{ field: 'Description', value: 'Netflix' }],
      targetLabel: 'Entertainment',
      priority: 1,
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('getAllRules should return rules sorted by priority descending', async () => {
    await service.addRule({
      conditions: [{ field: 'Description', value: 'A' }],
      targetLabel: 'A',
      priority: 1,
    });
    await service.addRule({
      conditions: [{ field: 'Description', value: 'B' }],
      targetLabel: 'B',
      priority: 10,
    });
    await service.addRule({
      conditions: [{ field: 'Description', value: 'C' }],
      targetLabel: 'C',
      priority: 5,
    });

    const rules = await service.getAllRules();
    const priorities = rules.map((r) => r.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it('updateRule should overwrite an existing rule', async () => {
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

  it('deleteRule should remove a rule', async () => {
    const id = await service.addRule({
      conditions: [{ field: 'Description', value: 'ToDelete' }],
      targetLabel: 'Gone',
      priority: 1,
    });
    await service.deleteRule(id);
    const rules = await service.getAllRules();
    expect(rules.find((r) => r.id === id)).toBeUndefined();
  });

  // ── Composite matching ───────────────────────────────────────────────────────

  it('findMatchingRule should match a single-condition rule', async () => {
    await service.addRule({
      conditions: [{ field: 'Description', value: 'Spotify' }],
      targetLabel: 'Entertainment',
      priority: 1,
    });

    const match = await service.findMatchingRule({ Description: 'Spotify' });
    expect(match?.targetLabel).toBe('Entertainment');
  });

  it('findMatchingRule should match a multi-condition rule', async () => {
    await service.addRule({
      conditions: [
        { field: 'Entity Name', value: 'Amazon' },
        { field: 'Description', value: 'Prime' },
      ],
      targetLabel: 'Subscriptions',
      priority: 5,
    });

    const match = await service.findMatchingRule({
      'Entity Name': 'Amazon',
      Description: 'Prime',
    });
    expect(match?.targetLabel).toBe('Subscriptions');
  });

  it('findMatchingRule should NOT match when only some conditions are met', async () => {
    await service.addRule({
      conditions: [
        { field: 'Entity Name', value: 'Amazon' },
        { field: 'Description', value: 'Prime' },
      ],
      targetLabel: 'Subscriptions',
      priority: 5,
    });

    const match = await service.findMatchingRule({
      'Entity Name': 'Amazon',
      Description: 'AWS', // wrong value
    });
    expect(match).toBeUndefined();
  });

  it('findMatchingRule should be case-insensitive and trim whitespace', async () => {
    await service.addRule({
      conditions: [{ field: 'Description', value: 'Netflix' }],
      targetLabel: 'Entertainment',
      priority: 1,
    });

    const match = await service.findMatchingRule({
      Description: '  NETFLIX  ',
    });
    expect(match?.targetLabel).toBe('Entertainment');
  });

  it('findMatchingRule should return the highest-priority match', async () => {
    await service.addRule({
      conditions: [{ field: 'Description', value: 'Transfer' }],
      targetLabel: 'LowPriority',
      priority: 1,
    });
    await service.addRule({
      conditions: [{ field: 'Description', value: 'Transfer' }],
      targetLabel: 'HighPriority',
      priority: 99,
    });

    const match = await service.findMatchingRule({ Description: 'Transfer' });
    expect(match?.targetLabel).toBe('HighPriority');
  });

  it('findMatchingRule should return undefined when no rules match', async () => {
    const match = await service.findMatchingRule({ Description: 'Unknown' });
    expect(match).toBeUndefined();
  });
});