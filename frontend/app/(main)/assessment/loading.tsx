import { Skeleton } from "@/components/lovable-ui/ui/skeleton";

/**
 * Reduces layout shift on the BTEC assessment route while the page shell loads.
 * Mirrors a generic card + criteria strip layout in 8px steps.
 */
export default function AssessmentLoading() {
  return (
    <div className="space-y-6" dir="rtl" aria-hidden>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-lg sm:h-9 sm:w-64" />
          <Skeleton className="h-4 w-full max-w-md rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>
      <div className="glass-card space-y-4 p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-8 w-40 rounded-lg" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <div className="flex gap-2">
              <Skeleton className="h-10 flex-1 rounded-lg" />
              <Skeleton className="h-10 w-20 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </div>
  );
}
