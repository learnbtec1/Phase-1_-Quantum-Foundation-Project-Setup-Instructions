"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getApiBase, readFastApiDetail, clearStoredToken } from "@/lib/api";
import { getAccessToken, isEmergencyAuthFreeze } from "@/lib/auth";
import { Loader2 } from "lucide-react";
import { BackendOfflineBanner } from "@/components/backend-offline-banner";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const freeze = isEmergencyAuthFreeze();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(() =>
    freeze ? true : null,
  );
  const [backendOffline, setBackendOffline] = useState(false);

  useEffect(() => {
    if (freeze) return;
    let isMounted = true;

    const checkSession = async () => {
      try {
        const bearer = typeof window !== "undefined" ? getAccessToken() : null;
        const res = await fetch(`${getApiBase()}/api/v1/auth/me`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          credentials: "include",
        });

        if (!isMounted) return;

        if (res.ok) {
          setBackendOffline(false);
          setIsAuthorized(true);
          return;
        }

        if (res.status === 403) {
          const d = await readFastApiDetail(res);
          clearStoredToken();
          setBackendOffline(false);
          if (d === "EMAIL_NOT_VERIFIED" || d.includes("EMAIL_NOT_VERIFIED")) {
            router.replace("/login?unverified=1");
          } else {
            const next = encodeURIComponent(pathname || "/dashboard");
            router.replace(`/login?next=${next}`);
          }
          setIsAuthorized(false);
          return;
        }

        if (res.status === 401) {
          clearStoredToken();
          setBackendOffline(false);
          setIsAuthorized(false);
          const next = encodeURIComponent(pathname || "/dashboard");
          router.replace(`/login?next=${next}`);
          return;
        }

        /* 5xx / gateway — keep shell; show banner (do not bounce to login → avoids stray redirects). */
        if (res.status >= 500) {
          setBackendOffline(true);
          setIsAuthorized(true);
          return;
        }

        setBackendOffline(false);
        setIsAuthorized(false);
        const next = encodeURIComponent(pathname || "/dashboard");
        router.replace(`/login?next=${next}`);
      } catch {
        if (!isMounted) return;
        setBackendOffline(true);
        setIsAuthorized(true);
      }
    };

    void checkSession();
    return () => {
      isMounted = false;
    };
  }, [pathname, router, freeze]);

  if (isAuthorized === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <>
      {backendOffline ? <BackendOfflineBanner /> : null}
      {children}
    </>
  );
}
