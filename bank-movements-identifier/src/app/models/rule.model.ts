export interface IRuleCondition {
  field: string;
  value: string;
}

export interface IRule {
  id?: number;
  conditions: IRuleCondition[];
  targetLabel: string;
  priority: number;
}