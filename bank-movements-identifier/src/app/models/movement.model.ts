/**
 * A persisted movement record, written to the IndexedDB "movements" table
 * when the user saves labeled rows to history.
 *
 * Each record represents a single bank transaction that has been reconciled
 * (i.e., assigned a canonical entity label by the user).
 */
export interface IMovement {
  /** Auto-incremented primary key managed by Dexie. */
  id?: number;

  /**
   * Original date string as it appeared in the bank file.
   * Stored as-is to preserve the source format.
   */
  date: string;

  /**
   * Full description text. When multiple description columns were mapped,
   * they are joined with a pipe separator: "Col A | Col B".
   */
  description: string;

  /**
   * Parsed numeric amount. Positive = credit, negative = debit.
   * Stored as a number for sorting and arithmetic in future views.
   */
  amount: number;

  /**
   * Canonical entity name at the time of saving.
   * Reflects whatever label the user assigned in the Mapping tab.
   */
  entity: string;

  /**
   * Optional category tag (reserved for future use).
   * Not yet assigned by the UI but included in the schema for forward
   * compatibility.
   */
  category?: string;

  /**
   * Unix epoch timestamp (ms) when this movement was saved to history.
   * Used for ordering and audit purposes.
   */
  reconciledAt: number;
}