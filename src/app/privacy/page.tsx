import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How your data is handled",
  description:
    "What happens to your resume when you use Fitwise: what is sent where, what is kept in your browser, and what is never stored.",
};

const sections = [
  {
    heading: "Your resume file is never stored",
    body: [
      "When you upload a PDF or DOCX, it is sent to this application's own server, parsed in memory, and discarded as soon as the text has been extracted. There is no database, no object storage and no file system write. The response that carries the text back is marked no-store so it is not cached along the way.",
      "The ATS parse check and the bullet check run on that extracted text with fixed rules. They involve no AI and send nothing anywhere else.",
      "The extracted text, the checks and any analysis then live in your browser's sessionStorage. They survive a refresh; they do not survive closing the tab. Clear everything removes them immediately.",
    ],
  },
  {
    heading: "What is sent to Google Gemini, and when",
    body: [
      "Nothing reaches an AI provider when you upload a file or paste a posting. Text leaves this application only when you press a button that asks for an AI feature: Analyze, a message to the assistant, Generate cover letter, or Generate rewrites. Each request goes to Google's Gemini API from this application's server, so your browser never holds an API key.",
      "What is sent: your resume text and, where the feature uses it, the job description. An analysis also sends the ATS readiness number and, if hidden text was found in your file, a short sample of it so the model can be told to ignore it. A cover letter or rewrite request may include a short summary of your analysis (matched and missing skills) to steer emphasis. In the assistant, including the job description is a checkbox you control.",
      "Google's handling of that data is governed by its own terms. On the free tier of the Gemini API, Google states that prompts may be used to improve its products. If that matters to you, use a paid-tier key on your own deployment, or remove identifying details from your resume before uploading.",
    ],
  },
  {
    heading: "History is opt-in and stays in this browser",
    body: [
      "History & compare is off until you turn it on. When it is on, each analysis you choose to save is kept in this browser's localStorage so you can compare postings later. Nothing about it is sent to a server.",
      "A saved entry holds the job posting text, the role title, the scores, the missing keywords and your resume's file name. It does not hold your resume text: only a short fingerprint of it, so entries scored against different resumes can be told apart.",
      "Turning history off deletes every saved entry. You can also export it to a JSON file and import it on another browser.",
    ],
  },
  {
    heading: "What is logged",
    body: [
      "Resume text, job descriptions, chat messages, generated letters and API keys are never written to logs. Error paths are deliberately written not to echo request bodies, because provider error envelopes can contain the prompt, and the prompt contains your resume.",
      "To stop the service being used as a free AI endpoint, requests are counted per IP address in short fixed windows (per minute and per day). The counters hold only a route name, an address and a number, and expire with their window. If the deployment uses Upstash Redis for shared counters, the same short-lived keys are stored there.",
    ],
  },
  {
    heading: "No account, no tracking",
    body: [
      "There is no sign-up, no email collection and no analytics script. Nothing identifies you across sessions. Your light or dark theme choice is the only other thing kept in localStorage.",
    ],
  },
  {
    heading: "What the score is",
    body: [
      "The match score is computed in code: 40% deterministic keyword coverage, 45% requirement evidence (the model judges each requirement met, partial or not evident, and code turns those judgements into a number), and 15% ATS readiness. It measures how much of what the posting asks for is visibly supported by your resume. It is not a hiring probability, and no employer sees it.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1 py-16 sm:py-20">
        <div className="container-app max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Privacy
          </p>
          <h1 className="mt-6 font-display text-[2.25rem] font-bold leading-[1.1] sm:text-[2.75rem]">
            How your data is handled
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            A resume is a sensitive document. Here is exactly what Fitwise does with yours.
          </p>

          <div className="mt-12 divide-y divide-border-subtle border-t border-border-subtle">
            {sections.map((section) => (
              <section
                key={section.heading}
                className="grid gap-x-12 gap-y-4 py-9 sm:grid-cols-3"
              >
                <h2 className="font-display text-lg font-semibold sm:col-span-1">
                  {section.heading}
                </h2>
                <div className="space-y-4 sm:col-span-2">
                  {section.body.map((paragraph) => (
                    <p
                      key={paragraph.slice(0, 40)}
                      className="leading-relaxed text-muted-foreground"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
