import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const role = (headers().get("x-user-role") ?? "").trim().toLowerCase();
  const isAdmin = role === "admin";

  return (
    <AuthGuard>
      <div className="min-h-screen w-full bg-transparent">
        <AppShell isAdmin={isAdmin}>{children}</AppShell>
      </div>
    </AuthGuard>
  );
}