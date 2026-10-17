import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import Link from "next/link";

export function SiteHeader({ showCta = true }: { showCta?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/85 backdrop-blur">
      <div className="container-app flex h-16 items-center justify-between gap-4">
        <Link href="/" className="rounded-md" aria-label="Fitwise home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/privacy"
            className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            Privacy
          </Link>
          <ThemeToggle />
          {showCta ? (
            <Button asChild size="sm">
              <Link href="/analyze">Check a resume</Link>
            </Button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
