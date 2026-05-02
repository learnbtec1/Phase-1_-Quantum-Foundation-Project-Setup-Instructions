"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import { toast } from "sonner";

function AdminSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-white/10" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-white/10" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-white/10" />
    </div>
  );
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithSession("/api/v1/auth/me", { method: "GET" });
        if (r.status === 401) {
          const d401 = await readFastApiDetail(r);
          if (shouldSignOutOn401(d401)) {
            toast.error("Session expired. Please sign in.");
            signOutOnUnauthorized();
          } else {
            toast.error(d401 || "Unauthorized");
            router.replace("/dashboard");
          }
          return;
        }
        if (!r.ok) {
          router.replace("/dashboard");
          return;
        }
        const me = (await r.json()) as { role?: string };
        if (cancelled) return;
        if ((me.role || "").toLowerCase() !== "admin") {
          toast.error("Admin access only");
          router.replace("/dashboard");
          return;
        }
        setAllowed(true);
      } catch {
        if (!cancelled) router.replace("/dashboard");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (allowed === null) return <AdminSkeleton />;
  if (!allowed) return null;
  return <>{children}</>;
}
