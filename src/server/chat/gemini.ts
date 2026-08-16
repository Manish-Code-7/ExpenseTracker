import { GoogleGenAI } from "@google/genai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type ChatMessage, type ToolCall } from "@/lib/chat";
import { systemPrompt, type AgentTurn, type ChatContext } from "@/lib/chat-agent";
import {
  runTool,
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  type ToolName,
} from "@/server/chat/tools";

export const GEMINI_MODEL = "gemini-3.5-flash";

export const isGeminiConfigured = Boolean(process.env.GOOGLE_API_KEY);

const MAX_STEPS = 8;

/**
 * Gemini takes plain JSON Schema, and only a subset of OpenAPI at that, so the
 * Zod schema is converted and the JSON-Schema-only keys are dropped.
 */
function toolParameters(name: ToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(TOOL_SCHEMAS[name]) as Record<string, unknown>;
  delete schema.$schema;
  delete schema.additionalProperties;
  return schema;
}

const GEMINI_TOOLS = TOOL_NAMES.map((name) => ({
  type: "function" as const,
  name,
  description: TOOL_DESCRIPTIONS[name],
  parameters: toolParameters(name),
}));

/**
 * The Interactions API can hold conversation state itself via
 * `previous_interaction_id`, but this app deliberately does not use it: the
 * transcript in Neon is the single source of truth, which is what allows a
 * conversation to switch between Claude and Gemini mid-thread. Each turn
 * therefore replays the history as steps.
 */
type Step = Record<string, unknown>;

function toSteps(history: ChatMessage[]): Step[] {
  const steps: Step[] = [];

  for (const m of history) {
    if (m.role === "user") {
      steps.push({
        type: "user_input",
        content: [{ type: "text", text: m.content ?? "" }],
      });
      continue;
    }

    if (m.role === "assistant") {
      if (m.content?.trim()) {
        steps.push({
          type: "model_output",
          content: [{ type: "text", text: m.content }],
        });
      }
      for (const call of m.tool_calls ?? []) {
        steps.push({
          type: "function_call",
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }

    steps.push({
      type: "function_result",
      call_id: m.tool_call_id,
      name: m.tool_name ?? "unknown",
      result: JSON.stringify(m.tool_result),
      is_error: m.is_error,
    });
  }

  return steps;
}

type FunctionCallStep = { type: "function_call"; id: string; name: string; arguments: Record<string, unknown> };

function isFunctionCall(step: unknown): step is FunctionCallStep {
  return !!step && typeof step === "object" && (step as Step).type === "function_call";
}

function textOfStep(step: unknown): string {
  const s = step as { type?: string; content?: Array<{ type?: string; text?: string }> };
  if (s?.type !== "model_output" || !Array.isArray(s.content)) return "";
  return s.content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text!.trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function runGemini(
  context: ChatContext,
  history: ChatMessage[],
  message: string,
): Promise<AgentTurn[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Gemini is not configured. Set GOOGLE_API_KEY in .env.local.",
    });
  }

  const client = new GoogleGenAI({ apiKey });
  const turns: AgentTurn[] = [];

  const input: Step[] = [
    ...toSteps(history),
    { type: "user_input", content: [{ type: "text", text: message }] },
  ];

  for (let i = 0; i < MAX_STEPS; i++) {
    const interaction = await client.interactions.create({
      model: GEMINI_MODEL,
      system_instruction: systemPrompt(context),
      tools: GEMINI_TOOLS,
      // Logging a spend is a short, well-specified task.
      generation_config: { thinking_level: "low" },
      // The transcript lives in our own database, so there is nothing to gain from
      // Google retaining a copy for `previous_interaction_id` replay.
      store: false,
      input,
    });

    const steps = interaction.steps ?? [];
    const text = steps.map(textOfStep).filter(Boolean).join("\n\n");
    const calls = steps.filter(isFunctionCall);

    turns.push({
      role: "assistant",
      content: text || null,
      tool_calls:
        calls.length > 0
          ? calls.map<ToolCall>((c) => ({
              id: c.id,
              name: c.name,
              arguments: c.arguments ?? {},
            }))
          : null,
    });

    if (calls.length === 0) break;

    // Replay what the model produced, then answer each call.
    for (const call of calls) {
      input.push({
        type: "function_call",
        id: call.id,
        name: call.name,
        arguments: call.arguments ?? {},
      });
    }
    if (text) {
      input.push({ type: "model_output", content: [{ type: "text", text }] });
    }

    for (const call of calls) {
      const { result, isError } = await runTool(context, call.name as ToolName, call.arguments);
      turns.push({
        role: "tool",
        tool_call_id: call.id,
        tool_name: call.name,
        tool_result: result,
        is_error: isError,
      });
      input.push({
        type: "function_result",
        call_id: call.id,
        name: call.name,
        result: JSON.stringify(result),
        is_error: isError,
      });
    }
  }

  return turns;
}
