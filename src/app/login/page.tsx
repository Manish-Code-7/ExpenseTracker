import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Pick up where your spending left off."
    >
      <AuthForm mode="login" next={next} initialError={error} />
    </AuthShell>
  );
}
