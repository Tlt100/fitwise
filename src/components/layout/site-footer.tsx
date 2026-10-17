import { Logo } from "@/components/layout/logo";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border-subtle bg-surface">
      <div className="container-app flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md space-y-3">
          <Logo />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your resume stays in your browser for the length of your session. It is
            sent to Google&apos;s Gemini API only when you ask for an AI feature, and
            it is never written to a database or a log. History is off unless you
            turn it on, and then it lives only in this browser.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <Link href="/analyze" className="text-muted-foreground hover:text-foreground">
            Check a resume
          </Link>
          <Link href="/#how-the-score-works" className="text-muted-foreground hover:text-foreground">
            How the score works
          </Link>
          <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
            How your data is handled
          </Link>
          <p className="pt-2 text-xs text-muted-foreground">
            The score measures evidence on the page. It is not a hiring prediction.
          </p>
        </div>
      </div>
    </footer>
  );
}
