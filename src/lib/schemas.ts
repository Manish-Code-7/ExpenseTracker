import { z } from "zod";
import { ACCOUNT_TYPES, PAYMENT_METHODS, TRANSACTION_TYPES } from "@/lib/financial";
import { todayISO } from "@/lib/dates";

/**
 * Every input the app accepts, in one place.
 *
 * These are the single source of truth for validation: tRPC procedures parse
 * with them, the forms infer their types from them, and the assistant's
 * `add_expense` tool is generated from `addExpenseToolInput` below. The error
 * messages are user-facing — tRPC surfaces the first one straight into the form.
 */

const uuid = z.uuid("Pick a valid option.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

/** Trim, then treat an empty string as "not provided". */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, label)
    .transform((v) => v || null)
    .nullish();

export const idInput = z.object({ id: uuid });
export type IdInput = z.infer<typeof idInput>;

/* --- categories --------------------------------------------------------- */

export const categoryInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the category a name.")
    .max(40, "Keep the name under 40 characters."),
  parent_category_id: uuid.nullish(),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const renameCategoryInput = z.object({
  id: uuid,
  name: categoryInput.shape.name,
});

export const setCategoryHiddenInput = z.object({
  id: uuid,
  hidden: z.boolean(),
});

/* --- profile ------------------------------------------------------------ */

export const profileInput = z.object({
  full_name: optionalText(80, "Keep your name under 80 characters."),
  gender: optionalText(40, "Keep that under 40 characters."),
  date_of_birth: isoDate
    .refine((v) => v <= todayISO(), "That date of birth is in the future.")
    .refine((v) => v > "1900-01-01", "That date of birth is too far back.")
    .nullish(),
});
export type ProfileInput = z.infer<typeof profileInput>;

/* --- assistant ---------------------------------------------------------- */

export const CHAT_PROVIDERS = ["claude", "gemini"] as const;
export const chatProvider = z.enum(CHAT_PROVIDERS);
export type ChatProvider = z.infer<typeof chatProvider>;

export const chatSendInput = z.object({
  /** Null starts a new conversation. */
  sessionId: uuid.nullish(),
  message: z
    .string()
    .trim()
    .min(1, "Type something first.")
    .max(2000, "That message is too long."),
  provider: chatProvider,
});
export type ChatSendInput = z.infer<typeof chatSendInput>;

/* --- accounts & transactions -------------------------------------------- */

export const accountTypeSchema = z.enum(ACCOUNT_TYPES, "Pick an account type.");
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES, "Pick a transaction type.");
export const paymentMethodSchema = z.enum(PAYMENT_METHODS, "Pick a payment method.");

export const accountInput = z.object({
  name: z.string().trim().min(1, "Give the account a name.").max(60, "Keep the name under 60 characters."),
  type: accountTypeSchema,
  institution_name: optionalText(60, "Keep the bank name under 60 characters."),
  account_number_last4: z
    .string()
    .trim()
    .regex(/^[0-9]{3,4}$/, "Last 4 digits should be 3–4 numbers.")
    .nullish()
    .or(z.literal("").transform(() => null)),
  opening_balance: z.number("Enter an opening balance.").default(0),
  credit_limit: z.number().positive("A credit limit has to be greater than zero.").nullish(),
  billing_cycle_day: z.number().int().min(1, "Statement day must be between 1 and 28.").max(28, "Statement day must be between 1 and 28.").nullish(),
  color_tag: z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Pick a colour."),
});
export type AccountInput = z.infer<typeof accountInput>;

export const updateAccountInput = z.object({ id: uuid, values: accountInput });
export const setAccountActiveInput = z.object({ id: uuid, isActive: z.boolean() });

/** One shape for every transaction type; the engine decides which sides apply. */
export const transactionInput = z.object({
  type: transactionTypeSchema,
  amount: z.number("Enter an amount.").max(9_999_999_99, "That amount is too large."),
  source_account_id: uuid.nullish(),
  destination_account_id: uuid.nullish(),
  category_id: uuid.nullish(),
  subcategory_id: uuid.nullish(),
  payment_method: paymentMethodSchema.nullish(),
  date: isoDate,
  description: optionalText(140, "Keep the description under 140 characters."),
  merchant: optionalText(80, "Keep the merchant under 80 characters."),
  notes: optionalText(500, "Keep notes under 500 characters."),
  linked_transaction_id: uuid.nullish(),
});
export type TransactionInputSchema = z.infer<typeof transactionInput>;

export const updateTransactionInput = z.object({ id: uuid, values: transactionInput });

export const transactionFilters = z.object({
  from: isoDate.nullish(),
  to: isoDate.nullish(),
  type: transactionTypeSchema.nullish(),
  accountId: uuid.nullish(),
  categoryId: uuid.nullish(),
  paymentMethod: paymentMethodSchema.nullish(),
  search: z.string().trim().max(80).nullish(),
  minAmount: z.number().nullish(),
  maxAmount: z.number().nullish(),
  page: z.number().int().min(1).default(1),
});
export type TransactionFilters = z.infer<typeof transactionFilters>;

export const adjustBalanceInput = z.object({
  accountId: uuid,
  targetBalance: z.number(),
  date: isoDate,
  notes: optionalText(500, "Keep notes under 500 characters."),
});
