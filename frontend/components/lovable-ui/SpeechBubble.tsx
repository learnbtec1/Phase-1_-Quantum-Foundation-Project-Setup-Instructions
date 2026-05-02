import React from "react";
import { cn } from "@/lib/utils";

interface SpeechBubbleProps {
  text: string;
  position?: "left" | "right";
  isAnimating?: boolean;
  className?: string;
}

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({
  text,
  position = "left",
  isAnimating = true,
  className = "",
}) => {
  const isRTL = position === "right";

  return (
    <div
      className={cn(
        "relative inline-block max-w-xs animate-fade-in",
        isRTL ? "text-right" : "text-left",
        className,
      )}
    >
      {/* Bubble container */}
      <div
        className={cn(
          "px-5 py-3 rounded-2xl bg-primary text-primary-foreground text-sm font-medium leading-relaxed shadow-lg",
          isRTL
            ? "rounded-br-none mr-4"
            : "rounded-bl-none ml-4",
          isAnimating && "animate-fade-in",
        )}
      >
        {text}
      </div>

      {/* Tail - left side */}
      {!isRTL && (
        <div className="absolute bottom-1 left-0 translate-x-[-8px] flex gap-1">
          <div className="w-2 h-2 rounded-full bg-primary opacity-70" />
          <div className="w-2 h-2 rounded-full bg-primary opacity-50" />
        </div>
      )}

      {/* Tail - right side */}
      {isRTL && (
        <div className="absolute bottom-1 right-0 translate-x-[8px] flex gap-1 flex-row-reverse">
          <div className="w-2 h-2 rounded-full bg-primary opacity-70" />
          <div className="w-2 h-2 rounded-full bg-primary opacity-50" />
        </div>
      )}
    </div>
  );
};

export default SpeechBubble;
