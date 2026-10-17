import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fitwise.vercel.app";

const title = "Fitwise — see how well your resume fits the job";

const description =
  "Check a resume against a job posting: deterministic keyword coverage, an ATS parse check and a bullet linter that run instantly, plus AI evidence that is verified against your own words. Free, no account, nothing stored.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · Fitwise",
  },
  description,
  applicationName: "Fitwise",
  keywords: [
    "resume checker",
    "ATS resume check",
    "resume keyword match",
    "job description match",
    "cover letter generator",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Fitwise",
    title,
    description,
    url: siteUrl,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

/* Runs before first paint so the saved theme is applied without a flash.
   Wrapped in try/catch because localStorage throws in some privacy modes. */
const themeScript = `(function(){try{var s=localStorage.getItem("fitwise-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.dataset.theme=s==="light"||s==="dark"?s:(d?"dark":"light");}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by the proxy (src/proxy.ts); the theme script must carry it to run under the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jakarta.variable} h-full antialiased`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-4 z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
