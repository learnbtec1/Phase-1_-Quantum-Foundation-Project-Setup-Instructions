"use client";

import { useState, useCallback } from "react";
import {
  BrainCircuit,
  PlayCircle,
  CheckCircle,
  RefreshCcw,
  Sparkles,
  Loader2,
  Target,
} from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/lovable-ui/ui/card";
import { cn } from "@/lib/utils";
import { fetchWithSession, readFastApiDetail, shouldSignOutOn401, signOutOnUnauthorized } from "@/lib/api";
import {
  beginUltraTutorThinkingPhase,
  deliverUltraTutorExplanationToAvatar,
  endUltraTutorThinkingPhase,
} from "@/lib/avatar/ultraTutorAvatarBridge";
import { toast } from "sonner";

export interface UltraTutorProps {
  briefId: string;
  briefText: string;
  currentCriterion: string;
  className?: string;
}

interface TutorData {
  explanation: string;
  media_prompt: string;
  game_idea: string;
}

/**
 * Ultra Tutor — Socratic BTEC coach; calls POST /api/v1/ultra/session (session cookie + optional Bearer).
 * Thinking/speech pipelines use {@link ultraTutorAvatarBridge} (UnifiedGestureEngine + TTS/lip-sync events).
 * Full VRM feedback: open `/cognie` in the same browser session so shared gesture/audio stacks stay loaded.
 */
export function UltraTutor({ briefId, briefText, currentCriterion, className }: UltraTutorProps) {
  const [loading, setLoading] = useState(false);
  const [tutorData, setTutorData] = useState<TutorData | null>(null);

  const fetchTutorSession = useCallback(async () => {
    if (!briefText || briefText.trim().length < 20) {
      toast.error("ألصق أو ارفع نص الواجب أولاً (20 حرفاً على الأقل) للمعلم الذكي.");
      return;
    }
    setLoading(true);
    beginUltraTutorThinkingPhase();
    try {
      const response = await fetchWithSession("/api/v1/ultra/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief_id: briefId,
          current_criterion: currentCriterion,
          brief_text: briefText,
        }),
      });

      if (!response.ok) {
        const detail = await readFastApiDetail(response);
        if (response.status === 401 && shouldSignOutOn401(detail)) {
          signOutOnUnauthorized();
        }
        throw new Error(detail || "فشل في الاتصال بالمعلم الذكي");
      }

      const data: TutorData = await response.json();
      setTutorData(data);
      endUltraTutorThinkingPhase();
      void deliverUltraTutorExplanationToAvatar(data.explanation).catch(() => {
        /* TTS optional if unauthenticated guest — ignore */
      });
      toast.success("تم تحليل المعيار وتجهيز خطة الفهم!");
    } catch (error) {
      console.error(error);
      endUltraTutorThinkingPhase();
      const msg = error instanceof Error ? error.message : "عذراً، المعلم الذكي مشغول حالياً. جرب مرة أخرى.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [briefId, briefText, currentCriterion]);

  return (
    <Card className={cn("glass-card overflow-hidden", className)}>
      <CardHeader className="border-b border-white/10 bg-gradient-to-r from-primary/10 to-transparent pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-inner">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-foreground">المعلم السقراطي (Ultra Tutor)</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                توجيه ذكي لتخطي معيار {currentCriterion} بدون إجابات جاهزة
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchTutorSession}
            disabled={loading}
            className="gap-2 rounded-lg border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {tutorData ? "تحليل جديد" : "ابدأ التوجيه"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {!tutorData && !loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-center opacity-70">
            <Target className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="max-w-xs text-sm text-muted-foreground">
              اضغط على &quot;ابدأ التوجيه&quot; ليقوم المعلم الذكي بتحليل معيار {currentCriterion} وتجهيز الشرح
              والتحديات.
            </p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary" />
            <p className="animate-pulse text-sm font-medium text-foreground">جاري تحضير الشرح بأسلوب تفاعلي…</p>
          </div>
        ) : tutorData ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 flex flex-col gap-6 duration-500">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-inner">
              <p className="text-foreground/90 text-base leading-relaxed whitespace-pre-wrap">
                {tutorData.explanation}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 bg-background/50 p-6 transition-colors hover:border-primary/50 hover:bg-primary/5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors group-hover:text-primary">
                  <PlayCircle className="h-6 w-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">وسائط توضيحية مقترحة</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={tutorData.media_prompt}>
                    {tutorData.media_prompt}
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" className="mt-2 w-full text-xs" disabled>
                  توليد الفيديو (قريباً)
                </Button>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-accent/20 bg-accent/5 p-5">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-accent">
                    <Target className="h-5 w-5" />
                    <span className="font-bold">تحدي ذهني سريع</span>
                  </div>
                  <p className="text-sm text-foreground/80">{tutorData.game_idea}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full border-accent/30 text-accent hover:bg-accent/10"
                  onClick={() => toast.info("واجهة التحدي التفاعلي قيد الإعداد.")}
                >
                  حل التحدي
                </Button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-white/10 pt-4">
              <Button
                type="button"
                onClick={() => toast.success("ممتاز! واصل الحل في مساحة العمل.")}
                className="flex-1 gap-2 bg-green-600 text-white shadow-lg shadow-green-900/20 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4" />
                وصلت الفكرة، رح أبدأ أحل
              </Button>
              <Button
                type="button"
                onClick={fetchTutorSession}
                variant="secondary"
                className="flex-1 gap-2 border-white/10"
                disabled={loading}
              >
                <RefreshCcw className="h-4 w-4" />
                اشرحلي بطريقة ثانية
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
