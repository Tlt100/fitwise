import { Skeleton } from "@/components/ui/skeleton";

export default function AnalyzeLoading() {
  return (
    <div className="container-app max-w-5xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-52 w-full rounded-xl" />
      <span className="sr-only" role="status">
        Loading your workspace
      </span>
    </div>
  );
}
