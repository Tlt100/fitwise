"use client";

import type { Analysis, AnalyzeResponse } from "@/lib/ai/analysis-schema";
import type { VerificationReport } from "@/lib/ai/verify";
import type { AtsReport } from "@/lib/ats/types";
import type { ExtractMeta } from "@/lib/extract/types";
import type { BulletLintReport } from "@/lib/lint/bullets";
import type { MatchResult } from "@/lib/match/keywords";
import type { CompositeScore } from "@/lib/match/score";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ResumeFile {
  name: string;
  size: number;
  kind: "pdf" | "docx";
  text: string;
  words: number;
  /** Extraction details from /api/extract (layout hints, hidden text). */
  meta?: ExtractMeta;
  /** Deterministic ATS parse-risk report for this resume. */
  ats?: AtsReport;
  /** Deterministic bullet-point lint for this resume. */
  bullets?: BulletLintReport;
}

/** The parts of an analyze response kept in the session. */
export type AnalysisResult = Pick<AnalyzeResponse, "analysis" | "match" | "score" | "verification">;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** A per-rewrite decision plus any hand edits made to the suggested text. */
export interface RewriteDecision {
  status: "pending" | "accepted" | "rejected";
  /** Absent until the user edits the text; the suggestion is shown until then. */
  edited?: string;
}

interface SessionState {
  resume: ResumeFile | null;
  jobDescription: string;
  analysis: Analysis | null;
  /** Deterministic keyword match the analysis was scored with. */
  match: MatchResult | null;
  /** Composite score computed in code; the only score shown. */
  score: CompositeScore | null;
  /** Counts from the grounding checks. */
  verification: VerificationReport | null;
  analyzedAt: string | null;
  /** The job description the current analysis was run against. */
  analyzedJobDescription: string | null;
  decisions: Record<string, RewriteDecision>;
  chat: ChatMessage[];
  shareContextWithAssistant: boolean;
  /** A summary chosen in the Rewrites tab, placed at the top of the draft. */
  draftSummary: string | null;
}

const EMPTY: SessionState = {
  resume: null,
  jobDescription: "",
  analysis: null,
  match: null,
  score: null,
  verification: null,
  analyzedAt: null,
  analyzedJobDescription: null,
  decisions: {},
  chat: [],
  shareContextWithAssistant: true,
  draftSummary: null,
};

/** Everything derived from one analysis, reset together. */
const NO_ANALYSIS = {
  analysis: null,
  match: null,
  score: null,
  verification: null,
  analyzedAt: null,
  analyzedJobDescription: null,
  decisions: {},
} satisfies Partial<SessionState>;

interface SessionValue extends SessionState {
  hydrated: boolean;
  setResume: (resume: ResumeFile) => void;
  clearResume: () => void;
  setJobDescription: (value: string) => void;
  /**
   * Store an analysis together with the inputs it was produced from. Ignored if
   * the resume changed while the request was in flight.
   */
  setAnalysis: (result: AnalysisResult, inputs: AnalysisInputs) => void;
  clearAnalysis: () => void;
  setDecision: (key: string, decision: Partial<RewriteDecision>) => void;
  appendChat: (message: ChatMessage) => void;
  /** Append an assistant reply, unless the question it answers was cleared. */
  appendReply: (reply: ChatMessage, inReplyTo: string) => void;
  clearChat: () => void;
  setShareContext: (value: boolean) => void;
  setDraftSummary: (value: string | null) => void;
  clearEverything: () => void;
}

export interface AnalysisInputs {
  resumeText: string;
  jobDescription: string;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Pure state transition for a finished analysis. The request can take 30
 * seconds, and in that time the user can edit the posting or swap the resume:
 * the analysis is recorded against the posting that was actually sent (so the
 * staleness banner is truthful), and dropped if the resume is no longer the
 * one it describes.
 */
export function applyAnalysis(
  current: SessionState,
  result: AnalysisResult,
  inputs: AnalysisInputs,
  now: Date = new Date(),
): SessionState {
  if (current.resume?.text !== inputs.resumeText) return current;
  return {
    ...current,
    analysis: result.analysis,
    match: result.match ?? null,
    score: result.score ?? null,
    verification: result.verification ?? null,
    analyzedAt: now.toISOString(),
    analyzedJobDescription: inputs.jobDescription,
    decisions: {},
  };
}

/** Merge a partial decision without inventing an empty edit. */
export function mergeDecision(
  existing: RewriteDecision | undefined,
  patch: Partial<RewriteDecision>,
): RewriteDecision {
  const status = patch.status ?? existing?.status ?? "pending";
  const edited = patch.edited ?? existing?.edited;
  return edited === undefined ? { status } : { status, edited };
}

/**
 * A reply lands only if the message it answers is still in the conversation;
 * a reply arriving after "Clear chat" or a resume swap is discarded.
 */
export function appendReplyTo(
  chat: ChatMessage[],
  reply: ChatMessage,
  inReplyTo: string,
): ChatMessage[] {
  return chat.some((message) => message.id === inReplyTo) ? [...chat, reply] : chat;
}

/**
 * sessionStorage, not localStorage: the resume survives a refresh or an
 * accidental navigation, and disappears when the tab does. Nothing is sent to
 * a server except when the user asks for an analysis or a chat reply.
 */
const STORAGE_KEY = "fitwise-session-v2";
/**
 * Keys written by earlier builds. v1 stored an analysis with a model-supplied
 * score and no deterministic match, which this build no longer renders, so
 * those sessions are discarded rather than migrated.
 */
const LEGACY_STORAGE_KEYS = ["fitwise-session-v1"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseResume(value: unknown): ResumeFile | null {
  if (!isRecord(value)) return null;
  const { name, size, kind, text, words } = value;
  if (
    typeof name !== "string" ||
    typeof size !== "number" ||
    (kind !== "pdf" && kind !== "docx") ||
    typeof text !== "string" ||
    typeof words !== "number"
  ) {
    return null;
  }
  const resume: ResumeFile = { name, size, kind, text, words };
  if (isRecord(value.meta)) resume.meta = value.meta as unknown as ExtractMeta;
  if (isRecord(value.ats) && typeof value.ats.score === "number" && Array.isArray(value.ats.checks)) {
    resume.ats = value.ats as unknown as AtsReport;
  }
  if (isRecord(value.bullets) && Array.isArray(value.bullets.bullets)) {
    resume.bullets = value.bullets as unknown as BulletLintReport;
  }
  return resume;
}

/** Parse a stored session, tolerating corrupt or outdated shapes. */
export function parseStoredSession(raw: string | null): SessionState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const stored = parsed as Partial<SessionState>;
    const resume = parseResume(stored.resume);
    // An analysis is only usable with the score and match it came with, and
    // only alongside the resume it describes.
    const analysisOk =
      resume !== null &&
      isRecord(stored.analysis) &&
      Array.isArray(stored.analysis.experienceAlignment) &&
      isRecord(stored.score) &&
      Array.isArray(stored.score.components) &&
      isRecord(stored.match) &&
      Array.isArray(stored.match.terms);
    // A shape from an older build (or a hand-edited value) must not crash the
    // render with "chat.map is not a function"; fall back field by field.
    return {
      ...EMPTY,
      ...stored,
      resume,
      ...(analysisOk
        ? {
            verification: isRecord(stored.verification) ? stored.verification : null,
            analyzedAt: typeof stored.analyzedAt === "string" ? stored.analyzedAt : null,
            analyzedJobDescription:
              typeof stored.analyzedJobDescription === "string" ? stored.analyzedJobDescription : null,
          }
        : NO_ANALYSIS),
      draftSummary: typeof stored.draftSummary === "string" ? stored.draftSummary : null,
      jobDescription: typeof stored.jobDescription === "string" ? stored.jobDescription : "",
      chat: Array.isArray(stored.chat) ? stored.chat : [],
      decisions:
        stored.decisions && typeof stored.decisions === "object" ? stored.decisions : {},
      shareContextWithAssistant: stored.shareContextWithAssistant !== false,
    };
  } catch {
    // Corrupt storage should not break the page.
    return null;
  }
}

function readStored(): SessionState | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) sessionStorage.removeItem(key);
    return parseStoredSession(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage can be unavailable entirely (some privacy modes).
    return null;
  }
}

export type { SessionState };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const skipWrite = useRef(true);

  useEffect(() => {
    // sessionStorage is an external system and cannot be read during render
    // without breaking hydration, so this one synchronous setState is the
    // point of the effect rather than a cascade.
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota or private mode; the session still works in memory.
    }
  }, [state, hydrated]);

  const patch = useCallback((next: Partial<SessionState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      ...state,
      hydrated,
      setResume: (resume) =>
        // A new resume invalidates the analysis it was based on.
        patch({ resume, ...NO_ANALYSIS, chat: [], draftSummary: null }),
      clearResume: () => patch({ resume: null, ...NO_ANALYSIS, chat: [], draftSummary: null }),
      setJobDescription: (jobDescription) => patch({ jobDescription }),
      setAnalysis: (result, inputs) =>
        setState((current) => applyAnalysis(current, result, inputs)),
      clearAnalysis: () => patch(NO_ANALYSIS),
      setDecision: (key, decision) =>
        setState((current) => ({
          ...current,
          decisions: {
            ...current.decisions,
            [key]: mergeDecision(current.decisions[key], decision),
          },
        })),
      appendChat: (message) =>
        setState((current) => ({ ...current, chat: [...current.chat, message] })),
      appendReply: (reply, inReplyTo) =>
        setState((current) => {
          const chat = appendReplyTo(current.chat, reply, inReplyTo);
          return chat === current.chat ? current : { ...current, chat };
        }),
      clearChat: () => patch({ chat: [] }),
      setShareContext: (shareContextWithAssistant) => patch({ shareContextWithAssistant }),
      setDraftSummary: (value) => patch({ draftSummary: value?.trim() ? value : null }),
      clearEverything: () => {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // Nothing to clean up if storage was never available.
        }
        setState(EMPTY);
      },
    }),
    [state, hydrated, patch],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return context;
}

/** True when the job description has changed since the analysis was produced. */
export function isAnalysisStale(state: {
  analysis: Analysis | null;
  jobDescription: string;
  analyzedJobDescription: string | null;
}): boolean {
  if (!state.analysis) return false;
  return state.jobDescription.trim() !== (state.analyzedJobDescription ?? "").trim();
}
