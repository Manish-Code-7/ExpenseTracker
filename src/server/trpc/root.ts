import { router } from "@/server/trpc/init";
import { accountRouter } from "@/server/trpc/routers/account";
import { accountsRouter } from "@/server/trpc/routers/accounts";
import { dashboardRouter } from "@/server/trpc/routers/dashboard";
import { importRouter } from "@/server/trpc/routers/import";
import { transactionsRouter } from "@/server/trpc/routers/transactions";
import { categoriesRouter } from "@/server/trpc/routers/categories";
import { chatRouter } from "@/server/trpc/routers/chat";
import { recurringRouter } from "@/server/trpc/routers/recurring";

export const appRouter = router({
  account: accountRouter,
  accounts: accountsRouter,
  dashboard: dashboardRouter,
  import: importRouter,
  transactions: transactionsRouter,
  categories: categoriesRouter,
  chat: chatRouter,
  recurring: recurringRouter,
});

export type AppRouter = typeof appRouter;
