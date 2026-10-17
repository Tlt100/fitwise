/**
 * Local stand-in for the Gemini API, so the analyze and chat routes can be
 * exercised end to end without a key, a quota or a network round trip.
 *
 *   node scripts/gemini-stub.mjs [ok|quota|badkey|garbage|flaky]
 *
 * Then point the app at it:
 *   GEMINI_API_KEY=stub
 *   GEMINI_BASE_URL=http://localhost:4010/models
 *
 * The non-"ok" modes reproduce the provider failures the routes have to map to
 * user-facing messages: exhausted free-tier quota, a rejected key, a reply
 * that is not the JSON the schema promised, and ("flaky") a first reply that
 * fails validation followed by a good one, which exercises the route's single
 * retry. The sample analysis below is fixture data for that purpose only -- it
 * is never served by the app.
 *
 * In "ok" mode the stub reads the resume block out of the prompt and quotes a
 * real line from it as evidence and as a bullet to rewrite, so the grounding
 * checks see a verified quote, a paraphrase, a dropped rewrite (its original
 * is invented) and a rewrite that adds an unverified number.
 */
import { createServer } from "node:http";

function resumeLines(prompt) {
  const block = /<resume_[0-9a-f]+>\n([\s\S]*?)\n<\/resume_[0-9a-f]+>/.exec(prompt ?? "");
  const text = block ? block[1] : "";
  return text
    .split("\n")
    .map((line) => line.replace(/^[\s•*\-]+/, "").trim())
    .filter((line) => line.split(/\s+/).length >= 5);
}

function buildAnalysis(prompt) {
  const lines = resumeLines(prompt);
  const quoted = lines[0] ?? "Built a payments reconciliation service in Go";
  const bullet = lines[1] ?? quoted;
  return {
    roleTitle: "Backend Engineer, Payments",
    scoreRationale:
      "Core backend requirements are evidenced in your experience; the infrastructure tooling the posting names is not.",
    dimensions: [
      { name: "Skills", score: 78, summary: "The main language is shown in real work." },
      { name: "Experience", score: 70, summary: "About four years shown against five asked for." },
      { name: "Education & credentials", score: 80, summary: "A relevant degree is listed." },
      { name: "Keywords", score: 60, summary: "Several infrastructure terms are absent." },
    ],
    matchedSkills: [
      { skill: "Backend development", strength: "strong", evidence: quoted },
      // A paraphrase on purpose: the verifier should mark it unverified.
      { skill: "Leadership", strength: "moderate", evidence: "Led large cross-functional organisations through change" },
    ],
    missingSkills: [
      {
        skill: "Kubernetes",
        importance: "critical",
        note: "Named as the deployment target.",
        closestExperience: "Docker appears in the skills list.",
      },
    ],
    experienceAlignment: [
      { requirement: "5+ years backend", status: "partial", importance: "critical", explanation: "About four years shown." },
      { requirement: "Payments domain", status: "met", importance: "important", explanation: "Reconciliation work is shown." },
      { requirement: "Kubernetes in production", status: "not-evident", importance: "critical", explanation: "Not in the resume." },
      { requirement: "Rust", status: "not-evident", importance: "nice-to-have", explanation: "Listed as a plus; not shown." },
    ],
    resumeSuggestions: [
      { area: "Summary", title: "Lead with reconciliation", detail: "Move it up.", priority: "high" },
    ],
    bulletRewrites: [
      {
        section: "Experience",
        original: bullet,
        suggested: `${bullet.replace(/[.\s]+$/, "")}, cutting processing time by 40%`,
        rationale: "Tighter. The 40% is a placeholder: add the real figure if you have it.",
      },
      {
        section: "Experience",
        original: "Led the migration of forty services to Kubernetes at Initech",
        suggested: "Led a forty-service Kubernetes migration",
        rationale: "This original is invented and should be dropped by the verifier.",
      },
    ],
    keywords: [
      { keyword: "Kubernetes", presentInResume: true, guidance: "Only use if you have done this." },
      { keyword: "Go", presentInResume: true, guidance: "Already used." },
    ],
    interviewTopics: [
      { topic: "Reconciliation", why: "Strongest overlap.", questions: ["How did you handle duplicates?"] },
    ],
    actionPlan: [{ step: "Rewrite the summary", why: "Biggest gain.", effort: "quick" }],
  };
}

/** Cover letter: one grounded claim (a real resume line) and one invented one. */
function buildCoverLetter(prompt) {
  const quoted = resumeLines(prompt)[0] ?? "Built a payments reconciliation service in Go";
  return {
    paragraphs: [
      "Dear Hiring Manager,",
      `I am applying for this role. In my current work I ${quoted.charAt(0).toLowerCase()}${quoted.slice(1).replace(/[.\s]+$/, "")}.`,
      "I also managed a team of 12 engineers across three time zones.",
      "Thank you for your time and consideration.",
    ],
    claimsUsed: [
      { claim: quoted, resumeQuote: quoted },
      // Invented on purpose: the route should flag or remove it.
      { claim: "Managed a team of 12 engineers", resumeQuote: "Managed a team of 12 engineers" },
    ],
  };
}

/** Rewrite: three variants, the last one adding a number the resume lacks. */
function buildRewrite(prompt) {
  const quoted = resumeLines(prompt)[0] ?? "Built a payments reconciliation service in Go";
  return {
    variants: [
      { text: `Backend engineer. ${quoted}.`, resumeQuotes: [quoted] },
      { text: `Engineer focused on reliable services. ${quoted}.`, resumeQuotes: [quoted] },
      { text: "Engineer with 15 years of experience leading platform teams.", resumeQuotes: ["15 years"] },
    ],
    rationale: "The first leads with role, the second with focus; the third is invented to exercise the checks.",
  };
}

const mode = process.argv[2] ?? "ok";
let structuredCalls = 0;

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    const structured = Boolean(parsed.generationConfig?.responseSchema);
    console.log(
      `[stub] ${req.url} structured=${structured} contents=${parsed.contents?.length} temperature=${parsed.generationConfig?.temperature}`,
    );
    const send = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (mode === "quota") return send(429, { error: { message: "Quota exceeded for quota metric PerDay" } });
    if (mode === "badkey") return send(400, { error: { message: "API key not valid. Please pass a valid API key." } });
    if (mode === "garbage") return send(200, { candidates: [{ content: { parts: [{ text: "not json at all" }] } }] });

    let text;
    const props = parsed.generationConfig?.responseSchema?.properties ?? {};
    const prompt = parsed.contents?.[0]?.parts?.map((p) => p.text).join("\n");
    if (prompt?.includes("INTEGRITY WARNING")) console.log("[stub] prompt carries an integrity warning");
    if (structured && props.paragraphs) {
      text = JSON.stringify(buildCoverLetter(prompt));
    } else if (structured && props.variants) {
      text = JSON.stringify(buildRewrite(prompt));
    } else if (structured) {
      structuredCalls += 1;
      const analysis = buildAnalysis(prompt);
      // Missing the four dimensions: fails validation, so the route retries.
      text =
        mode === "flaky" && structuredCalls % 2 === 1
          ? JSON.stringify({ ...analysis, dimensions: analysis.dimensions.slice(0, 2) })
          : JSON.stringify(analysis);
    } else {
      text = "Lead with the reconciliation service: it is the closest thing you have to what they are asking for.";
    }
    send(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
  });
}).listen(4010, () => console.log(`[stub] listening on 4010 (mode: ${mode})`));
