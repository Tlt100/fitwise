import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SessionProvider } from "@/lib/session/session-context";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Analyze a resume",
  description:
    "Upload a resume for instant ATS and bullet checks, paste a job description, and see how well the two fit.",
};

export default function AnalyzeLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SiteHeader showCta={false} />
      <main id="main" className="flex-1 py-8 sm:py-10">
        {children}
      </main>
      <SiteFooter />
    </SessionProvider>
  );
}
