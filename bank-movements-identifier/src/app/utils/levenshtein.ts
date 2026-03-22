/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic dynamic-programming approach with O(min(m,n)) space.
 *
 * @param a First string.
 * @param b Second string.
 * @returns The minimum number of single-character edits (insert, delete,
 *          substitute) required to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure `a` is the shorter string so we only allocate a small row.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // prev[j] = distance between a[0..i-1] and b[0..j-1]
  let prev = Array.from({ length: aLen + 1 }, (_, i) => i);
  let curr = new Array<number>(aLen + 1);

  for (let j = 1; j <= bLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,      // deletion
        curr[i - 1] + 1,  // insertion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Compute the normalised Levenshtein similarity score between two strings.
 *
 * $$S(A, B) = 1 - \frac{\text{dist\_levenshtein}(A, B)}{\max(|A|, |B|)}$$
 *
 * Returns a value in `[0, 1]` where `1` means identical and `0` means
 * completely dissimilar. Returns `1` for two empty strings.
 *
 * @param a First string.
 * @param b Second string.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Normalise a bank description string for similarity comparison.
 *
 * Strips the variable segments that the tokenizer would replace with
 * placeholders (dates, sequential IDs) so that two descriptions from the
 * same merchant are not penalised for different transaction dates/IDs.
 *
 * Steps applied in order:
 * 1. Lowercase.
 * 2. Remove date-like patterns: `DD/MM`, `DD-MM`, `DD.MM` (with optional year).
 * 3. Remove time-like patterns: `HH:MM` (with optional `:SS`).
 * 4. Remove sequences of 6 or more digits (reference/transaction IDs).
 * 5. Collapse remaining whitespace.
 * 6. Trim.
 *
 * @param value Raw bank description string.
 * @returns Normalised string suitable for Levenshtein comparison.
 */
export function normalizeForSimilarity(value: string): string {
  return value
    .toLowerCase()
    // Remove full dates with optional year: 01/03/2025, 15-04-25, 31.12
    .replace(/\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?/g, '')
    // Remove time patterns: 14:30  09:15:00
    .replace(/\d{2}:\d{2}(:\d{2})?/g, '')
    // Remove long digit sequences (IDs ≥ 6 digits)
    .replace(/\d{6,}/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}