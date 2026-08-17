import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "@/server/db/auth-schema";
import type { ToolCall } from "@/lib/chat";
import { ACCOUNT_TYPES, PAYMENT_METHODS, TRANSACTION_TYPES } from "@/lib/financial";

export * from "@/server/db/auth-schema";

/**
 * The application schema, ported from the Supabase SQL files.
 *
 * The one structural change from Postgres-on-Supabase: `user_id` is `text`
 * referencing Better Auth's `user.id`, not a uuid referencing `auth.users`.
 * Better Auth issues text ids, and there is no `auth` schema on Neon.
 *
 * Ownership was previously enforced by RLS using `auth.uid()`. Neon has no
 * implicit request identity, so every query in the tRPC layer scopes by
 * `ctx.userId` instead — see src/server/trpc/init.ts. The database-level
 * integrity guards (depth limits, cross-user reference checks) are kept as
 * triggers in neon/02_functions.sql.
 */

const ownerId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

export const recurrenceFrequency = pgEnum("recurrence_frequency", [
  "weekly",
  "monthly",
  "yearly",
]);

export const chatProviderEnum = pgEnum("chat_provider", ["claude", "gemini"]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant", "tool"]);

/* --- profiles ----------------------------------------------------------- */

export const profiles = pgTable(
  "profiles",
  {
    id: text("id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    full_name: text("full_name"),
    // Age is derived from this rather than stored, so it can't go stale.
    date_of_birth: date("date_of_birth"),
    // Free text so people can self-describe; the app suggests common options.
    gender: text("gender"),
    avatar_url: text("avatar_url"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "profiles_name_length",
      sql`${t.full_name} is null or length(btrim(${t.full_name})) between 1 and 80`,
    ),
    check(
      "profiles_gender_length",
      sql`${t.gender} is null or length(btrim(${t.gender})) between 1 and 40`,
    ),
    check(
      "profiles_dob_sane",
      sql`${t.date_of_birth} is null or ${t.date_of_birth} > date '1900-01-01'`,
    ),
  ],
);

/* --- categories --------------------------------------------------------- */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    name: text("name").notNull(),
    // Self-reference needs the explicit column type; without it Drizzle emits
    // the column but no foreign key, and deleting a parent stops cascading to
    // its subcategories.
    parent_category_id: uuid("parent_category_id").references(
      (): AnyPgColumn => categories.id,
      { onDelete: "cascade" },
    ),
    // Presets can't be deleted, only hidden.
    is_preset: boolean("is_preset").default(false).notNull(),
    is_hidden: boolean("is_hidden").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    check("categories_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    uniqueIndex("categories_unique_name_per_parent").on(
      t.user_id,
      sql`coalesce(${t.parent_category_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    index("categories_user_idx").on(t.user_id),
    index("categories_parent_idx").on(t.parent_category_id),
  ],
);

/* --- payment methods ---------------------------------------------------- */


/* --- expenses ----------------------------------------------------------- */


/* --- recurring patterns ------------------------------------------------- */

export const recurringPatterns = pgTable(
  "recurring_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    category_id: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    subcategory_id: uuid("subcategory_id").references(() => categories.id, {
      onDelete: "cascade",
    }),
    account_id: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    merchant_or_note_pattern: text("merchant_or_note_pattern"),
    // Normalised note fingerprint used to group occurrences.
    note_key: text("note_key").default("").notNull(),
    average_amount: numeric("average_amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    frequency: recurrenceFrequency("frequency").notNull(),
    avg_interval_days: integer("avg_interval_days").notNull(),
    occurrence_count: integer("occurrence_count").default(0).notNull(),
    confidence_score: numeric("confidence_score", { precision: 4, scale: 3, mode: "number" })
      .default(0)
      .notNull(),
    last_detected_date: date("last_detected_date").notNull(),
    next_due_date: date("next_due_date"),
    is_confirmed: boolean("is_confirmed").default(false).notNull(),
    is_dismissed: boolean("is_dismissed").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [index("recurring_patterns_user_idx").on(t.user_id)],
);

/* --- assistant chat ----------------------------------------------------- */

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    title: text("title"),
    // Remembered so reopening a conversation resumes on the model you left it on.
    provider: chatProviderEnum("provider").default("claude").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [index("chat_sessions_user_idx").on(t.user_id, t.updated_at.desc())],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    user_id: ownerId(),
    role: chatRoleEnum("role").notNull(),
    content: text("content"),
    // [{ id, name, arguments }] on an assistant turn that called tools
    tool_calls: jsonb("tool_calls").$type<ToolCall[] | null>(),
    tool_call_id: text("tool_call_id"),
    tool_name: text("tool_name"),
    tool_result: jsonb("tool_result").$type<unknown>(),
    is_error: boolean("is_error").default(false).notNull(),
    provider: chatProviderEnum("provider"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  // Two rows written in the same statement can share a timestamp; id breaks
  // the tie deterministically.
  (t) => [index("chat_messages_session_idx").on(t.session_id, t.created_at, t.id)],
);

/* --- financial core: accounts + transactions ----------------------------- */

export const accountTypeEnum = pgEnum("account_type", ACCOUNT_TYPES);
export const transactionTypeEnum = pgEnum("transaction_type", TRANSACTION_TYPES);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);

/**
 * A place money sits. Replaces `payment_methods`, which conflated an account
 * (HDFC Bank) with a payment channel (UPI) — the two are now separate, because
 * "paid by UPI from HDFC" needs both and they answer different questions.
 *
 * `balance` is signed: assets positive, liabilities negative. See lib/financial.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    institution_name: text("institution_name"),
    // Never store a full account or card number.
    account_number_last4: text("account_number_last4"),
    currency: text("currency").default("INR").notNull(),
    opening_balance: numeric("opening_balance", { precision: 14, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    // Maintained by the transaction service; never written directly by a route.
    current_balance: numeric("current_balance", { precision: 14, scale: 2, mode: "number" })
      .default(0)
      .notNull(),
    credit_limit: numeric("credit_limit", { precision: 14, scale: 2, mode: "number" }),
    billing_cycle_day: integer("billing_cycle_day"),
    due_day: integer("due_day"),
    color_tag: text("color_tag").default("#6366f1").notNull(),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    check("accounts_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("accounts_color_hex", sql`${t.color_tag} ~* '^#[0-9a-f]{6}$'`),
    check(
      "accounts_last4_digits",
      sql`${t.account_number_last4} is null or ${t.account_number_last4} ~ '^[0-9]{3,4}$'`,
    ),
    check(
      "accounts_cycle_day_range",
      sql`${t.billing_cycle_day} is null or ${t.billing_cycle_day} between 1 and 28`,
    ),
    check(
      "accounts_credit_limit_positive",
      sql`${t.credit_limit} is null or ${t.credit_limit} > 0`,
    ),
    index("accounts_user_idx").on(t.user_id, t.is_active),
  ],
);

/**
 * One row per economic event. A transfer is a single row with both sides —
 * not two rows — so it cannot be half-applied or counted twice.
 *
 * `transfer_id` groups rows that belong to one logical movement if a future
 * type ever needs more than one row; `linked_transaction_id` points a refund
 * at the purchase it reverses.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    type: transactionTypeEnum("type").notNull(),
    // Positive for every type except ADJUSTMENT, which carries a signed correction.
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").default("INR").notNull(),
    source_account_id: uuid("source_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    destination_account_id: uuid("destination_account_id").references(
      () => accounts.id,
      { onDelete: "restrict" },
    ),
    category_id: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategory_id: uuid("subcategory_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    payment_method: paymentMethodEnum("payment_method"),
    date: date("date").notNull(),
    description: text("description"),
    // Kept apart from category on purpose: Zomato is a merchant, Food is a category.
    merchant: text("merchant"),
    notes: text("notes"),
    transfer_id: uuid("transfer_id"),
    // The bank's identity for this row, once known. Set on import, or written
    // back when an imported row is matched to a manually-entered transaction —
    // which is what makes the *next* import of that row exact rather than fuzzy.
    external_ref: text("external_ref"),
    linked_transaction_id: uuid("linked_transaction_id"),
    // "user" or the model that proposed it, for auditability.
    created_by: text("created_by").default("user").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "transactions_amount_nonzero",
      sql`(${t.type} = 'ADJUSTMENT' and ${t.amount} <> 0) or (${t.type} <> 'ADJUSTMENT' and ${t.amount} > 0)`,
    ),
    // The shape rules from lib/financial, enforced by the database too.
    check(
      "transactions_sides_match_type",
      sql`
        (${t.type} = 'EXPENSE'  and ${t.source_account_id} is not null and ${t.destination_account_id} is null) or
        (${t.type} in ('INCOME','REFUND','ADJUSTMENT') and ${t.source_account_id} is null and ${t.destination_account_id} is not null) or
        (${t.type} in ('TRANSFER','CASH_WITHDRAWAL','CREDIT_CARD_PAYMENT')
           and ${t.source_account_id} is not null and ${t.destination_account_id} is not null
           and ${t.source_account_id} <> ${t.destination_account_id})
      `,
    ),
    index("transactions_user_date_idx").on(t.user_id, t.date.desc()),
    index("transactions_user_type_idx").on(t.user_id, t.type),
    index("transactions_source_idx").on(t.source_account_id),
    index("transactions_destination_idx").on(t.destination_account_id),
    index("transactions_category_idx").on(t.user_id, t.category_id),
    index("transactions_transfer_idx").on(t.transfer_id),
    index("transactions_linked_idx").on(t.linked_transaction_id),
    // One bank row can only ever be one transaction.
    uniqueIndex("transactions_external_ref_unique")
      .on(t.user_id, t.external_ref)
      .where(sql`${t.external_ref} is not null`),
  ],
);

export const ingestSourceEnum = pgEnum("ingest_source", ["STATEMENT", "EMAIL", "SMS"]);
export const ingestStatusEnum = pgEnum("ingest_status", [
  "PENDING",
  "IMPORTED",
  "IGNORED",
  "DUPLICATE",
]);

/**
 * Rows seen from outside the app, held for review before they touch the ledger.
 *
 * Everything imported lands here first — statements now, email and SMS later —
 * because a wrong auto-import corrupts balances silently and is unpleasant to
 * unwind. The user confirms; only then does the transaction service run.
 *
 * `external_ref` is unique per user, so importing the same statement twice is
 * a no-op rather than a duplicate.
 */
export const ingestedItems = pgTable(
  "ingested_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: ownerId(),
    source: ingestSourceEnum("source").notNull(),
    external_ref: text("external_ref").notNull(),
    /** The account the statement belongs to, chosen at upload time. */
    account_id: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Verbatim, so a parsing bug can be re-run without re-uploading. */
    raw_text: text("raw_text").notNull(),

    parsed_amount: numeric("parsed_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    parsed_date: date("parsed_date").notNull(),
    parsed_merchant: text("parsed_merchant"),

    suggested_type: transactionTypeEnum("suggested_type").notNull(),
    suggested_category_id: uuid("suggested_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    status: ingestStatusEnum("status").default("PENDING").notNull(),
    /** The existing transaction this appears to duplicate, if any. */
    matched_transaction_id: uuid("matched_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    match_reason: text("match_reason"),
    /** Set once the user confirms and the ledger row exists. */
    transaction_id: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),

    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ingested_items_ref_unique").on(t.user_id, t.external_ref),
    index("ingested_items_review_idx").on(t.user_id, t.status, t.parsed_date),
  ],
);
