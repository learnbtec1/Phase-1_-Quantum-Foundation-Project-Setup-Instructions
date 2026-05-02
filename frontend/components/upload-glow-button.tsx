"use client";

import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  name?: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  children: React.ReactNode;
  className?: string;
  /** show upload icon (default true) */
  showIcon?: boolean;
};

/**
 * زر رفع بصري متوهّج + input[type=file] مربوط بـ label/htmlFor
 * عند الضغط تُفتح نافذة اختيار الملفات الأصلية للنظام (سطح المكتب).
 */
export function UploadGlowButton({
  id,
  name,
  accept,
  multiple = false,
  disabled = false,
  onChange,
  children,
  className,
  showIcon = true,
}: Props) {
  return (
    <label
      htmlFor={id}
      className={cn("btn-glow", disabled && "pointer-events-none opacity-50", className)}
    >
      {showIcon && <Upload className="h-4 w-4 shrink-0 opacity-90" aria-hidden />}
      {children}
      <input
        id={id}
        name={name}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={onChange}
      />
    </label>
  );
}
