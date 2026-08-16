import type { ChatProvider } from "@/lib/schemas";

/**
 * The transcript is stored in Supabase in a provider-neutral shape and
 * converted to Claude or Gemini format per request. That is what lets a
 * conversation switch models mid-thread: neither provider's wire format is
 * the source of truth, this is.
 */
export type ChatRole = "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string | null;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  // Optional rather than required: an `unknown` field serialises across the
  // tRPC boundary as possibly-absent, and only tool rows ever set it.
  tool_result?: unknown;
  is_error: boolean;
  provider: ChatProvider | null;
  created_at: string;
};

export type ChatSession = {
  id: string;
  title: string | null;
  provider: ChatProvider;
  updated_at: string;
};

/** What a create_* tool hands back, and what the receipt card renders. */
export type TransactionResult = {
  ok: true;
  transaction_id: string;
  type: string;
  type_label: string;
  summary: string;
  duplicate_warning?: string;
};

/** Tools whose successful result renders as a transaction card. */
export const WRITE_TOOLS = [
  "create_expense",
  "create_income",
  "create_transfer",
  "create_cash_withdrawal",
  "create_credit_card_payment",
  "create_refund",
] as const;

export const PROVIDER_LABELS: Record<ChatProvider, string> = {
  claude: "Claude Opus 5",
  gemini: "Gemini 3.5 Flash",
};

/** One thing to draw in the thread. */
export type ChatBubble =
  | {
      kind: "text";
      key: string;
      role: "user" | "assistant";
      text: string;
      provider: ChatProvider | null;
    }
  | {
      kind: "receipt";
      key: string;
      transactionId: string;
      summary: string;
      typeLabel: string;
      warning?: string;
    };

function asResult(message: ChatMessage): TransactionResult | null {
  if (message.role !== "tool" || message.is_error) return null;
  const r = message.tool_result as Partial<TransactionResult> | null;
  if (r && r.ok && r.transaction_id && r.summary) return r as TransactionResult;
  return null;
}

/**
 * Flatten stored messages into the thread. Tool calls are not shown as such:
 * a successful `add_expense` becomes a receipt card, and everything the model
 * says around it becomes ordinary assistant text.
 */
export function toBubbles(messages: ChatMessage[]): ChatBubble[] {
  const bubbles: ChatBubble[] = [];

  for (const message of messages) {
    const receipt = asResult(message);
    if (receipt) {
      bubbles.push({
        kind: "receipt",
        key: message.id,
        transactionId: receipt.transaction_id,
        summary: receipt.summary,
        typeLabel: receipt.type_label,
        warning: receipt.duplicate_warning,
      });
      continue;
    }

    // A failed tool call is the model's problem to recover from, not something
    // to show; it already explains itself in the reply that follows.
    if (message.role === "tool") continue;

    const text = message.content?.trim();
    if (text) {
      bubbles.push({
        kind: "text",
        key: message.id,
        role: message.role,
        text,
        provider: message.provider,
      });
    }
  }

  return bubbles;
}
