import { LogoMark } from "@/components/layout/logo";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES, formatBytes } from "@/lib/limits";
import { SCORE_WEIGHTS } from "@/lib/match/score";
import {
  ArrowRight,
  FileSearch,
  GitCompareArrows,
  ListChecks,
  Lock,
  Mail,
  PenLine,
  ScanText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const steps = [
  {
    title: "Upload your resume",
    body: "A PDF or DOCX. The text is extracted in memory and handed back to your browser, and the ATS parse check and bullet check run straight away. No AI, no key, no waiting.",
  },
  {
    title: "Paste the job description",
    body: "The whole posting, requirements included. Fitwise reads which skills and tools it asks for, and which of them are stated as required.",
  },
  {
    title: "Get a score you can check",
    body: "Keyword coverage, requirement-by-requirement evidence quoted from your resume, and the fixes worth making first. Then draft a cover letter or rewrite your summary for the same role.",
  },
];

const features: Array<{ title: string; body: string; Icon: LucideIcon; ai: boolean }> = [
  {
    title: "Deterministic keyword coverage",
    body: "Every skill and tool in the posting is matched against your resume in code, with variants like k8s for Kubernetes. The same pair always gives the same answer.",
    Icon: FileSearch,
    ai: false,
  },
  {
    title: "ATS readiness check",
    body: "Flags what breaks real applicant tracking parsers: multi-column layouts, tables and text boxes, contact details in headers, odd headings, unreadable dates.",
    Icon: ScanText,
    ai: false,
  },
  {
    title: "Bullet linter",
    body: "Scores each bullet for a strong opening verb and a measurable result, and shows the weakest ones with a fill-in-the-blanks shape to rewrite them.",
    Icon: ListChecks,
    ai: false,
  },
  {
    title: "Verified AI evidence",
    body: "Each requirement is judged met, partial or not evident, with a quote from your resume. Quotes are checked against your text, and rewrites that add numbers you never wrote are flagged.",
    Icon: ShieldCheck,
    ai: true,
  },
  {
    title: "Cover letter drafts",
    body: "A first draft in your chosen tone and length, built from what your resume shows for this role, ready to edit and export.",
    Icon: Mail,
    ai: true,
  },
  {
    title: "Summary and LinkedIn rewrites",
    body: "Alternative resume summaries, LinkedIn headlines and About sections, each checked for claims your resume does not support.",
    Icon: PenLine,
    ai: true,
  },
  {
    title: "History and comparison",
    body: "Opt in to keep past results in this browser, then compare postings side by side to see which roles fit best and which gaps keep recurring.",
    Icon: GitCompareArrows,
    ai: false,
  },
  {
    title: "Private by design",
    body: "No account and no database. Your resume lives in your browser tab and is sent to the AI only when you press a button that needs it.",
    Icon: Lock,
    ai: false,
  },
];

const scoreParts = [
  {
    id: "keywords",
    label: "Keyword coverage",
    weight: SCORE_WEIGHTS.keywords,
    body: "Share of the posting's terms your resume shows, weighted by how often and where they appear. Exact match counts 1, a variant 0.8, missing 0.",
    swatch: "bg-secondary",
  },
  {
    id: "requirements",
    label: "Requirement evidence",
    weight: SCORE_WEIGHTS.requirements,
    body: "The model marks each stated requirement met, partial or not evident. Code converts that into a number, weighting critical requirements 3, important 2, nice-to-have 1.",
    swatch: "bg-primary",
  },
  {
    id: "ats",
    label: "ATS readiness",
    weight: SCORE_WEIGHTS.ats,
    body: "The parse check above, from 0 to 100. A file a parser cannot read loses points here, however good the content.",
    swatch: "bg-muted-foreground",
  },
];

const pct = (weight: number) => `${Math.round(weight * 100)}%`;

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="border-b border-border-subtle">
          <div className="container-app grid gap-x-16 gap-y-12 py-20 lg:grid-cols-12 lg:py-28">
            <div className="space-y-8 lg:col-span-7">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <LogoMark className="size-5" />
                Resume-to-job fit, with the evidence
              </p>
              <h1 className="max-w-3xl font-display text-[2.5rem] font-bold leading-[1.08] sm:text-5xl lg:text-[3.5rem]">
                Know how well your resume fits the job before you apply.
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                Fitwise checks your resume against a posting the way a careful
                recruiter and an applicant tracking system would: which keywords it
                covers, whether it parses cleanly, and which requirements it actually
                shows evidence for. Every finding points back to a line you wrote.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg">
                  <Link href="/analyze">
                    Check my resume
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
                <Link
                  href="#how-it-works"
                  className="rounded-sm px-1 py-2 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline sm:px-3"
                >
                  How it works
                </Link>
              </div>
            </div>

            {/* Specification panel. Plain facts about the tool: no invented
                metrics, no testimonials, nothing that needs a citation. */}
            <dl className="divide-y divide-border-subtle self-end border-t border-border-subtle text-sm lg:col-span-5">
              {[
                ["Accepts", `PDF and DOCX, up to ${formatBytes(MAX_FILE_BYTES)}`],
                ["Instant checks", "Keywords, ATS parsing, bullets"],
                ["AI model", "Google Gemini"],
                ["Account", "Not required"],
                ["Stored on a server", "Nothing"],
              ].map(([term, value]) => (
                <div key={term} className="flex items-baseline justify-between gap-6 py-3.5">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-it-works-heading"
          className="scroll-mt-16 border-b border-border-subtle py-20"
        >
          <div className="container-app grid gap-x-16 gap-y-10 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-4">
              <h2 id="how-it-works-heading" className="font-display text-2xl font-bold sm:text-3xl">
                How it works
              </h2>
              <p className="leading-relaxed text-muted-foreground">
                Three steps, about two minutes. The first two need no API key at all.
              </p>
            </div>
            <ol className="divide-y divide-border-subtle border-t border-border-subtle lg:col-span-8">
              {steps.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-4 py-6">
                  <span
                    aria-hidden
                    className="font-display text-sm font-semibold tabular-nums text-muted-foreground"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="space-y-1.5">
                    <h3 className="font-display text-lg font-semibold">{step.title}</h3>
                    <p className="max-w-xl leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features-heading" className="border-b border-border-subtle py-20">
          <div className="container-app space-y-12">
            <div className="max-w-2xl space-y-4">
              <h2 id="features-heading" className="font-display text-2xl font-bold sm:text-3xl">
                Everything you need for one application
              </h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                Generic resume advice is easy to find. Fitwise only tells you things
                that depend on your document and this posting, and it shows its working.
              </p>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ title, body, Icon, ai }) => (
                <li key={title} className="flex flex-col gap-3 bg-surface p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-lg bg-secondary/10 text-secondary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      {ai ? "Uses AI" : "No AI needed"}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How the score works */}
        <section
          id="how-the-score-works"
          aria-labelledby="score-heading"
          className="scroll-mt-16 border-b border-border-subtle py-20"
        >
          <div className="container-app grid gap-x-16 gap-y-10 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-4">
              <h2 id="score-heading" className="font-display text-2xl font-bold sm:text-3xl">
                How the score works
              </h2>
              <p className="leading-relaxed text-muted-foreground">
                The number is computed in code from three parts you can each check.
                The AI never gets to pick it.
              </p>
            </div>
            <div className="space-y-8 lg:col-span-8">
              <div className="space-y-3">
                <div
                  className="flex h-3 overflow-hidden rounded-full"
                  role="img"
                  aria-label={scoreParts.map((p) => `${p.label} ${pct(p.weight)}`).join(", ")}
                >
                  {scoreParts.map((part) => (
                    <div
                      key={part.id}
                      className={part.swatch}
                      style={{ width: pct(part.weight) }}
                    />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  Composite = {scoreParts.map((p) => `${pct(p.weight)} ${p.label.toLowerCase()}`).join(" + ")}
                </p>
              </div>

              <dl className="divide-y divide-border-subtle border-t border-border-subtle">
                {scoreParts.map((part) => (
                  <div key={part.id} className="grid gap-2 py-5 sm:grid-cols-[15rem_1fr] sm:gap-6">
                    <dt className="flex items-center gap-2 font-display font-semibold">
                      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${part.swatch}`} />
                      {part.label}
                      <span className="tabular-nums text-muted-foreground">{pct(part.weight)}</span>
                    </dt>
                    <dd className="leading-relaxed text-muted-foreground">{part.body}</dd>
                  </div>
                ))}
              </dl>

              <div className="space-y-3 rounded-xl border border-border-subtle bg-surface p-5 text-sm leading-relaxed text-muted-foreground">
                <p>
                  <strong className="text-foreground">It is not a hiring probability.</strong>{" "}
                  It measures how much of what the posting asks for is visibly supported
                  by your resume. No employer sees it, and a strong score does not
                  predict an interview.
                </p>
                <p>
                  If a part cannot be measured (a posting with no recognisable skills,
                  say) it is left out and the other weights are scaled up, so you are
                  never marked down for a check that did not run. The score is most
                  useful as a comparison: the same resume against two postings.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy-heading" className="border-b border-border-subtle py-20">
          <div className="container-app grid gap-x-16 gap-y-6 lg:grid-cols-12">
            <h2 id="privacy-heading" className="font-display text-2xl font-bold sm:text-3xl lg:col-span-4">
              Your resume stays yours
            </h2>
            <div className="space-y-4 text-muted-foreground lg:col-span-8">
              <p className="leading-relaxed">
                Files are parsed in memory and discarded. The text lives in your
                browser tab and disappears when you close it. It goes to Google&apos;s
                Gemini API only when you press a button that needs AI, and never to a
                database or a log.
              </p>
              <p className="leading-relaxed">
                History is off unless you turn it on, and then it is kept only in this
                browser, without your resume text.{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-secondary underline-offset-4 hover:underline"
                >
                  Read exactly what is sent where
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="py-20">
          <div className="container-app flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold">Ready when you are</h2>
              <p className="text-muted-foreground">
                Bring the posting you&apos;re about to apply for. The instant checks are free and need no key.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/analyze">
                Check my resume
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
