"use client";

import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import Link from "next/link";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="flex flex-1 items-center py-20">
      <div className="container-app max-w-xl space-y-5 text-center">
        <h1 className="font-display text-2xl font-bold">Something broke on this page</h1>
        <p className="text-muted-foreground">
          Your session is held in this browser tab, so your resume and any analysis
          should still be here after retrying. Nothing was sent anywhere as a result of
          this error.
        </p>
        {/* The error message itself is not rendered: it can contain request
            details, and request bodies here contain resume text. */}
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back to the start</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
