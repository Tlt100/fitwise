"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { messageForFailure, readJson } from "@/lib/http/read-error";
import { MAX_CHAT_MESSAGE_CHARS } from "@/lib/limits";
import { useSession, type ChatMessage } from "@/lib/session/session-context";
import { Eraser, Loader2, Send, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STARTERS = [
  "Which of my projects should I lead with for this role?",
  "Rewrite my most recent bullet point using only what I actually did.",
  "What qualifications should I work on developing for this kind of job?",
  "Is my summary doing any work, or should I cut it?",
];

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AssistantPanel() {
  const {
    resume,
    jobDescription,
    chat,
    appendChat,
    appendReply,
    clearChat,
    shareContextWithAssistant,
    setShareContext,
  } = useSession();

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [chat.length, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending || !resume) return;

    const userMessage: ChatMessage = { id: newId(), role: "user", content };
    const history = [...chat, userMessage];

    appendChat(userMessage);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resumeText: resume.text,
          jobDescription:
            shareContextWithAssistant && jobDescription.trim()
              ? jobDescription.trim()
              : null,
          // Only the recent turns travel; the route caps this too.
          messages: history.slice(-12).map(({ role, content: body }) => ({
            role,
            content: body,
          })),
        }),
      });

      const payload = (await readJson(response)) as { reply?: unknown } | null;

      if (!response.ok || typeof payload?.reply !== "string") {
        setError(messageForFailure(response.status, payload, "The assistant did not reply."));
        return;
      }

      // Dropped if the chat was cleared (or the resume replaced) meanwhile.
      appendReply(
        { id: newId(), role: "assistant", content: payload.reply },
        userMessage.id,
      );
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Resume assistant</CardTitle>
          <CardDescription>
            It has read your resume{shareContextWithAssistant && jobDescription.trim() ? " and the job description" : ""}. Ask it to
            rewrite something, or what to emphasise.
          </CardDescription>
        </div>
        {chat.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={clearChat}>
            <Eraser className="size-4" aria-hidden />
            Clear chat
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg bg-surface-sunken p-3 text-sm">
          <input
            type="checkbox"
            checked={shareContextWithAssistant}
            onChange={(event) => setShareContext(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-secondary)]"
          />
          <span className="flex-1">
            <span className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="size-4 text-secondary" aria-hidden />
              Include the job description in this conversation
            </span>
            <span className="text-muted-foreground">
              Your resume text is always sent, because the assistant cannot answer
              without it. Turn this off to keep the posting out of the request.
            </span>
          </span>
        </label>

        <div
          className="max-h-[28rem] space-y-4 overflow-y-auto rounded-lg border border-border-subtle p-4"
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {chat.length === 0 ? (
            <div className="space-y-4 py-4 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing asked yet. These are good places to start:
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    disabled={sending}
                    className="rounded-full border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-secondary hover:text-foreground disabled:opacity-50"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            chat.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-secondary text-on-secondary"
                      : "bg-surface-sunken",
                  )}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Thinking…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {error ? <Alert tone="negative">{error}</Alert> : null}

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="assistant-input"
            value={draft}
            rows={2}
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter starts a new line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="Ask about your resume…"
            className="min-h-[3.25rem] flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm"
          />
          <Button type="submit" disabled={sending || !draft.trim()} aria-label="Send message">
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
