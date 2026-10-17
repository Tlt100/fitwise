import { describe, expect, it } from "vitest";
import type { Analysis } from "@/lib/ai/analysis-schema";
import {
  appendReplyTo,
  applyAnalysis,
  mergeDecision,
  parseStoredSession,
  type AnalysisResult,
  type ChatMessage,
  type SessionState,
} from "./session-context";

const analysis = { experienceAlignment: [] } as unknown as Analysis;
const result: AnalysisResult = {
  analysis,
  match: { terms: [], coverage: {}, jdStructure: "sectioned" } as unknown as AnalysisResult["match"],
  score: { composite: 70, label: "Good alignment", components: [], formula: "" },
  verification: {
    evidenceChecked: 0,
    evidenceVerified: 0,
    rewritesChecked: 0,
    rewritesDropped: 0,
    rewritesWithNewNumbers: 0,
    keywordFlagsCorrected: 0,
  },
};

const base: SessionState = {
  resume: { name: "r.pdf", size: 10, kind: "pdf", text: "resume A", words: 2 },
  jobDescription: "posting edited after send",
  analysis: null,
  match: null,
  score: null,
  verification: null,
  analyzedAt: null,
  analyzedJobDescription: null,
  decisions: { "0": { status: "accepted" } },
  chat: [],
  shareContextWithAssistant: true,
  draftSummary: null,
};

describe("applyAnalysis", () => {
  it("records the posting that was sent, not the one in the box now", () => {
    const next = applyAnalysis(base, result, {
      resumeText: "resume A",
      jobDescription: "posting as sent",
    });
    expect(next.analysis).toBe(analysis);
    expect(next.score?.composite).toBe(70);
    expect(next.match).toBe(result.match);
    expect(next.verification).toBe(result.verification);
    expect(next.analyzedJobDescription).toBe("posting as sent");
    expect(next.decisions).toEqual({});
  });

  it("drops a result that arrives after the resume was replaced", () => {
    const swapped = { ...base, resume: { ...base.resume!, text: "resume B" } };
    const next = applyAnalysis(swapped, result, {
      resumeText: "resume A",
      jobDescription: "posting as sent",
    });
    expect(next).toBe(swapped);
  });

  it("drops a result that arrives after the resume was removed", () => {
    const cleared = { ...base, resume: null };
    expect(applyAnalysis(cleared, result, { resumeText: "resume A", jobDescription: "x" })).toBe(
      cleared,
    );
  });
});

describe("mergeDecision", () => {
  it("does not blank the suggestion when only the status changes", () => {
    expect(mergeDecision(undefined, { status: "rejected" })).toEqual({ status: "rejected" });
  });

  it("keeps an earlier edit when the status changes", () => {
    expect(mergeDecision({ status: "pending", edited: "mine" }, { status: "accepted" })).toEqual({
      status: "accepted",
      edited: "mine",
    });
  });

  it("keeps the status when only the text changes", () => {
    expect(mergeDecision({ status: "accepted" }, { edited: "new" })).toEqual({
      status: "accepted",
      edited: "new",
    });
  });
});

describe("appendReplyTo", () => {
  const question: ChatMessage = { id: "q1", role: "user", content: "?" };
  const reply: ChatMessage = { id: "a1", role: "assistant", content: "!" };

  it("appends a reply to a question still in the chat", () => {
    expect(appendReplyTo([question], reply, "q1")).toEqual([question, reply]);
  });

  it("discards a reply whose question was cleared", () => {
    const empty: ChatMessage[] = [];
    expect(appendReplyTo(empty, reply, "q1")).toBe(empty);
  });
});

describe("parseStoredSession", () => {
  it("returns null for missing or corrupt storage", () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession("{not json")).toBeNull();
    expect(parseStoredSession("null")).toBeNull();
    expect(parseStoredSession("[]")).toBeNull();
  });

  it("repairs fields with the wrong shape instead of crashing the render", () => {
    const parsed = parseStoredSession(JSON.stringify({ chat: "oops", jobDescription: 4 }));
    expect(parsed?.chat).toEqual([]);
    expect(parsed?.jobDescription).toBe("");
    expect(parsed?.shareContextWithAssistant).toBe(true);
  });

  it("restores a well-formed session", () => {
    expect(parseStoredSession(JSON.stringify(base))).toEqual(base);
  });

  it("restores an analysis stored with its score and match", () => {
    const withAnalysis = applyAnalysis(base, result, { resumeText: "resume A", jobDescription: "j" });
    const parsed = parseStoredSession(JSON.stringify(withAnalysis));
    expect(parsed?.score?.composite).toBe(70);
    expect(parsed?.analysis).toEqual(analysis);
    expect(parsed?.analyzedJobDescription).toBe("j");
  });

  it("drops an analysis from an older build that has no composite score", () => {
    const old = { ...base, analysis: { overallScore: 70, experienceAlignment: [] }, analyzedAt: "x" };
    const parsed = parseStoredSession(JSON.stringify(old));
    expect(parsed?.analysis).toBeNull();
    expect(parsed?.score).toBeNull();
    expect(parsed?.analyzedAt).toBeNull();
    expect(parsed?.resume).toEqual(base.resume);
  });

  it("drops a malformed resume and keeps valid ATS data on a good one", () => {
    expect(parseStoredSession(JSON.stringify({ resume: { name: 3 } }))?.resume).toBeNull();
    const ats = { score: 90, checks: [] };
    const parsed = parseStoredSession(
      JSON.stringify({ resume: { ...base.resume, ats, bullets: "nope" } }),
    );
    expect(parsed?.resume?.ats).toEqual(ats);
    expect(parsed?.resume?.bullets).toBeUndefined();
  });
});
