import { Injectable } from '@angular/core';
import {
  Token,
  TokenizedDescription,
  VariableKind,
} from '../models/tokenized-description.model';

/**
 * Describes a variable pattern to detect in a bank description string.
 * Patterns are applied in the order they are declared — more specific
 * patterns (e.g. dates, times) must come before more general ones (e.g.
 * standalone numbers) to avoid greedy mis-classification.
 */
interface VariablePattern {
  kind: VariableKind;
  /** Must NOT use the global (`g`) flag — matching is handled internally. */
  regex: RegExp;
}

/**
 * Ordered list of variable patterns.
 * The tokenizer scans the input string left-to-right; at each position it
 * tries these patterns in declaration order and uses the first one that
 * matches at that exact position.
 */
const VARIABLE_PATTERNS: VariablePattern[] = [
  // ── Dates ─────────────────────────────────────────────────────────────────
  // e.g.  01/03/2025  15-04-25  31.12
  {
    kind: 'date',
    regex: /\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?/,
  },

  // ── Times ─────────────────────────────────────────────────────────────────
  // e.g.  14:30  09:15:00
  {
    kind: 'time',
    regex: /\d{2}:\d{2}(:\d{2})?/,
  },

  // ── Sequential / Reference IDs ─────────────────────────────────────────────
  // Six or more consecutive digits that are unlikely to be a meaningful amount.
  // e.g.  123456  7890123456
  {
    kind: 'id',
    regex: /\d{6,}/,
  },

  // ── Other standalone numbers ──────────────────────────────────────────────
  // Any remaining digit sequence (1-5 digits), e.g. card terminal IDs.
  // e.g.  5765  42
  {
    kind: 'number',
    regex: /\d+/,
  },
];

// Pre-build a combined regex that can quickly locate the *next* variable token
// anywhere in the remaining string (used to split anchors efficiently).
const COMBINED_VARIABLE_REGEX = new RegExp(
  VARIABLE_PATTERNS.map((p) => `(?:${p.regex.source})`).join('|'),
  'g',
);

@Injectable({ providedIn: 'root' })
export class MovementTokenizerService {
  /**
   * Decompose a raw bank description string into an ordered list of anchor
   * and variable tokens, and generate a stable search key.
   *
   * The operation is **non-destructive**: `originalDescription` is stored
   * verbatim and never modified.
   *
   * @param description  Raw bank description string as read from the Excel file.
   */
  tokenize(description: string): TokenizedDescription {
    const tokens = this.extractTokens(description);
    const searchKey = this.buildSearchKey(tokens);
    return { originalDescription: description, tokens, searchKey };
  }

  /**
   * Convenience method: given a raw description, return only the search key.
   * Useful when the full token list is not needed (e.g. rule storage).
   */
  generateSearchKey(description: string): string {
    return this.tokenize(description).searchKey;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Walk the input string left-to-right, alternating between anchor segments
   * and the first variable pattern that matches at each variable position.
   */
  private extractTokens(input: string): Token[] {
    const tokens: Token[] = [];
    let cursor = 0;

    // Reset the global regex before each use.
    COMBINED_VARIABLE_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = COMBINED_VARIABLE_REGEX.exec(input)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;

      // Anchor: text between the previous variable end and this variable start.
      if (matchStart > cursor) {
        const anchorText = input.slice(cursor, matchStart).trim();
        if (anchorText) {
          tokens.push({ type: 'anchor', value: anchorText });
        }
      }

      // Variable: classify with the most specific pattern.
      const variableKind = this.classifyVariable(match[0]);
      tokens.push({ type: 'variable', value: match[0], variableKind });

      cursor = matchEnd;
    }

    // Trailing anchor after the last variable (or the entire string if no
    // variables were found).
    if (cursor < input.length) {
      const trailing = input.slice(cursor).trim();
      if (trailing) {
        tokens.push({ type: 'anchor', value: trailing });
      }
    }

    return tokens;
  }

  /**
   * Identify which `VariableKind` best describes the matched text by testing
   * the specific patterns in their declared priority order.
   */
  private classifyVariable(text: string): VariableKind {
    for (const { kind, regex } of VARIABLE_PATTERNS) {
      // Anchor the test to the full string so a partial match doesn't count.
      const anchored = new RegExp(`^(?:${regex.source})$`);
      if (anchored.test(text)) return kind;
    }
    // Fallback — should not be reached given the combined regex construction.
    return 'number';
  }

  /**
   * Build the normalised search key from the token list.
   * - Anchor tokens are lowercased and their whitespace is collapsed.
   * - Variable tokens become `{kind}` placeholders.
   * - Individual token values are joined with a single space and the result
   *   is trimmed.
   */
  private buildSearchKey(tokens: Token[]): string {
    const parts = tokens.map((token) => {
      if (token.type === 'variable') {
        return `{${token.variableKind}}`;
      }
      // Normalise anchor text: lowercase + collapse internal whitespace.
      return token.value.toLowerCase().replace(/\s+/g, ' ').trim();
    });

    return parts
      .filter((p) => p.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}