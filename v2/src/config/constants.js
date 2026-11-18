export const BUCKETS = ['needs', 'wants', 'savings'];

export const BUCKET_LABELS = {
  needs: 'Needs',
  wants: 'Wants',
  savings: 'Savings & Investments',
};

export const DEFAULT_SPLIT = { needs: 50, wants: 30, savings: 20 };

export const EXPENSE_CATEGORIES = {
  Housing: 'needs',
  Groceries: 'needs',
  Utilities: 'needs',
  Transportation: 'needs',
  Health: 'needs',
  Insurance: 'needs',
  'Debt & Loans': 'needs',
  Education: 'needs',
  'Dining Out': 'wants',
  Entertainment: 'wants',
  Shopping: 'wants',
  Travel: 'wants',
  'Personal Care': 'wants',
  Subscriptions: 'wants',
  Miscellaneous: 'wants',
  'Savings & Invest': 'savings',
  'Emergency Fund': 'savings',
  'Extra Loan Prepayment': 'savings',
};

export const INCOME_CATEGORIES = ['Salary', 'Bonus', 'Freelance', 'Gift', 'Interest', 'Other'];

export const FREQUENCIES = ['monthly', 'yearly'];

export const MAX_HOUSEHOLD_MEMBERS = 6;

export const TABLES = [
  'household_members',
  'transactions',
  'recurring_items',
  'goals',
  'goal_contributions',
  'budget_settings',
  'loans',
];
