import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/root";

export const dynamic = "force-dynamic";

// The assistant's tool loop can run for a while on a multi-expense message.
export const maxDuration = 60;

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext,
  });
}

export { handler as GET, handler as POST };
