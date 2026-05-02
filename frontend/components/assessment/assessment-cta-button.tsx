"use client";

import { ArrowRight, ClipboardCheck, Loader2, Radar, ScanSearch } from "lucide-react";
import { trackAssessmentCtaClick, type AssessmentCtaBlockReason, type AssessmentCtaSource } from "@/lib/analytics";
import { Button } from "@/components/lovable-ui/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/lovable-ui/ui/tooltip";
import { cn } from "@/lib/utils";

export type CtaBlockReason =
  | "missing_answer"
  | "academic_incomplete"
  | "uploading"
  | "needs_confirmation"
  | null;

type Props = {
  source: AssessmentCtaSource;
  id: string;
  name: string;
  "data-onboarding"?: string;
  language: "en" | "ar";
  size: "default" | "sm" | "lg";
  variant: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  className: string;
  wrapClassName?: string;
  loading: boolean;
  assessLimitBlocked: boolean;
  ctaFormBlocked: boolean;
  ctaBlockReason: CtaBlockReason;
  compact?: boolean;
  /** Pre-Submit Scanner (student) — Arabic-first labels + pulsing CTA when idle. */
  branding?: "default" | "scanner";
};

function toAnalyticsReason(
  r: CtaBlockReason,
  limit: boolean,
): AssessmentCtaBlockReason | "loading" | null {
  if (limit) return "limit";
  if (r === "uploading") return "uploading";
  if (r === "missing_answer") return "missing_answer";
  if (r === "academic_incomplete") return "academic_incomplete";
  if (r === "needs_confirmation") return "needs_confirmation";
  return null;
}

function tooltipBody(language: "en" | "ar", limit: boolean, reason: CtaBlockReason): string {
  if (limit) {
    return language === "en"
      ? "You have reached your monthly assessment limit. Upgrade to continue."
      : "لقد وصلتَ إلى الحد الشهري للتقييمات. ترقّ للمتابعة.";
  }
  if (reason === "uploading") {
    return language === "en"
      ? "Wait until file text extraction finishes."
      : "انتظر حتى ينتهي استخراج نص الملف…";
  }
  if (reason === "missing_answer") {
    return language === "en"
      ? "Add your answer or upload files to start"
      : "أضف نص الحل أو ارفع الملفات لبدء التقييم";
  }
  if (reason === "academic_incomplete") {
    return language === "en"
      ? "Select class, term, and subject first."
      : "اختر الصف الدراسي والفصل والمادة أولاً.";
  }
  if (reason === "needs_confirmation") {
    return language === "en"
      ? "High local similarity: check the box to proceed."
      : "تشابه محلي مرتفع: وافق من خانة الاختيار للمتابعة.";
  }
  return language === "en" ? "Start assessment" : "ابدأ التقييم";
}

export function AssessmentCtaButton(p: Props) {
  const {
    source,
    id,
    name,
    "data-onboarding": dataOnboarding,
    language,
    size,
    variant,
    className,
    wrapClassName,
    loading,
    assessLimitBlocked,
    ctaFormBlocked,
    ctaBlockReason,
    compact,
    branding = "default",
  } = p;

  const blocked = assessLimitBlocked || ctaFormBlocked;
  const canClick = !blocked && !loading;
  const tip = tooltipBody(language, assessLimitBlocked, ctaBlockReason);
  const ic = compact ? "h-4 w-4" : "h-5 w-5";

  const onOverlayClick = () => {
    trackAssessmentCtaClick({
      source,
      blocked: true,
      reason: assessLimitBlocked ? "limit" : toAnalyticsReason(ctaBlockReason, false) ?? "none",
    });
  };

  const isScanner = branding === "scanner";

  const body = (() => {
    if (loading) {
      return (
        <>
          <Loader2 className={cn("shrink-0 animate-spin", ic)} />
          <span className="ms-2 text-sm font-medium opacity-80">
            {isScanner
              ? language === "en"
                ? "Scanning your work…"
                : "جاري المسح…"
              : language === "en"
                ? "Analyzing…"
                : "جاري التقييم…"}
          </span>
        </>
      );
    }
    if (assessLimitBlocked) {
      return (
        <>
          {isScanner ? <Radar className={cn("shrink-0", ic)} /> : <ClipboardCheck className={cn("shrink-0", ic)} />}
          <span className="mx-2 text-center">{language === "en" ? "Monthly limit reached" : "وصلت للحد الشهري"}</span>
        </>
      );
    }
    if (ctaBlockReason === "needs_confirmation") {
      return (
        <>
          <ClipboardCheck className={cn("shrink-0", ic)} />
          <span className="mx-2">{language === "en" ? "Review similarity first" : "راجع التشابه أولاً"}</span>
          <ArrowRight className={cn("shrink-0", ic)} />
        </>
      );
    }
    if (ctaBlockReason === "missing_answer") {
      return (
        <>
          {isScanner ? <Radar className={cn("shrink-0", ic)} /> : <ClipboardCheck className={cn("shrink-0", ic)} />}
          <span className="mx-2">
            {isScanner
              ? language === "en"
                ? "Add your answer to start the scan"
                : "أضف إجابتك لبدء الفحص"
              : language === "en"
                ? "Add your answer to start"
                : "أضف الإجابة للبدء"}
          </span>
        </>
      );
    }
    if (ctaBlockReason === "academic_incomplete") {
      return (
        <>
          {isScanner ? <Radar className={cn("shrink-0", ic)} /> : <ClipboardCheck className={cn("shrink-0", ic)} />}
          <span className="mx-2">
            {isScanner
              ? language === "en"
                ? "Select class, term & subject first"
                : "أكمل الصف والفصل والمادة أولاً"
              : language === "en"
                ? "Complete academic path"
                : "أكمل المسار الأكاديمي"}
          </span>
        </>
      );
    }
    if (ctaBlockReason === "uploading") {
      return (
        <>
          <Loader2 className={cn("shrink-0 animate-spin", ic)} />
          <span className="mx-2">{language === "en" ? "Extracting…" : "جاري الاستخراج…"}</span>
        </>
      );
    }
    if (isScanner) {
      return (
        <>
          <Radar className={cn("shrink-0", ic)} />
          <span className="mx-2 text-pretty">
            {language === "en" ? "🚀 Start pre-submit scan" : "🚀 بدء الفحص المسبق للواجب"}
          </span>
          <ScanSearch className={cn("shrink-0", ic)} />
        </>
      );
    }
    return (
      <>
        <ClipboardCheck className={cn("shrink-0", ic)} />
        <span className="mx-2">{language === "en" ? "Start assessment" : "ابدأ التقييم"}</span>
        <ArrowRight className={cn("shrink-0", ic)} />
      </>
    );
  })();

  const buttonEl = (
    <Button
      id={id}
      data-onboarding={dataOnboarding}
      name={name}
      type="submit"
      size={size}
      variant={variant}
      disabled={!canClick}
      aria-busy={loading}
      className={className}
    >
      {body}
    </Button>
  );

  if (loading || canClick) {
    return <span className={wrapClassName}>{buttonEl}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("relative inline-flex w-full max-w-3xl justify-center", wrapClassName)}>
          <span
            role="presentation"
            className="absolute inset-0 z-20 cursor-not-allowed bg-transparent"
            onClick={onOverlayClick}
            tabIndex={-1}
            aria-hidden
          />
          {buttonEl}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-xs border border-amber-500/30 bg-slate-950/98 text-slate-100"
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
