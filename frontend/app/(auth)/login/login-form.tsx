"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { Input } from "@/components/lovable-ui/ui/input";
import { Label } from "@/components/lovable-ui/ui/label";
import { authHeaders, getApiBase } from "@/lib/api";
import { isAuthDevBypassAllowed } from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);

  useEffect(() => {
    if (searchParams.get("registered") === "1") {
      toast.info("We sent a verification link — check your email before signing in.");
    }
    if (searchParams.get("unverified") === "1") {
      setUnverified(true);
    }
  }, [searchParams]);

  /** Emergency dev bypass (NEXT_PUBLIC_AUTH_DEV_INJECT + localhost / dev build). Root layout runs Golden Ticket first. */
  useEffect(() => {
    if (!isAuthDevBypassAllowed()) return;
    const raw = process.env.NEXT_PUBLIC_AUTH_DEV_REDIRECT?.trim();
    const dest = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
    router.replace(dest);
  }, [router]);

  /** Must not nest `<form>` inside the login `<form>` — invalid HTML causes hydration mismatch (React #418/#422). */
  async function handleResendVerification() {
    const em = (resendEmail || email).trim();
    if (!em) {
      toast.error("Enter the email you registered with.");
      return;
    }
    setResendLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/api/v1/auth/resend-verification`, {
        method: "POST",
        headers: authHeaders(null) as Record<string, string>,
        body: JSON.stringify({ email: em }),
      });
      const j = (await r.json().catch(() => ({}))) as { detail?: string };
      if (!r.ok) {
        throw new Error(j.detail || "Failed");
      }
      toast.success(j.detail || "If the account exists, a new link was sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setResendLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/auth/login`, {
        method: "POST",
        headers: authHeaders(null) as Record<string, string>,
        body: JSON.stringify({
          email,
          password,
          ...(totpCode.trim() ? { totp_code: totpCode.replace(/\s/g, "") } : {}),
        }),
      });
      if (res.status === 403) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        if (d.detail === "EMAIL_NOT_VERIFIED") {
          setUnverified(true);
          toast.error("Please verify your email before signing in.");
          return;
        }
        throw new Error(typeof d.detail === "string" ? d.detail : "Access denied");
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(d.detail || "Login failed");
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token_type?: string };
      if (data && data.ok === false) {
        throw new Error("Login failed");
      }
      toast.success("Signed in");
      const raw = searchParams.get("next");
      const next =
        raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
      router.replace(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
          ← الصفحة الرئيسية (بدون تسجيل)
        </Link>
      </p>
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>EDUVERS-CORE — use your account for vector search and BTEC grading.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totp">Authenticator code (if 2FA is on)</Label>
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          {unverified && (
            <div
              role="group"
              aria-label="Resend verification email"
              className="w-full space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
            >
              <p className="text-center text-sm text-amber-200/90">البريد غير مُفعّل. أرسل رابط التحقق:</p>
              <Input
                type="email"
                placeholder="Email on your account"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                className="border-white/10 bg-slate-950/40"
                dir="ltr"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full border-amber-500/40"
                disabled={resendLoading}
                onClick={() => void handleResendVerification()}
              >
                {resendLoading ? "Sending…" : "Resend verification link"}
              </Button>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </p>
          <p className="text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Register
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
    </div>
  );
}
