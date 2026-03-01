export interface IUserPreferences {
  /** When false (default), negative-amount rows are hidden in the Mapping tab. */
  showNegativeAmounts: boolean;
}

export const DEFAULT_USER_PREFERENCES: IUserPreferences = {
  showNegativeAmounts: false,
};