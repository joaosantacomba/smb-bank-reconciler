import { ExcelParserService } from './excel-parser.service';

describe('ExcelParserService', () => {
  let service: ExcelParserService;

  beforeEach(() => {
    service = new ExcelParserService();
  });

  // -------------------------------------------------------------------------
  // isDateLike
  // -------------------------------------------------------------------------
  describe('isDateLike', () => {
    it('should return true for DD/MM/YYYY', () => {
      expect(service.isDateLike('25/02/2026')).toBe(true);
    });

    it('should return true for YYYY-MM-DD', () => {
      expect(service.isDateLike('2026-02-25')).toBe(true);
    });

    it('should return true for D.M.YY', () => {
      expect(service.isDateLike('5.2.26')).toBe(true);
    });

    it('should return true for M/D/YYYY', () => {
      expect(service.isDateLike('2/25/2026')).toBe(true);
    });

    it('should return false for a plain number string', () => {
      expect(service.isDateLike('1250.50')).toBe(false);
    });

    it('should return false for a text label', () => {
      expect(service.isDateLike('Date')).toBe(false);
    });

    it('should return false for null / undefined', () => {
      expect(service.isDateLike(null)).toBe(false);
      expect(service.isDateLike(undefined)).toBe(false);
    });

    it('should return false for a number type', () => {
      expect(service.isDateLike(20260225)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isTextOnly
  // -------------------------------------------------------------------------
  describe('isTextOnly', () => {
    it('should return true for a plain text label', () => {
      expect(service.isTextOnly('Description')).toBe(true);
    });

    it('should return false for a numeric string', () => {
      expect(service.isTextOnly('1250.50')).toBe(false);
    });

    it('should return false for a date-like string', () => {
      expect(service.isTextOnly('25/02/2026')).toBe(false);
    });

    it('should return false for null / undefined', () => {
      expect(service.isTextOnly(null)).toBe(false);
      expect(service.isTextOnly(undefined)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // parseLocalizedNumber
  // -------------------------------------------------------------------------
  describe('parseLocalizedNumber', () => {
    it('should parse European format 1.250,50', () => {
      expect(service.parseLocalizedNumber('1.250,50')).toBeCloseTo(1250.5);
    });

    it('should parse US format 1,250.50', () => {
      expect(service.parseLocalizedNumber('1,250.50')).toBeCloseTo(1250.5);
    });

    it('should parse simple comma decimal 1250,50', () => {
      expect(service.parseLocalizedNumber('1250,50')).toBeCloseTo(1250.5);
    });

    it('should pass through a number type unchanged', () => {
      expect(service.parseLocalizedNumber(42)).toBe(42);
    });

    it('should return NaN for non-numeric text', () => {
      expect(service.parseLocalizedNumber('Description')).toBeNaN();
    });
  });

  // -------------------------------------------------------------------------
  // isLikelyMovement
  // -------------------------------------------------------------------------
  describe('isLikelyMovement', () => {
    it('should return true for a typical movement row', () => {
      const row = ['01/02/2026', 'Payment to Supplier XYZ', '-1.250,50', ''];
      expect(service.isLikelyMovement(row)).toBe(true);
    });

    it('should return false for an empty row', () => {
      expect(service.isLikelyMovement([])).toBe(false);
    });

    it('should return false for a row with fewer than 3 non-empty cells', () => {
      const row = ['01/02/2026', '', ''];
      expect(service.isLikelyMovement(row)).toBe(false);
    });

    it('should return false for a row without a date-like cell', () => {
      const row = ['Payment to Supplier', 'Reference 123', '-1250.50'];
      expect(service.isLikelyMovement(row)).toBe(false);
    });

    it('should return false for a row without a numeric cell', () => {
      const row = ['01/02/2026', 'Payment to Supplier', 'Reference 123'];
      expect(service.isLikelyMovement(row)).toBe(false);
    });

    it('should return false for a null row', () => {
      expect(service.isLikelyMovement(null as any)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // detectHeaderRow
  // -------------------------------------------------------------------------
  describe('detectHeaderRow', () => {
    it('should detect header via H2 (transition before movement rows)', () => {
      const data = [
        ['Bank Name', 'Account: 12345'],          // 0 – metadata
        ['IBAN: PT50 0000 0000'],                  // 1 – metadata
        ['Date', 'Description', 'Amount'],         // 2 – header (H2: row before 3 movements)
        ['01/02/2026', 'Salary', '2000.00'],       // 3 – movement
        ['02/02/2026', 'Rent payment', '-800.00'], // 4 – movement
        ['03/02/2026', 'Groceries', '-120.50'],    // 5 – movement
      ];
      expect(service.detectHeaderRow(data)).toBe(2);
    });

    it('should fall back to H1 (first all-text row) when no clear transition', () => {
      const data = [
        ['Bank Statement 2026'],                    // 0 – metadata (single cell, not ≥2)
        ['Date', 'Description', 'Amount'],          // 1 – header (H1: first all-text row ≥2 cells)
        ['01/02/2026', 'Salary', '2000.00'],        // 2 – movement
        ['02/02/2026', 'Rent', '-800.00'],          // 3 – movement
      ];
      expect(service.detectHeaderRow(data)).toBe(1);
    });

    it('should return 0 when data starts directly with movements', () => {
      const data = [
        ['01/02/2026', 'Salary', '2000.00'],
        ['02/02/2026', 'Rent', '-800.00'],
        ['03/02/2026', 'Groceries', '-120.50'],
        ['04/02/2026', 'Utilities', '-60.00'],
      ];
      expect(service.detectHeaderRow(data)).toBe(0);
    });

    it('should prefer H2 over H1 when both match', () => {
      // H1 would find row 0 (all text, ≥2 cells).
      // H2 finds row 1 (before 3 consecutive movements starting at row 2).
      const data = [
        ['Date', 'Description'],                   // 0 – matches H1 (all-string, ≥2 cells)
        ['Period', 'Jan 2026', 'EUR'],             // 1 – matches H2 (before 3 movements)
        ['01/02/2026', 'Salary', '2000.00'],
        ['02/02/2026', 'Rent', '-800.00'],
        ['03/02/2026', 'Groceries', '-120.50'],
      ];
      expect(service.detectHeaderRow(data)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // classifyRows
  // -------------------------------------------------------------------------
  describe('classifyRows', () => {
    const sampleData = [
      ['Bank Name', 'My Bank'],                    // 0 – metadata
      ['Date', 'Description', 'Amount'],           // 1 – header
      ['01/02/2026', 'Salary', '2000.00'],         // 2 – movement
      ['02/02/2026', 'Rent payment', '-800.00'],   // 3 – movement
      ['', '', ''],                                // 4 – excluded (empty)
      ['03/02/2026', 'Groceries', '-120.50'],      // 5 – movement
      ['Total', '-800.00'],                        // 6 – excluded (too few cells / no date)
    ];

    it('should use detectHeaderRow when no override is given', () => {
      const result = service.classifyRows(sampleData);
      expect(result.suggestedHeaderIndex).toBe(1);
    });

    it('should respect an explicit headerIndex override', () => {
      const result = service.classifyRows(sampleData, 0);
      expect(result.suggestedHeaderIndex).toBe(0);
    });

    it('should populate metadata with rows above the header', () => {
      const result = service.classifyRows(sampleData);
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0]).toEqual(['Bank Name', 'My Bank']);
    });

    it('should correctly extract header values', () => {
      const result = service.classifyRows(sampleData);
      expect(result.headers).toEqual(['Date', 'Description', 'Amount']);
    });

    it('should identify movement rows', () => {
      const result = service.classifyRows(sampleData);
      expect(result.movements).toHaveLength(3);
    });

    it('should exclude empty rows with reason "empty row"', () => {
      const result = service.classifyRows(sampleData);
      const emptyExclusions = result.excluded.filter((e) => e.reason === 'empty row');
      expect(emptyExclusions).toHaveLength(1);
    });

    it('should include rawData unchanged', () => {
      const result = service.classifyRows(sampleData);
      expect(result.rawData).toBe(sampleData);
    });

    it('should handle an entirely empty dataset', () => {
      const result = service.classifyRows([]);
      expect(result.movements).toHaveLength(0);
      expect(result.metadata).toHaveLength(0);
      expect(result.excluded).toHaveLength(0);
      expect(result.headers).toHaveLength(0);
    });
  });
});