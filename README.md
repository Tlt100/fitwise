# Fitwise

**Live:** <https://fitwise-gamma.vercel.app>

**See how well your resume fits a job, with the evidence.** Upload a resume, paste a job
posting, and Fitwise tells you which of the posting's keywords you cover, whether an
applicant tracking system can parse your file, which bullets are weak, and which
requirements your resume actually shows evidence for. Every AI finding quotes a line you
wrote, and those quotes are checked in code. It rewrites; it never invents.

- **Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Vitest
- **AI provider:** Google Gemini, called server-side with structured JSON output
- **Deploys to:** Vercel, with no database and no accounts

---

## Features

| Feature | Needs an API key? | What it does |
| --- | --- | --- |
| **Keyword coverage** | No | Extracts the posting's skills and tools and matches them against the resume in code, including variants (`k8s` for Kubernetes). Required terms weigh more than preferred ones. |
| **ATS readiness check** | No | Runs on upload. Flags multi-column layouts, tables and text boxes, contact details in headers/footers, non-standard headings, inconsistent dates, icon fonts and length. Scores 0–100. |
| **Bullet linter** | No | Runs on upload. Scores each bullet for a strong opening verb and a measurable result and lists the weakest with a rewrite shape. |
| **Hidden-text integrity check** | No | Detects white/tiny/off-page text and instructions aimed at AI screeners. They are shown to the user and the AI is told not to credit or follow them. |
| **Verified AI analysis** | Yes | Requirement-by-requirement judgement (met / partial / not evident) with quotes from the resume. Quotes are verified against the text; rewrites whose original is not in the resume are dropped; rewrites that add numbers are flagged. |
| **Draft workshop** | Yes (needs an analysis) | Accept, edit or reject each suggested bullet, add a rewritten summary, and export a revised DOCX or PDF in the browser. |
| **Assistant** | Yes | Chat about the resume and posting, grounded in both. |
| **Cover letter** | Yes | A first draft in a chosen tone and length, built from what the resume evidences. |
| **Summary and LinkedIn rewrites** | Yes | Resume summary, LinkedIn headline and About variants, each checked for unsupported claims. |
| **History & compare** | No | Opt-in, browser-only history of past results, with side-by-side comparison of postings and recurring gaps. Export/import as JSON. |

Without `GEMINI_API_KEY` the app still builds and runs: upload, extraction, the ATS check
and the bullet linter all work, and the AI features say they are unconfigured.

---

## How the score works

The headline number is computed in code (`src/lib/match/score.ts`). The model never
supplies it.

```
composite = 40% keyword coverage + 45% requirement evidence + 15% ATS readiness
```

- **Keyword coverage (40%)**: weighted share of the posting's terms the resume shows
  (exact match 1, variant 0.8, missing 0), weighted by how often and where each term
  appears in the posting.
- **Requirement evidence (45%)**: the model marks each stated requirement met, partial or
  not evident, and code turns that into a number: importance critical 3 / important 2 /
  nice-to-have 1, credit met 1 / partial 0.5 / not evident 0.
- **ATS readiness (15%)**: the deterministic parse check, 0–100.

A part that cannot be measured is left out and the remaining weights are renormalised.

**It is not a hiring probability.** It measures how much of what the posting asks for is
visibly supported by the resume. It is most useful as a comparison between postings.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # then paste your key into GEMINI_API_KEY
npm run dev
```

Open <http://localhost:3000>.

### Getting a Gemini key

1. Go to <https://aistudio.google.com/apikey> and create a key (free, no billing needed).
2. Put it in `.env.local` as `GEMINI_API_KEY=...`.
3. Restart `npm run dev`.

Free-tier Flash models are rate-limited per minute and per day, and the newest ones return
503 "high demand" fairly often. If a model is unavailable the app falls through to the next
verified one automatically; if the quota is exhausted it says so specifically.

---

## Environment variables

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | For AI features | — | Server-side Gemini key. Never exposed to the browser. |
| `GEMINI_MODEL` | No | `gemini-3.5-flash` | Overrides the model. Verified options: `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. |
| `GEMINI_BASE_URL` | No | Google's endpoint | Points the client at a stand-in. Local testing only (see below). |
| `AI_RATE_LIMIT_PER_MINUTE` | No | `10` | Requests per IP per minute, per AI route (`analyze`, `chat`, `cover-letter`, `rewrite`). |
| `AI_RATE_LIMIT_PER_DAY` | No | `60` | Requests per IP per day, per AI route. |
| `EXTRACT_RATE_LIMIT_PER_MINUTE` | No | `20` | Uploads per IP per minute against `/api/extract`. |
| `UPSTASH_REDIS_REST_URL` | No | — | With the token below, rate-limit counters are shared across all instances. Recommended for production. |
| `UPSTASH_REDIS_REST_TOKEN` | No | — | REST token for the Upstash database above. |
| `NEXT_PUBLIC_SITE_URL` | No | `https://fitwise.vercel.app` | Canonical URL for social metadata, `robots.txt` and the sitemap. |

`.env.example` holds placeholders only. `.env.local` is gitignored; never commit a key.

---

## Deploying to Vercel

1. Push the repository to GitHub.
2. Go to <https://vercel.com/new> and **import** the repository. The framework is detected
   as Next.js; no build settings need changing.
3. Under **Environment Variables**, add `GEMINI_API_KEY` (Production and Preview). Optionally
   add `NEXT_PUBLIC_SITE_URL` with your production URL, and the Upstash variables for
   shared rate limits (the Upstash integration in the Vercel Marketplace sets them for you).
4. **Deploy.** API routes become serverless functions. `/api/analyze`, `/api/chat`,
   `/api/cover-letter` and `/api/rewrite` declare a 60-second `maxDuration` and
   `/api/extract` 30 seconds, which fits the Hobby plan.

If you deploy without the key, the site still builds and serves, and the instant checks
work.

---

## Security

Read [`docs/security.md`](docs/security.md) for the threat model. In short:

- `src/proxy.ts` guards every `/api/*` request: state-changing requests must be
  same-origin (`403` with code `forbidden-origin` otherwise), bodies are size-checked, and
  per-IP minute and day limits apply (`429` with code `rate-limited` and `Retry-After`).
  Routes keep their own limits as a second layer.
- Pages carry a per-request nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`,
  `nosniff`, a strict referrer policy and HSTS in production.
- Resume and posting text is fenced with a per-request random nonce in every prompt and
  treated as data. Hidden text and screener-directed instructions are detected and the
  model is told not to credit or follow them.
- The Gemini key is read only in `server-only` code. Nothing is stored server-side and
  request bodies are never logged.

---

## Architecture

```
src/
  app/
    page.tsx                  landing page
    privacy/                  what happens to your data, in plain terms
    analyze/                  the workspace (session provider + tabs)
    api/
      extract/                PDF & DOCX -> text + meta + ATS report + bullet lint
      analyze/                resume + posting -> verified analysis, match, composite score
      chat/                   assistant turns
      cover-letter/           cover letter drafts
      rewrite/                summary / LinkedIn rewrites
      status/                 "is a key configured?" for honest UI states
  proxy.ts                    CSP nonce + API guard (origin, size, rate limits)
  components/
    ui/                       Button, Card, Badge, Textarea, Alert, Disclosure, theme toggle
    layout/                   header, footer, logo
    checks/                   ATS report card, bullet lint card
    features/                 cover letter, rewrites, history and compare panels
    results/                  score visualisation and the results dashboard
    workspace/                upload, job description, tabs, assistant, draft workshop
  lib/
    ai/                       Gemini client, prompts, schemas, grounding verification
    ats/                      ATS checks, sections, dates, hidden-text/injection detection
    lint/                     bullet linter
    match/                    keyword extraction, stemming, composite score
    extract/                  file sniffing, PDF/DOCX parsing, normalisation
    export/                   draft assembly, DOCX and PDF export
    history/                  opt-in localStorage history and comparison
    http/                     API guard, error reading, request validation
    session/                  browser-session state
    rate-limit.ts             fixed-window limiter (memory or Upstash)
```

### Data flow

1. The file is posted to `/api/extract`, parsed **in memory** with `unpdf` or `mammoth`,
   and discarded. The text comes back with layout metadata, the ATS report and the
   bullet lint, which the workspace shows immediately.
2. That state lives in `sessionStorage`: it survives a refresh and is gone when the tab
   closes.
3. Nothing reaches Google until the user presses a button that needs AI.
4. `/api/analyze` computes the keyword match in code, hands it to Gemini as facts, validates
   the structured reply, verifies its quotes against the resume, and composes the score.

### Testing the AI routes without a key

`scripts/gemini-stub.mjs` stands in for the Gemini API so every AI route can be driven end
to end, including the failure paths.

```bash
node scripts/gemini-stub.mjs ok        # or: quota | badkey | garbage | flaky
```

Then run the app with:

```
GEMINI_API_KEY=stub
GEMINI_BASE_URL=http://localhost:4010/models
```

### Design

The visual language is documented in [`docs/design-system.md`](docs/design-system.md):
navy and blue on slate, Plus Jakarta Sans and Inter, light and dark themes, and green /
amber / red reserved for evidence found / weak / missing.

---

## Scripts

```bash
npm run dev         # development server
npm run build       # production build
npm run start       # serve the production build
npm test            # unit tests (vitest)
npm run lint        # eslint
npm run typecheck   # next typegen && tsc --noEmit
```

---

## Known limitations

- **Scanned PDFs don't work.** There is no OCR; a PDF with no text layer is rejected with
  an explanation.
- **Formatting is not preserved.** Exports carry text, not your layout; paste the draft back
  into your own template.
- **In-memory rate limits are per instance.** Without Upstash, each serverless instance
  counts separately. Set the Upstash variables for a shared limit.
- **Bullet matching is line-based.** A bullet that wraps across two lines in the source PDF
  may not be auto-placed; the draft lists it for manual pasting instead.
- **Free-tier prompts may be used by Google** to improve its products. That is Google's
  policy, stated on the privacy page.
- **Pages render dynamically** because the CSP issues a nonce per request.
