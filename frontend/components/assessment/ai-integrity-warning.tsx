"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/lovable-ui/ui/button";
import { Checkbox } from "@/components/lovable-ui/ui/checkbox";
import type { CheckedState } from "@radix-ui/react-checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/lovable-ui/ui/dialog";

export interface AIIntegrityWarningProps {
  onAccept: () => void;
  isLoading?: boolean;
  buttonText?: string;
  disabled?: boolean;
}

export function AIIntegrityWarning({
  onAccept,
  isLoading,
  buttonText = "تحسين النص ذكياً",
  disabled,
}: AIIntegrityWarningProps) {
  const [accepted, setAccepted] = useState(false);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setAccepted(false);
    }
  };

  const handleConfirm = () => {
    setOpen(false);
    setAccepted(false);
    onAccept();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="gap-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
        >
          <ShieldCheck className="h-4 w-4 shrink-0" />
          {buttonText}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(90dvh,640px)] overflow-y-auto sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            تحذير النزاهة الأكاديمية (BTEC)
          </DialogTitle>
          <DialogDescription className="space-y-3 pt-3 text-sm leading-relaxed text-foreground/80">
            <p>
              حسب سياسات Pearson BTEC الصارمة، يُمنع استخدام الذكاء الاصطناعي لتوليد أفكار الواجب أو كتابته
              بالنيابة عنك (Malpractice).
            </p>
            <p>
              <span className="font-semibold text-foreground/90">ملاحظة:</span> هذه الأداة مبرمجة تقنياً لضبط
              الصياغة وتحسينها بنسبة لا تتجاوز 30% للحفاظ على بصمتك الشخصية. سيتم تسجيل استخدامك لهذه الأداة في
              سجلات المنصة.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 py-4">
          <Checkbox
            id="ai-integrity-terms"
            checked={accepted}
            onCheckedChange={(c: CheckedState) => setAccepted(c === true)}
            className="mt-1"
            aria-label="قبول شروط استخدام أداة التحسين"
          />
          <label
            htmlFor="ai-integrity-terms"
            className="text-sm font-medium leading-snug text-foreground/90 peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            أُقر بأن الأفكار الموجودة في النص هي من مجهودي الشخصي، وأوافق على استخدام الأداة للتدقيق
            اللغوي والصياغي فقط.
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            type="button"
            disabled={!accepted || isLoading}
            onClick={handleConfirm}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {isLoading ? "جاري التحسين…" : "أوافق، قم بتحسين النص"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
