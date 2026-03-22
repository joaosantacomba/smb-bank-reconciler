/**
 * A Canonical Entity represents the normalised, user-facing name for a
 * real-world payee or counterparty (e.g. "Continente", "Netflix", "Amazon").
 *
 * Multiple bank string patterns (Dialects) can point to the same Canonical
 * Entity, allowing the system to recognise different "dialects" of the same
 * entity across different bank exports or time periods.
 */
export interface ICanonicalEntity {
  /** Auto-incremented primary key managed by Dexie. */
  id?: number;

  /**
   * The normalised display name for the entity.
   * Stored in the user's preferred casing and treated as unique
   * (case-insensitive) by the persistence layer.
   *
   * Examples: "Continente", "Netflix", "Amazon Web Services"
   */
  name: string;

  /** Unix epoch timestamp (ms) when the entity was first created. */
  createdAt: number;

  /** Unix epoch timestamp (ms) when the entity was last modified. */
  updatedAt: number;
}