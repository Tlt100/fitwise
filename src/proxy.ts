import { guardApiRequest } from "@/lib/http/api-guard";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Request hook for every page and API request. (Next 16 renamed the
 * "middleware" file convention to "proxy"; it runs on the Node.js runtime and
 * cannot be configured otherwise.)
 *
 * API requests go through the central guard first: same-origin enforcement,
 * a body-size precheck and per-IP rate limits (see src/lib/http/api-guard.ts).
 * Routes get this without any changes of their own.
 *
 * Pages get a nonce-based Content Security Policy. A CSP without a
 * `script-src` falls back to `default-src`, which blocks every inline script —
 * including the framework's own bootstrap and the pre-paint theme script. So
 * the policy issues a fresh nonce per request, hands it to the framework
 * through the `x-nonce` request header (the root layout reads it for the theme
 * script), and uses 'strict-dynamic' so scripts loaded by trusted scripts are
 * allowed without listing every chunk.
 *
 * Development additionally needs 'unsafe-eval', which the bundler relies on for
 * hot reloading. Production gets the strict policy.
 */

/** JSON never needs to load anything or be framed. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

function pageCsp(nonce: string, isDev: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and next/font both emit inline style tags.
    "style-src 'self' 'unsafe-inline'",
    // data: for inline images, blob: for generated previews of exports.
    "img-src 'self' data: blob:",
    // next/font self-hosts at build time; gstatic stays as a harmless fallback.
    "font-src 'self' data: https://fonts.gstatic.com",
    // Gemini is called from the server, so the browser only talks to this origin.
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Not in development: it would try to upgrade http://localhost assets.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";

  if (request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname === "/api") {
    const refusal = await guardApiRequest(request, { isDev });
    if (refusal) {
      refusal.headers.set("content-security-policy", API_CSP);
      return refusal;
    }
    const response = NextResponse.next();
    response.headers.set("content-security-policy", API_CSP);
    return response;
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = pageCsp(nonce, isDev);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Every API request, unconditionally. It must not share the page entry's
    // prefetch exclusion, or adding a `purpose: prefetch` header would skip
    // the guard.
    "/api/:path*",
    // Every page request, but not static assets or the icon, which need no policy.
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
