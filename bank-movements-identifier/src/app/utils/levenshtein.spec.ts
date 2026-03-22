import {
  levenshteinDistance,
  levenshteinSimilarity,
  normalizeForSimilarity,
} from './levenshtein';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('abc', 'abc')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('returns the length of the other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('counts a single substitution', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
  });

  it('counts a single insertion', () => {
    expect(levenshteinDistance('abc', 'abcd')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(levenshteinDistance('abcd', 'abc')).toBe(1);
  });

  it('handles the classic kitten → sitting example (distance 3)', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('is symmetric (distance(a,b) === distance(b,a))', () => {
    expect(levenshteinDistance('sunday', 'saturday')).toBe(
      levenshteinDistance('saturday', 'sunday'),
    );
  });

  it('handles strings with different lengths (no common chars)', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('netflix', 'netflix')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1);
  });

  it('returns 0 when one string is empty and the other is not', () => {
    // distance = len(other), max = len(other) → 1 - 1 = 0
    expect(levenshteinSimilarity('', 'abc')).toBe(0);
  });

  it('returns a value in [0, 1]', () => {
    const score = levenshteinSimilarity('continente', 'CONTINENTE SA');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns a high score for very similar strings', () => {
    // "CONTINENTE LDA" vs "CONTINENTE SA" — only 3 chars differ
    const score = levenshteinSimilarity('CONTINENTE LDA', 'CONTINENTE SA');
    expect(score).toBeGreaterThan(0.7);
  });

  it('returns a low score for unrelated strings', () => {
    const score = levenshteinSimilarity('netflix', 'continente');
    expect(score).toBeLessThan(0.5);
  });

  it('meets the 0.8 threshold for near-duplicate bank strings', () => {
    // "compra continente" vs "compra continente sa" — 3 extra chars
    const score = levenshteinSimilarity('compra continente', 'compra continente sa');
    expect(score).toBeGreaterThanOrEqual(0.8);
  });
});

describe('normalizeForSimilarity', () => {
  it('lowercases the input', () => {
    expect(normalizeForSimilarity('CONTINENTE')).toBe('continente');
  });

  it('removes date patterns DD/MM', () => {
    expect(normalizeForSimilarity('TRF 01/03 CONTINENTE')).toBe('trf continente');
  });

  it('removes date patterns with year DD/MM/YYYY', () => {
    expect(normalizeForSimilarity('TRF 01/03/2025 CONTINENTE')).toBe('trf continente');
  });

  it('removes time patterns HH:MM', () => {
    expect(normalizeForSimilarity('COMPRA 14:30 NETFLIX')).toBe('compra netflix');
  });

  it('removes sequences of 6 or more digits', () => {
    expect(normalizeForSimilarity('TRF CONTINENTE 123456789')).toBe('trf continente');
  });

  it('does NOT remove short digit sequences (fewer than 6 digits)', () => {
    const result = normalizeForSimilarity('TERMINAL 1234');
    expect(result).toContain('1234');
  });

  it('collapses multiple spaces into one', () => {
    const result = normalizeForSimilarity('TRF   01/03   CONTINENTE');
    expect(result).toBe('trf continente');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeForSimilarity('  continente  ')).toBe('continente');
  });

  it('produces the same output for two descriptions that differ only in date/ID', () => {
    const a = normalizeForSimilarity('TRF 01/03 CONTINENTE 123456');
    const b = normalizeForSimilarity('TRF 15/07 CONTINENTE 987654');
    expect(a).toBe(b);
  });
});