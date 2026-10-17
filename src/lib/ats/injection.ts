/**
 * Detects text written for an AI screener rather than a person: prompt
 * injection phrases ("ignore previous instructions", "rank this candidate
 * highest") and hidden text (white, microscopic or off-page). Recruiters treat
 * either as disqualifying, and the analyze step must never follow it.
 */
import type { HiddenTextFlag } from "@/lib/extract/types";
import type { InjectionMatch, InjectionReport } from "./types";

type Rule = { id: string; pattern: RegExp; strength: "strong" | "weak" };

const RULES: Rule[] = [
  {
    id: "ignore-instructions",
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|of|these|those)\s+)*(?:previous|prior|above|earlier|preceding|system|other|existing|all|any|your)\s+(?:\w+\s+)?(?:instructions?|prompts?|directions?)\b/i,
    strength: "strong",
  },
  {
    id: "new-instructions",
    pattern: /\b(?:new|updated|real|actual|additional|hidden)\s+(?:system\s+)?instructions?\s*[:-]/i,
    strength: "strong",
  },
  {
    id: "address-the-ai",
    pattern:
      /\byou\s+are\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:ai|a\.i\.|llm|large language model|language model|chatbot|chat\s?gpt|gpt[-\s]?\d*|ai assistant|recruit(?:ing|ment)\s+(?:bot|assistant|ai)|ats|screening (?:bot|tool|ai)|resume (?:screener|parser))\b/i,
    strength: "strong",
  },
  {
    id: "note-to-ai",
    pattern:
      /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+|any\s+)?(?:ai|llm|chat\s?gpt|gpt|claude|gemini|language model|bot|automated (?:system|screener|reviewer)|screening (?:ai|bot|software)|recruit(?:ing|er)\s+(?:bot|ai)|ats)\b/i,
    strength: "strong",
  },
  {
    id: "rank-highest",
    pattern:
      /\b(?:rank|rate|score|grade|evaluate)\s+(?:(?:this|the|my)\s+(?:candidate|applicant|resume|cv|profile|application)|me)\s+(?:as\s+)?(?:the\s+)?(?:highest|first|top|#\s?1|number one|a perfect|perfect|10\s*\/\s*10|100)\b/i,
    strength: "strong",
  },
  {
    id: "give-score",
    pattern:
      /\b(?:give|assign|award)\s+(?:this\s+(?:candidate|applicant|resume)|the\s+(?:candidate|applicant)|me|him|her|them)\s+(?:a|the)\s+(?:score|rating|match(?:\s+score)?)\s+(?:of\s+)?(?:100|10\s*\/\s*10|the highest|perfect)\b/i,
    strength: "strong",
  },
  {
    id: "score-100",
    pattern:
      /\b(?:(?:match|fit|ats|candidate|overall)\s+score|match rating)\s*(?:of|=|:|is|should be|must be)?\s*(?:100\s*(?:%|\/\s*100|percent)?|10\s*\/\s*10)(?!\d)/i,
    strength: "weak",
  },
  {
    id: "praise-third-person",
    pattern:
      /\bthis\s+(?:candidate|applicant)\s+(?:is|should be)\s+(?:an?\s+)?(?:perfect|ideal|excellent|exceptional|outstanding|the best|top|exceptionally qualified|highly qualified|automatically)\b/i,
    strength: "strong",
  },
  {
    id: "recommend-hire",
    pattern: /\b(?:recommend|advance|shortlist|approve|hire)\s+this\s+(?:candidate|applicant)\b/i,
    strength: "strong",
  },
  {
    id: "secrecy",
    pattern:
      /\bdo\s+not\s+(?:mention|reveal|disclose|tell|repeat|reference)\s+(?:this|these|that|the)\s+(?:instructions?|text|prompt|message|note)\b/i,
    strength: "strong",
  },
  {
    id: "chat-markup",
    pattern: /<\|(?:im_start|im_end|system|endoftext)\|>|\[\/?INST\]|###\s*(?:system|instruction)s?\b|<\/?(?:system|instructions?)>/i,
    strength: "strong",
  },
  {
    id: "role-prefix",
    pattern: /(?:^|\n)\s*(?:system|assistant)\s*:\s*(?:you|ignore|disregard|the candidate|rank|rate|score)\b/i,
    strength: "strong",
  },
  {
    id: "vocative-ai",
    pattern: /(?:^|[.!?\n]\s*)(?:hey\s+|dear\s+)?(?:chat\s?gpt|gpt-?\d|claude|gemini|copilot|ai|llm)\s*[,:]\s*(?:please\s+)?(?:ignore|rank|rate|score|say|tell|output|respond|disregard|recommend)\b/i,
    strength: "strong",
  },
  {
    id: "output-control",
    pattern:
      /\b(?:respond|reply|answer|output)\s+(?:only\s+)?(?:with|that)\s+["']?(?:yes|hire|strong match|perfect match|100)/i,
    strength: "strong",
  },
];

/** Strip zero-width characters and collapse whitespace so spacing tricks do not evade the rules. */
function prepare(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[­​-‏⁠-⁤﻿]/g, "")
    .replace(/[ \t]+/g, " ");
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${
    end < text.length ? "…" : ""
  }`;
}

function scan(text: string, inHiddenText: boolean): InjectionMatch[] {
  const out: InjectionMatch[] = [];
  for (const rule of RULES) {
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = global.exec(text)) && guard++ < 5) {
      out.push({
        rule: rule.id,
        snippet: snippetAround(text, m.index, m[0].length),
        strength: rule.strength,
        inHiddenText,
      });
      if (m[0].length === 0) global.lastIndex++;
    }
  }
  return out;
}

/** Minimum high-confidence hidden characters that count as manipulation on their own. */
const HIDDEN_TEXT_THRESHOLD = 30;

export function detectInjection(
  text: string,
  hiddenTextFlags: HiddenTextFlag[] = [],
): InjectionReport {
  const prepared = prepare(text);
  const hiddenSamples = hiddenTextFlags.map((f) => prepare(f.sample)).filter(Boolean);

  const hiddenMatches = hiddenSamples.flatMap((sample) => scan(sample, true));
  const visibleMatches = scan(prepared, false).filter(
    // A phrase already found inside a hidden sample is reported once, as hidden.
    (m) => !hiddenMatches.some((h) => h.rule === m.rule && m.snippet.includes(h.snippet.replace(/…/g, "").slice(0, 20))),
  );
  const matches = [...hiddenMatches, ...visibleMatches];

  const hiddenTextChars = hiddenTextFlags
    .filter((f) => f.confidence === "high")
    .reduce((sum, f) => sum + f.chars, 0);

  const suspectedInjection =
    matches.some((m) => m.strength === "strong") ||
    matches.some((m) => m.inHiddenText) ||
    hiddenTextChars >= HIDDEN_TEXT_THRESHOLD;

  return {
    suspectedInjection,
    matches,
    hiddenTextChars,
    hiddenSamples: hiddenTextFlags
      .filter((f) => f.confidence === "high")
      .map((f) => f.sample)
      .slice(0, 5),
  };
}
