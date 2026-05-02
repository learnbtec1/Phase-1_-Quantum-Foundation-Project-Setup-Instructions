"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/lovable-ui/ui/card";
import { Input } from "@/components/lovable-ui/ui/input";
import { Label } from "@/components/lovable-ui/ui/label";
import { authHeaders, getApiBase } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (!token) {
      toast.error("Missing token in URL.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/auth/reset-password`, {
        method: "POST",
        headers: authHeaders(null) as Record<string, string>,
        body: JSON.stringify({ token, new_password: password }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(d.detail || "Reset failed");
      }
      toast.success("Password updated — you can sign in");
      router.replace("/login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="text-center text-sm text-destructive">
        Invalid or missing link. <Link href="/forgot-password">Request a new one</Link>.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password (min. 8)</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Saving…" : "Update password"}
        </Button>
      </CardFooter>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="w-full max-w-md space-y-3">
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          ← Back to sign in
        </Link>
      </p>
      <Card className="w-full shadow-lg">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a strong password for your account.</CardDescription>
        </CardHeader>
        <Suspense
          fallback={
            <p className="px-6 pb-6 text-center text-sm text-muted-foreground">Loading…</p>
          }
        >
          <ResetForm />
        </Suspense>
      </Card>
    </div>
  );
}
