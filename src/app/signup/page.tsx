import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export default function SignupPage() {
  return (
    <AuthShell
      title="Start your ledger"
      subtitle="Your categories and a Cash method are set up for you. Add your cards next."
    >
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
