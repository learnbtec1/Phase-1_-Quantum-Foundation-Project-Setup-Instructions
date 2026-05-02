import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-pulse-shimmer", className)}
      {...props}
    />
  );
}

export { Skeleton };
