/** The kind of variable pattern detected in a bank description token. */
export type VariableKind = 'date' | 'time' | 'id' | 'number';

/** A single segment of a tokenized bank description string. */
export interface Token {
  /** Whether this segment is stable/identifying text or a variable portion. */
  type: 'anchor' | 'variable';
  /** The original text value of this token as it appeared in the input. */
  value: string;
  /** Only present when type === 'variable'. Describes what kind of variable this is. */
  variableKind?: VariableKind;
}

/**
 * The result of decomposing a raw bank description string.
 * Designed to be non-destructive: the original string is always preserved.
 */
export interface TokenizedDescription {
  /**
   * The verbatim original description string, preserved exactly as received.
   * Must never be modified—used for auditing and future invoice matching.
   */
  originalDescription: string;

  /**
   * The ordered sequence of tokens (anchors and variables) extracted from
   * the description.
   */
  tokens: Token[];

  /**
   * A stable, normalised pattern string derived from the tokens.
   * Variables are replaced with typed placeholders (e.g. `{date}`, `{id}`).
   * Used as the lookup key for structural rule matching.
   *
   * Example:
   *   "TRF 01/03 CONTINENTE 123456" → "trf {date} continente {id}"
   */
  searchKey: string;
}