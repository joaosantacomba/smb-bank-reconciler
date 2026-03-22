import { MovementTokenizerService } from './movement-tokenizer.service';
import { Token } from '../models/tokenized-description.model';

describe('MovementTokenizerService', () => {
  let service: MovementTokenizerService;

  beforeEach(() => {
    service = new MovementTokenizerService();
  });

  // ── tokenize(): originalDescription preservation ─────────────────────────

  describe('originalDescription', () => {
    it('should preserve the exact input string verbatim', () => {
      const input = '  TRF 01/03 CONTINENTE 123456  ';
      const result = service.tokenize(input);
      expect(result.originalDescription).toBe(input);
    });

    it('should preserve special characters and casing without modification', () => {
      const input = 'PAG/REC Nº 987654 EDP COMERCIAL S.A.';
      expect(service.tokenize(input).originalDescription).toBe(input);
    });
  });

  // ── Token extraction ──────────────────────────────────────────────────────

  describe('token extraction', () => {
    it('should return a single anchor token for a pure-text description', () => {
      const result = service.tokenize('SALARIO EMPRESA XYZ');
      expect(result.tokens).toEqual<Token[]>([
        { type: 'anchor', value: 'SALARIO EMPRESA XYZ' },
      ]);
    });

    it('should classify DD/MM as a date variable', () => {
      const result = service.tokenize('TRF 01/03 NOME');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken).toEqual<Token>({ type: 'variable', value: '01/03', variableKind: 'date' });
    });

    it('should classify DD-MM-YYYY as a date variable', () => {
      const result = service.tokenize('TRF 15-04-2025 NOME');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('date');
      expect(varToken?.value).toBe('15-04-2025');
    });

    it('should classify DD.MM.YY as a date variable', () => {
      const result = service.tokenize('TRF 31.12.25 NOME');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('date');
    });

    it('should classify HH:MM as a time variable', () => {
      const result = service.tokenize('COMPRA PINGO DOCE 14:30');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken).toEqual<Token>({ type: 'variable', value: '14:30', variableKind: 'time' });
    });

    it('should classify HH:MM:SS as a time variable', () => {
      const result = service.tokenize('COMPRA PINGO DOCE 09:15:00');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('time');
      expect(varToken?.value).toBe('09:15:00');
    });

    it('should classify 6+ digit sequences as id variables', () => {
      const result = service.tokenize('TRF NOME 123456');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken).toEqual<Token>({ type: 'variable', value: '123456', variableKind: 'id' });
    });

    it('should classify a 10-digit sequence as an id variable', () => {
      const result = service.tokenize('REF 9876543210 BANCO');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('id');
    });

    it('should classify 1–5 digit sequences as number variables', () => {
      const result = service.tokenize('COMPRA 5765 PINGO DOCE');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken).toEqual<Token>({ type: 'variable', value: '5765', variableKind: 'number' });
    });

    it('should classify a single digit as a number variable', () => {
      const result = service.tokenize('LOJA 3 PORTO');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('number');
    });
  });

  // ── Token sequence ordering ───────────────────────────────────────────────

  describe('token sequence', () => {
    it('should produce interleaved anchor-variable-anchor tokens', () => {
      const result = service.tokenize('TRF 01/03 CONTINENTE FEIRA NOVA 123456');
      expect(result.tokens).toEqual<Token[]>([
        { type: 'anchor', value: 'TRF' },
        { type: 'variable', value: '01/03', variableKind: 'date' },
        { type: 'anchor', value: 'CONTINENTE FEIRA NOVA' },
        { type: 'variable', value: '123456', variableKind: 'id' },
      ]);
    });

    it('should handle a description with leading variable', () => {
      const result = service.tokenize('123456 PAGAMENTO RENDA');
      expect(result.tokens[0]).toEqual<Token>({
        type: 'variable',
        value: '123456',
        variableKind: 'id',
      });
      expect(result.tokens[1]).toEqual<Token>({
        type: 'anchor',
        value: 'PAGAMENTO RENDA',
      });
    });

    it('should handle a description with trailing variable only', () => {
      const result = service.tokenize('SALARIO EMPRESA 789012');
      expect(result.tokens).toEqual<Token[]>([
        { type: 'anchor', value: 'SALARIO EMPRESA' },
        { type: 'variable', value: '789012', variableKind: 'id' },
      ]);
    });

    it('should produce two date tokens for a date-range description', () => {
      const result = service.tokenize('TRF 01/03 A 15/03 RENDA');
      const varTokens = result.tokens.filter((t) => t.type === 'variable');
      expect(varTokens).toHaveLength(2);
      expect(varTokens[0].variableKind).toBe('date');
      expect(varTokens[1].variableKind).toBe('date');
    });

    it('should handle multiple variable types in one description', () => {
      const result = service.tokenize('COMPRA 5765 PINGO DOCE PORTO 14:30');
      const varTokens = result.tokens.filter((t) => t.type === 'variable');
      expect(varTokens[0]).toEqual<Token>({
        type: 'variable',
        value: '5765',
        variableKind: 'number',
      });
      expect(varTokens[1]).toEqual<Token>({
        type: 'variable',
        value: '14:30',
        variableKind: 'time',
      });
    });

    it('should not emit empty anchor tokens for adjacent variables', () => {
      // Two sequential numbers with only whitespace between them.
      const result = service.tokenize('REF 001 123456789');
      const anchors = result.tokens.filter((t) => t.type === 'anchor');
      anchors.forEach((a) => expect(a.value.trim()).not.toBe(''));
    });
  });

  // ── Search key generation ─────────────────────────────────────────────────

  describe('searchKey', () => {
    it('should lowercase the entire search key', () => {
      const result = service.tokenize('TRF CONTINENTE');
      expect(result.searchKey).toBe('trf continente');
    });

    it('should replace date variables with {date} placeholder', () => {
      const result = service.tokenize('TRF 01/03 CONTINENTE');
      expect(result.searchKey).toBe('trf {date} continente');
    });

    it('should replace time variables with {time} placeholder', () => {
      const result = service.tokenize('COMPRA PINGO DOCE 14:30');
      expect(result.searchKey).toBe('compra pingo doce {time}');
    });

    it('should replace id variables with {id} placeholder', () => {
      const result = service.tokenize('TRF NOME 123456');
      expect(result.searchKey).toBe('trf nome {id}');
    });

    it('should replace number variables with {number} placeholder', () => {
      const result = service.tokenize('COMPRA 5765 PINGO DOCE');
      expect(result.searchKey).toBe('compra {number} pingo doce');
    });

    it('should produce the correct key for a full real-world example', () => {
      const result = service.tokenize('TRF 01/03 CONTINENTE FEIRA NOVA 123456');
      expect(result.searchKey).toBe('trf {date} continente feira nova {id}');
    });

    it('should produce the correct key for a card purchase with terminal and time', () => {
      const result = service.tokenize('COMPRA 5765 PINGO DOCE PORTO 14:30');
      expect(result.searchKey).toBe('compra {number} pingo doce porto {time}');
    });

    it('should produce the correct key for a service payment with ID', () => {
      const result = service.tokenize('PAG SERV 12345 EDP COMERCIAL');
      expect(result.searchKey).toBe('pag serv {number} edp comercial');
    });

    it('should return the lowercased text unchanged when no variables are present', () => {
      const result = service.tokenize('SALARIO EMPRESA XYZ');
      expect(result.searchKey).toBe('salario empresa xyz');
    });

    it('should handle two date placeholders for a date range', () => {
      const result = service.tokenize('TRF 01/03 A 15/03 RENDA');
      expect(result.searchKey).toBe('trf {date} a {date} renda');
    });

    it('should collapse multiple spaces in anchor text', () => {
      const result = service.tokenize('TRF   CONTINENTE   PORTO');
      expect(result.searchKey).toBe('trf continente porto');
    });

    it('should trim leading and trailing whitespace from the key', () => {
      const result = service.tokenize('  SALARIO EMPRESA  ');
      expect(result.searchKey).toBe('salario empresa');
    });

    it('should produce identical search keys for two semantically equivalent descriptions', () => {
      const key1 = service.generateSearchKey('TRF 01/03 CONTINENTE FEIRA NOVA 123456');
      const key2 = service.generateSearchKey('TRF 15/04 CONTINENTE FEIRA NOVA 789012');
      expect(key1).toBe(key2);
    });

    it('should produce identical search keys regardless of the specific ID value', () => {
      const key1 = service.generateSearchKey('PAGAMENTO REF 100001');
      const key2 = service.generateSearchKey('PAGAMENTO REF 999999');
      expect(key1).toBe(key2);
    });
  });

  // ── generateSearchKey() convenience method ────────────────────────────────

  describe('generateSearchKey()', () => {
    it('should return the same value as tokenize().searchKey', () => {
      const input = 'TRF 01/03 CONTINENTE 987654';
      expect(service.generateSearchKey(input)).toBe(service.tokenize(input).searchKey);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle an empty string without throwing', () => {
      const result = service.tokenize('');
      expect(result.tokens).toEqual([]);
      expect(result.searchKey).toBe('');
      expect(result.originalDescription).toBe('');
    });

    it('should handle a whitespace-only string without throwing', () => {
      const result = service.tokenize('   ');
      expect(result.tokens).toEqual([]);
      expect(result.searchKey).toBe('');
    });

    it('should handle a string that is purely a number', () => {
      const result = service.tokenize('123456');
      expect(result.tokens).toHaveLength(1);
      expect(result.tokens[0]).toEqual<Token>({
        type: 'variable',
        value: '123456',
        variableKind: 'id',
      });
      expect(result.searchKey).toBe('{id}');
    });

    it('should not mutate the original description across multiple calls', () => {
      const input = 'TRF 01/03 BANCO';
      service.tokenize(input);
      const result2 = service.tokenize(input);
      expect(result2.originalDescription).toBe(input);
    });

    it('should handle Portuguese special characters in anchors', () => {
      const result = service.tokenize('PAGAMENTO ÁGUA 123456');
      const anchor = result.tokens.find((t) => t.type === 'anchor' && t.value.includes('GUA'));
      expect(anchor).toBeDefined();
      expect(result.searchKey).toContain('{id}');
    });

    it('should handle descriptions with dots as date separators', () => {
      const result = service.tokenize('TRF 01.03.2025 RENDA');
      const varToken = result.tokens.find((t) => t.type === 'variable');
      expect(varToken?.variableKind).toBe('date');
    });
  });
});