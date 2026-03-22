import { ICanonicalEntity } from './canonical-entity.model';
import { IDialect } from './dialect.model';

/**
 * The matching tier at which a result was produced by the
 * multi-level matching pipeline.
 *
 * - `'exact'`      — direct string comparison against `originalDescription`.
 * - `'structural'` — comparison against the normalised `searchKey` (placeholders).
 * - `'similarity'` — Levenshtein-based fuzzy match on normalised strings (score ≥ 0.8).
 */
export type MatchLevel = 'exact' | 'structural' | 'similarity';

/**
 * The full evidence record returned by the three-tier matching pipeline.
 *
 * Carries enough information for the UI to explain *why* a match was
 * proposed and for Task 3.4 (rule evolution) to act on it.
 */
export interface MatchEvidence {
  /** The canonical entity the match resolves to. */
  entity: ICanonicalEntity;

  /** The specific dialect record that triggered the match. */
  dialect: IDialect;

  /** Which tier of the pipeline produced this match. */
  level: MatchLevel;

  /**
   * Confidence score in the range [0, 1].
   * - Exact and structural matches always return `1.0`.
   * - Similarity matches return the Levenshtein similarity score.
   */
  score: number;

  /**
   * The raw input value that was tested against the dialect pattern.
   * Useful for transparency UI and future rule-merging logic.
   */
  inputValue: string;

  /**
   * The dialect pattern the input was compared against.
   * For similarity matches this is the dialect's `pattern` field.
   */
  matchedPattern: string;
}