import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta";
import { TRPCError } from "@trpc/server";
import { type ChatMessage, type ToolCall } from "@/lib/chat";
import { systemPrompt, type AgentTurn, type ChatContext } from "@/lib/chat-agent";
import {
  runTool,
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  TOOL_SCHEMAS,
} from "@/server/chat/tools";

export const CLAUDE_MODEL = "claude-opus-5";

export const isClaudeConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

/** Rebuild Claude's wire format from the provider-neutral stored transcript. */
function toClaudeMessages(history: ChatMessage[]): BetaMessageParam[] {
  const messages: BetaMessageParam[] = [];

  for (const m of history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content ?? "" });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: NonNullable<BetaMessageParam["content"]> = [];
      if (m.content?.trim()) blocks.push({ type: "text", text: m.content });
      for (const call of m.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      if (Array.isArray(blocks) && blocks.length > 0) {
        messages.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    // Tool results ride on a user turn. Consecutive results are merged so a
    // multi-call turn answers with one message, as the API expects.
    const block = {
      type: "tool_result" as const,
      tool_use_id: m.tool_call_id!,
      content: JSON.stringify(m.tool_result),
      is_error: m.is_error,
    };
    const last = messages.at(-1);
    if (last?.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: "user", content: [block] });
    }
  }

  return messages;
}

/**
 * Convert the messages the tool runner appended back into provider-neutral
 * turns. Thinking blocks are deliberately not carried across turns — they are
 * preserved inside the runner's own loop, which is where the API requires it.
 */
function toTurns(added: BetaMessageParam[]): AgentTurn[] {
  const turns: AgentTurn[] = [];
  const names = new Map<string, string>();

  for (const message of added) {
    const blocks =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;

    if (message.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n");

      const calls: ToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          names.set(b.id, b.name);
          return {
            id: b.id,
            name: b.name,
            arguments: (b.input ?? {}) as Record<string, unknown>,
          };
        });

      if (text || calls.length > 0) {
        turns.push({
          role: "assistant",
          content: text || null,
          tool_calls: calls.length > 0 ? calls : null,
        });
      }
      continue;
    }

    for (const block of blocks) {
      if (block.type !== "tool_result") continue;
      const raw =
        typeof block.content === "string"
          ? block.content
          : ((block.content ?? []).find((c) => c.type === "text")?.text ?? "null");
      let result: unknown;
      try {
        result = JSON.parse(raw);
      } catch {
        result = { ok: false, error: raw };
      }
      turns.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        tool_name: names.get(block.tool_use_id) ?? "unknown",
        tool_result: result,
        is_error: Boolean(block.is_error) || !(result as { ok?: boolean })?.ok,
      });
    }
  }

  return turns;
}

export async function runClaude(
  context: ChatContext,
  history: ChatMessage[],
  message: string,
): Promise<AgentTurn[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Claude is not configured. Set ANTHROPIC_API_KEY in .env.local.",
    });
  }

  const seed: BetaMessageParam[] = [
    ...toClaudeMessages(history),
    { role: "user", content: message },
  ];

  // One tool per financial meaning; the executor is shared with Gemini.
  const tools = TOOL_NAMES.map((name) =>
    betaZodTool({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: TOOL_SCHEMAS[name],
      run: async (input: unknown) => {
        const { result } = await runTool(context, name, input);
        return JSON.stringify(result);
      },
    }),
  );

  const runner = new Anthropic({ apiKey }).beta.messages.toolRunner({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    // The catalogue and instructions are identical on every turn of a
    // conversation, so they are worth a cache breakpoint; the messages that
    // follow are not.
    system: [
      {
        type: "text",
        text: systemPrompt(context),
        cache_control: { type: "ephemeral" },
      },
    ],
    // Logging a spend is a short, well-specified task — low effort keeps the
    // reply quick without turning thinking off, which on Opus 5 can make a
    // tool call come back as plain text and silently never run.
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    tools,
    max_iterations: 8,
    messages: seed,
  });

  await runner.runUntilDone();

  return toTurns(runner.params.messages.slice(seed.length) as BetaMessageParam[]);
}
