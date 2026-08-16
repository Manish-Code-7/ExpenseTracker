/**
 * The financial rules engine.
 *
 * Every question of the form "does this move money, and where?" is answered
 * here and nowhere else. Deliberately pure — no database, no framework — so
 * the accounting invariants can be tested directly.
 *
 * ── The one modelling decision everything follows from ────────────────────
 *
 * Each account carries a single SIGNED balance: assets positive, liabilities
 * negative. A credit card with ₹18,000 owed has a balance of -18000, and its
 * "outstanding" is just the negation.
 *
 * That choice makes every transaction type reduce to the same shape — move
 * `amount` out of one account and into another — and makes net worth a plain
 * sum. Transfers, withdrawals and card payments then net to zero *by
 * construction* rather than by remembering to exclude them.
 */

export const TRANSACTION_TYPES = [
  "EXPENSE",
  "INCOME",
  "TRANSFER",
  "CASH_WITHDRAWAL",
  "CREDIT_CARD_PAYMENT",
  "REFUND",
  "ADJUSTMENT",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_TYPES = [
  "BANK",
  "CREDIT_CARD",
  "CASH",
  "OTHER_ASSET",
  "OTHER_LIABILITY",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** How the money moved, never *whether* it was spent. */
export const PAYMENT_METHODS = [
  "UPI",
  "CASH",
  "DEBIT_CARD",
  "CREDIT_CARD",
  "BANK_TRANSFER",
  "ATM",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const LIABILITY_TYPES: readonly AccountType[] = [
  "CREDIT_CARD",
  "OTHER_LIABILITY",
];

export function isLiability(type: AccountType) {
  return LIABILITY_TYPES.includes(type);
}

/** Owed amount for a liability; assets report 0. */
export function outstandingOf(type: AccountType, balance: number) {
  return isLiability(type) ? Math.max(0, -balance) : 0;
}

/* --- what each type means ------------------------------------------------ */

type Shape = {
  /** Money leaves this side. */
  source: "required" | "forbidden";
  /** Money arrives here. */
  destination: "required" | "forbidden";
  /** Counts toward spending analytics and budgets. */
  spending: "adds" | "reduces" | "none";
  /** Counts toward income analytics. */
  income: boolean;
  label: string;
};

export const RULES: Record<TransactionType, Shape> = {
  // Actual consumption. The only type that adds to spend.
  EXPENSE: {
    source: "required",
    destination: "forbidden",
    spending: "adds",
    income: false,
    label: "Expense",
  },
  // External money entering the user's world.
  INCOME: {
    source: "forbidden",
    destination: "required",
    spending: "none",
    income: true,
    label: "Income",
  },
  // The user's own money, relocated. Never spending.
  TRANSFER: {
    source: "required",
    destination: "required",
    spending: "none",
    income: false,
    label: "Transfer",
  },
  // A transfer whose destination happens to be cash.
  CASH_WITHDRAWAL: {
    source: "required",
    destination: "required",
    spending: "none",
    income: false,
    label: "Cash Withdrawal",
  },
  // Settling a liability already recorded as spend at purchase time.
  CREDIT_CARD_PAYMENT: {
    source: "required",
    destination: "required",
    spending: "none",
    income: false,
    label: "Credit Card Payment",
  },
  // Money coming back from a merchant; reduces net spend, is not income.
  REFUND: {
    source: "forbidden",
    destination: "required",
    spending: "reduces",
    income: false,
    label: "Refund",
  },
  // Reconciliation against reality. Moves a balance, is never spend.
  ADJUSTMENT: {
    source: "forbidden",
    destination: "required",
    spending: "none",
    income: false,
    label: "Adjustment",
  },
};

export const typeLabel = (t: TransactionType) => RULES[t].label;

/* --- the three questions analytics asks ---------------------------------- */

/** Signed contribution to *net* spending: expenses add, refunds subtract. */
export function spendingDelta(type: TransactionType, amount: number): number {
  const rule = RULES[type].spending;
  if (rule === "adds") return amount;
  if (rule === "reduces") return -amount;
  return 0;
}

export function isIncome(type: TransactionType) {
  return RULES[type].income;
}

/** True for the internal movements that must never reach expense analytics. */
export function isInternalMovement(type: TransactionType) {
  return (
    type === "TRANSFER" ||
    type === "CASH_WITHDRAWAL" ||
    type === "CREDIT_CARD_PAYMENT" ||
    type === "ADJUSTMENT"
  );
}

/* --- balance effects ------------------------------------------------------ */

export type Movement = { accountId: string; delta: number };

export type TransactionShape = {
  type: TransactionType;
  amount: number;
  source_account_id?: string | null;
  destination_account_id?: string | null;
};

/**
 * Which balances move, and by how much.
 *
 * Because balances are signed, this is uniform: `amount` leaves the source and
 * arrives at the destination. A credit-card purchase "leaves" the card, making
 * its balance more negative — i.e. more owed — with no special case.
 *
 * ADJUSTMENT is the exception: its amount is a signed correction applied to one
 * account, not a movement between two.
 */
export function movementsFor(txn: TransactionShape): Movement[] {
  if (txn.type === "ADJUSTMENT") {
    return txn.destination_account_id
      ? [{ accountId: txn.destination_account_id, delta: txn.amount }]
      : [];
  }

  const movements: Movement[] = [];
  if (txn.source_account_id) {
    movements.push({ accountId: txn.source_account_id, delta: -txn.amount });
  }
  if (txn.destination_account_id) {
    movements.push({ accountId: txn.destination_account_id, delta: txn.amount });
  }
  return movements;
}

/** Reversing a transaction is applying its movements backwards. */
export function reverseMovements(txn: TransactionShape): Movement[] {
  return movementsFor(txn).map((m) => ({ ...m, delta: -m.delta }));
}

/**
 * Net worth is the plain sum of signed balances, which is exactly why
 * transfers, withdrawals and card payments leave it untouched.
 */
export function netWorth(accounts: { balance: number }[]) {
  return round2(accounts.reduce((total, a) => total + a.balance, 0));
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/* --- validation ----------------------------------------------------------- */

export type ValidationInput = TransactionShape & {
  accounts: Map<string, { id: string; type: AccountType; user_id: string }>;
  userId: string;
};

/**
 * The backend's final say. The AI proposes; this disposes.
 *
 * Returns a human-readable message, or null when the transaction is sound.
 */
export function validateTransaction(input: ValidationInput): string | null {
  const rule = RULES[input.type];
  if (!rule) return "Unknown transaction type.";

  if (input.type !== "ADJUSTMENT" && !(input.amount > 0)) {
    return "Amount must be greater than zero.";
  }
  if (input.type === "ADJUSTMENT" && input.amount === 0) {
    return "An adjustment of zero would change nothing.";
  }

  const source = input.source_account_id
    ? input.accounts.get(input.source_account_id)
    : null;
  const destination = input.destination_account_id
    ? input.accounts.get(input.destination_account_id)
    : null;

  // Ownership, before anything else.
  for (const [id, account] of [
    [input.source_account_id, source],
    [input.destination_account_id, destination],
  ] as const) {
    if (id && !account) return "Account not found.";
    if (account && account.user_id !== input.userId) {
      return "You don't have access to this account.";
    }
  }

  if (rule.source === "required" && !source) {
    return `A ${rule.label.toLowerCase()} needs the account the money came from.`;
  }
  if (rule.source === "forbidden" && source) {
    return `A ${rule.label.toLowerCase()} doesn't have a source account.`;
  }
  if (rule.destination === "required" && !destination) {
    return input.type === "TRANSFER"
      ? "A transfer requires both source and destination accounts."
      : `A ${rule.label.toLowerCase()} needs the account the money went to.`;
  }
  if (rule.destination === "forbidden" && destination) {
    return `An ${rule.label.toLowerCase()} doesn't have a destination account.`;
  }

  if (source && destination && source.id === destination.id) {
    return "Source and destination must be different accounts.";
  }

  // Type-specific direction rules — this is what stops the AI inventing
  // financially meaningless transactions.
  switch (input.type) {
    case "TRANSFER":
      if (destination && isLiability(destination.type)) {
        return "Paying a credit card is a Credit Card Payment, not a transfer.";
      }
      if (source && isLiability(source.type)) {
        return "Money can't be transferred out of a credit card.";
      }
      break;

    case "CASH_WITHDRAWAL":
      if (destination && destination.type !== "CASH") {
        return "A cash withdrawal has to land in a cash account.";
      }
      if (source && source.type === "CASH") {
        return "Cash can't be withdrawn from cash.";
      }
      if (source && isLiability(source.type)) {
        return "Taking cash against a credit card isn't supported.";
      }
      break;

    case "CREDIT_CARD_PAYMENT":
      if (!destination || destination.type !== "CREDIT_CARD") {
        return "A credit-card payment must specify the credit card being paid.";
      }
      if (source && isLiability(source.type)) {
        return "A credit card can't be paid from another credit card.";
      }
      break;

    case "INCOME":
      if (destination && isLiability(destination.type)) {
        return "Income has to land in an account you own money in, not a credit card.";
      }
      break;
  }

  return null;
}

/* --- duplicate detection --------------------------------------------------- */

/**
 * Same user, same money, same place, seconds apart — almost always a
 * double-tap rather than two real purchases. Callers warn; they don't block,
 * because buying two coffees is legitimate.
 */
export function looksDuplicate(
  a: {
    type: TransactionType;
    amount: number;
    source_account_id?: string | null;
    destination_account_id?: string | null;
    category_id?: string | null;
    created_at: Date | string;
  },
  b: typeof a,
  withinSeconds = 90,
): boolean {
  if (a.type !== b.type || a.amount !== b.amount) return false;
  if ((a.source_account_id ?? null) !== (b.source_account_id ?? null)) return false;
  if ((a.destination_account_id ?? null) !== (b.destination_account_id ?? null)) {
    return false;
  }
  if ((a.category_id ?? null) !== (b.category_id ?? null)) return false;

  const gap = Math.abs(
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return gap <= withinSeconds * 1000;
}
