# Security

Fitwise is a stateless Next.js app: a visitor uploads a resume, the server
extracts its text, and the AI routes send that text (plus an optional job
posting) to Google Gemini. There is no database and no user account.

## Threat model

| Threat | What could happen | Mitigation |
| --- | --- | --- |
| **Proxy abuse** | Someone uses the deployment as a free Gemini endpoint, spending the project's quota. | Every `/api/*` request passes the guard in `src/proxy.ts` (`src/lib/http/api-guard.ts`). State-changing requests must come from this site (`Sec-Fetch-Site: same-origin`/`none`, or an `Origin` matching the host). Per-IP rate limits apply per route: AI routes 10/min and 60/day, extract 20/min. A refusal is JSON `{ error, code }` with status 403/413/429 and `Retry-After`. |
| **Prompt injection** | Resume or posting text tries to steer the model ("ignore previous instructions..."). | Documents go in as material in the conversation, never in the system prompt. The model has no tools, no secrets and no side effects, so the worst case is a misleading answer to the person who uploaded the text. The chat route accepts only `user`/`assistant` roles with no extra fields, requires the final turn to be the user's, and caps turn count, turn length and total history size. |
| **Hidden text** | White-on-white or tiny text in a PDF games the match score or carries injected instructions. | Extraction detects hidden text (tiny or white fonts, off-page or invisible PDF text, hidden Word runs) and screener-directed instructions, and the ATS card shows it to the user as an Integrity problem. The workspace sends an `integrity` flag with hidden-text samples to `/api/analyze`, which also re-scans the text server-side; when either fires, the analysis prompt tells the model the text was detected and must not be credited or followed. Data blocks are nonce-fenced and the prompts treat the documents as data. The score itself is computed in code, so injected text cannot set it directly. |
| **Upload attacks** | Oversized, malformed or disguised files exhaust memory or exploit a parser. | Declared size is checked in the proxy (4 MB + multipart overhead) and again in the route. File type is checked by content (magic bytes), not by name. Parsing runs in a short-lived serverless function with a time limit. |
| **XSS / clickjacking** | Injected script reads the resume in the page, or the app is framed. | A per-request nonce CSP with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'` (plus `X-Frame-Options: DENY`), `nosniff`, a strict `Referrer-Policy`, a deny-all `Permissions-Policy`, COOP `same-origin`, and HSTS in production. API responses carry `default-src 'none'` and `Cache-Control: no-store`. Model output is rendered as text, not HTML. |
| **Secret exposure** | The Gemini key reaches the browser. | The key is read only in server code (`server-only`); `/api/status` reports whether a key exists and the model name, never the key. |

## Data retention

- **No database.** Nothing is written to persistent storage.
- **The resume is never stored server-side.** The uploaded file is parsed in
  memory and discarded when the request ends; the extracted text is returned to
  the browser and lives only in the visitor's session there.
- Text sent for analysis or chat goes to Google Gemini under Google's API terms.
  Nothing is logged beyond the platform's default request logs (method, path,
  status); route code does not log request bodies.
- Rate-limit counters hold only `route:ip` keys with a count, and expire at the
  end of their window.

## Rate limiting

The limiter (`src/lib/rate-limit.ts`) is a fixed-window counter behind a store
interface.

- **Default: in-memory.** Each serverless instance counts separately, and
  counters reset when an instance is recycled. This stops a runaway client but
  is not a global guarantee: a determined caller hitting many instances gets
  more than the nominal budget.
- **Upstash Redis (recommended for production).** Set both variables and every
  instance shares the same counters:

  ```
  UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
  UPSTASH_REDIS_REST_TOKEN=<rest token>
  ```

  Create a free database at upstash.com (or via the Vercel Marketplace, which
  sets these variables for you), copy the REST URL and token into the Vercel
  project's environment variables, and redeploy. The store calls the REST
  pipeline endpoint with plain `fetch` (`INCR` + `PEXPIRE`), so there is no SDK
  dependency. If Upstash errors or times out (1.5 s), the guard falls back to
  in-memory counting for that request rather than failing or going unlimited.

Optional tuning variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_RATE_LIMIT_PER_MINUTE` | 10 | Per IP, per AI route (`analyze`, `chat`, `cover-letter`, `rewrite`) |
| `AI_RATE_LIMIT_PER_DAY` | 60 | Per IP, per AI route |
| `EXTRACT_RATE_LIMIT_PER_MINUTE` | 20 | Per IP, for `/api/extract` |

Client IP comes from `x-vercel-forwarded-for`, then `x-real-ip`, then the first
`x-forwarded-for` hop. On Vercel the first two are set by the platform.

### Vercel WAF rule (alternative or extra layer)

On any plan, the Vercel Firewall can rate-limit before the function runs, which
also saves function invocations:

1. Project → **Firewall** → **Configure** → **New Rule**.
2. If: *Request Path* *starts with* `/api/analyze` (add an OR condition for
   `/api/chat`, and any other AI route).
3. Then: **Rate Limit**, fixed window, 60 s, 10 requests, keyed by **IP**,
   action **Too Many Requests (429)**.
4. Save and publish. Add a second rule for `/api/extract` at 20/min if wanted.

The WAF's 429 is not this app's JSON, but the client already handles that:
`messageForFailure()` maps a bare 429 to a "too many requests" message.

## Reporting

Report a vulnerability privately to the maintainers rather than opening a
public issue.
