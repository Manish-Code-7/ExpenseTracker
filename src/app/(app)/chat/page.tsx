import { requireUser } from "@/server/session";
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/page-header";
import { ChatPanel } from "@/components/chat-panel";
import { isClaudeConfigured } from "@/server/chat/claude";
import { isGeminiConfigured } from "@/server/chat/gemini";
import { getCategoryTree } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  const available = { claude: isClaudeConfigured, gemini: isGeminiConfigured };

  if (!available.claude && !available.gemini) {
    return (
      <>
        <PageHeader title="Assistant" />
        <EmptyState
          title="Assistant not configured"
          body="Set ANTHROPIC_API_KEY or GOOGLE_API_KEY in .env.local — see .env.local.example — and restart the dev server."
          action={
            <Link href="/transactions/new" className="btn btn-primary">
              Add a transaction manually
            </Link>
          }
        />
      </>
    );
  }

  const categories = await getCategoryTree(user.id);

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Describe a spend and it lands in your ledger."
        action={
          <Link href="/transactions/new" className="btn btn-secondary shrink-0">
            Form
          </Link>
        }
      />
      <ChatPanel
        canLog={categories.length > 0}
        available={available}
        initialProvider={available.claude ? "claude" : "gemini"}
      />
    </>
  );
}
