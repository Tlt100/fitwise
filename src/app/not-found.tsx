import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex flex-1 items-center py-20">
        <div className="container-app max-w-xl space-y-5 text-center">
          <p className="font-display text-6xl font-extrabold text-muted-foreground">
            404
          </p>
          <h1 className="font-display text-2xl font-bold">
            There is nothing at this address
          </h1>
          <p className="text-muted-foreground">
            If you were partway through an analysis, your session is still open — head
            back to the workspace.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/analyze">Back to the workspace</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Home</Link>
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
