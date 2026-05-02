import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading sign-in…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
