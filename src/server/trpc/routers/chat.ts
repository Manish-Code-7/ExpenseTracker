import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "@/server/trpc/init";
import { chatProvider, chatSendInput, idInput } from "@/lib/schemas";
import type { ChatMessage, ChatSession } from "@/lib/chat";
import type { AgentTurn, ChatContext } from "@/lib/chat-agent";
import { getCategoryTree } from "@/lib/queries";
import { loadToolContext } from "@/server/chat/tools";
import { isClaudeConfigured, runClaude } from "@/server/chat/claude";
import { isGeminiConfigured, runGemini } from "@/server/chat/gemini";
import type { Context } from "@/server/trpc/init";
import { and, asc, desc, eq } from "drizzle-orm";
import { chatMessages, chatSessions } from "@/server/db/schema";

/**
 * How much of the conversation to replay to the model. Trimming starts from
 * the oldest turn and then advances to the next plain user message, because
 * cutting between a tool call and its result leaves an unanswered call that
 * both providers reject.
 */
const HISTORY_LIMIT = 40;

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= HISTORY_LIMIT) return messages;
  let out = messages.slice(-HISTORY_LIMIT);
  while (out.length > 0 && out[0].role !== "user") out = out.slice(1);
  return out;
}

async function loadMessages(
  ctx: Context,
  sessionId: string,
  userId: string,
): Promise<ChatMessage[]> {
  const rows = await ctx.db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      tool_calls: chatMessages.tool_calls,
      tool_call_id: chatMessages.tool_call_id,
      tool_name: chatMessages.tool_name,
      tool_result: chatMessages.tool_result,
      is_error: chatMessages.is_error,
      provider: chatMessages.provider,
      created_at: chatMessages.created_at,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.session_id, sessionId),
        eq(chatMessages.user_id, userId),
      ),
    )
    .orderBy(asc(chatMessages.created_at), asc(chatMessages.id));
  return rows as unknown as ChatMessage[];
}

export const chatRouter = router({
  /** Which providers actually have a key configured, for the model toggle. */
  providers: protectedProcedure.query(() => ({
    claude: isClaudeConfigured,
    gemini: isGeminiConfigured,
  })),

  sessions: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        provider: chatSessions.provider,
        updated_at: chatSessions.updated_at,
      })
      .from(chatSessions)
      .where(eq(chatSessions.user_id, ctx.userId))
      .orderBy(desc(chatSessions.updated_at))
      .limit(30);
    return rows as ChatSession[];
  }),

  messages: protectedProcedure
    .input(z.object({ sessionId: z.uuid().nullish() }))
    .query(async ({ ctx, input }) => {
      if (!input.sessionId) return [] as ChatMessage[];
      return loadMessages(ctx, input.sessionId, ctx.userId);
    }),

  deleteSession: protectedProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      // chat_messages cascades on the session's foreign key.
      await ctx.db
        .delete(chatSessions)
        .where(
          and(eq(chatSessions.id, input.id), eq(chatSessions.user_id, ctx.userId)),
        );
      return { id: input.id };
    }),

  setProvider: protectedProcedure
    .input(z.object({ id: z.uuid(), provider: chatProvider }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(chatSessions)
        .set({ provider: input.provider })
        .where(
          and(eq(chatSessions.id, input.id), eq(chatSessions.user_id, ctx.userId)),
        );
      return { id: input.id };
    }),

  send: protectedProcedure
    .input(chatSendInput)
    .mutation(async ({ ctx, input }) => {
      const configured =
        input.provider === "claude" ? isClaudeConfigured : isGeminiConfigured;
      if (!configured) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            input.provider === "claude"
              ? "Claude is not configured. Set ANTHROPIC_API_KEY in .env.local."
              : "Gemini is not configured. Set GOOGLE_API_KEY in .env.local.",
        });
      }

      // Start a conversation on first message, titled with the opening line.
      let sessionId = input.sessionId ?? null;
      if (!sessionId) {
        const [row] = await ctx.db
          .insert(chatSessions)
          .values({
            user_id: ctx.userId,
            provider: input.provider,
            title: input.message.slice(0, 120),
          })
          .returning({ id: chatSessions.id });
        sessionId = row.id;
      } else {
        await ctx.db
          .update(chatSessions)
          .set({ provider: input.provider })
          .where(
            and(
              eq(chatSessions.id, sessionId),
              eq(chatSessions.user_id, ctx.userId),
            ),
          );
      }

      const history = trimHistory(await loadMessages(ctx, sessionId, ctx.userId));

      const categories = await getCategoryTree(ctx.userId);
      const context: ChatContext = await loadToolContext(ctx.userId, categories);

      // Persist the user's turn before calling out, so a provider failure
      // still leaves the conversation readable rather than losing the message.
      await ctx.db.insert(chatMessages).values({
        session_id: sessionId,
        user_id: ctx.userId,
        role: "user",
        content: input.message,
      });

      let turns: AgentTurn[];
      try {
        turns =
          input.provider === "claude"
            ? await runClaude(context, history, input.message)
            : await runGemini(context, history, input.message);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const raw = error instanceof Error ? error.message : String(error);

        // Provider limits are the most common failure and the one a user can
        // act on, so say what happened rather than leaking the SDK's message.
        if (/\b429\b|rate limit|quota|RESOURCE_EXHAUSTED/i.test(raw)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              input.provider === "gemini"
                ? "Gemini's free tier is out of requests for now — it allows 5 a minute and 20 a day. Wait a minute, switch to Claude, or enable billing in Google AI Studio."
                : "Claude is rate limited right now. Wait a moment and try again.",
          });
        }
        if (/\b401\b|\b403\b|api key|unauthor/i.test(raw)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `The ${input.provider === "gemini" ? "GOOGLE_API_KEY" : "ANTHROPIC_API_KEY"} was rejected. Check it in .env.local and restart.`,
          });
        }

        throw new TRPCError({ code: "BAD_GATEWAY", message: `The assistant failed: ${raw}` });
      }

      if (turns.length > 0) {
        type NewMessage = typeof chatMessages.$inferInsert;
        await ctx.db.insert(chatMessages).values(
          turns.map((turn): NewMessage =>
            turn.role === "assistant"
              ? {
                  session_id: sessionId,
                  user_id: ctx.userId,
                  role: "assistant",
                  content: turn.content,
                  tool_calls: turn.tool_calls,
                  provider: input.provider,
                }
              : {
                  session_id: sessionId,
                  user_id: ctx.userId,
                  role: "tool",
                  tool_call_id: turn.tool_call_id,
                  tool_name: turn.tool_name,
                  tool_result: turn.tool_result,
                  is_error: turn.is_error,
                  provider: input.provider,
                },
          ),
        );
      }

      // The Supabase trigger that touched chat_sessions.updated_at is gone,
      // so the session list keeps sorting by activity from here.
      await ctx.db
        .update(chatSessions)
        .set({ updated_at: new Date().toISOString() })
        .where(eq(chatSessions.id, sessionId));

      const logged = turns.some(
        (t) => t.role === "tool" && !t.is_error,
      );

      return {
        sessionId,
        messages: await loadMessages(ctx, sessionId, ctx.userId),
        logged,
      };
    }),
});
