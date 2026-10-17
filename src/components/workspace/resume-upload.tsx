"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkFileMetadata } from "@/lib/extract/file-type";
import type { ExtractResponse } from "@/lib/extract/types";
import { messageForFailure, parseJson } from "@/lib/http/read-error";
import { MAX_FILE_BYTES, formatBytes } from "@/lib/limits";
import { useSession } from "@/lib/session/session-context";
import { cn } from "@/lib/cn";
import {
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

type Phase = "idle" | "reading" | "extracting";

export function ResumeUpload() {
  const { resume, setResume, clearResume } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // A ref, not just the phase state: two quick drops (or Replace clicked
  // during an upload) would otherwise race, and whichever finished last won.
  const inFlight = useRef(false);

  const busy = phase !== "idle";

  const upload = useCallback(
    async (file: File) => {
      if (inFlight.current) return;
      setError(null);

      const metadata = checkFileMetadata({ name: file.name, size: file.size });
      if (!metadata.ok) {
        setError(metadata.reason);
        return;
      }

      inFlight.current = true;
      setPhase("reading");
      setProgress(0);

      const body = new FormData();
      body.append("file", file);

      // XHR rather than fetch: it reports real upload progress, which matters
      // for a multi-megabyte PDF on a slow connection.
      const xhr = new XMLHttpRequest();
      const done = new Promise<{ status: number; text: string }>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const pct = Math.round((event.loaded / event.total) * 100);
          setProgress(pct);
          if (pct >= 100) setPhase("extracting");
        });
        xhr.addEventListener("load", () =>
          resolve({ status: xhr.status, text: xhr.responseText }),
        );
        xhr.addEventListener("error", () => reject(new Error("network")));
        xhr.addEventListener("abort", () => reject(new Error("aborted")));
      });

      xhr.open("POST", "/api/extract");
      xhr.send(body);

      try {
        const { status, text } = await done;
        // A platform error (413, 504) arrives as plain text, not JSON.
        const payload = parseJson(text) as Partial<
          Record<keyof ExtractResponse, unknown>
        > | null;

        if (
          status !== 200 ||
          !payload ||
          typeof payload.text !== "string" ||
          typeof payload.words !== "number" ||
          (payload.kind !== "pdf" && payload.kind !== "docx")
        ) {
          setError(
            messageForFailure(
              status,
              payload,
              "That file could not be read. Try another export.",
            ),
          );
          return;
        }

        const ok = (value: unknown): value is object =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value);
        setResume({
          name: file.name,
          size: file.size,
          kind: payload.kind,
          text: payload.text,
          words: payload.words,
          // The deterministic checks ride along with the text; the workspace
          // recomputes them in the browser if an older server left them out.
          meta: ok(payload.meta) ? (payload.meta as ExtractResponse["meta"]) : undefined,
          ats: ok(payload.ats) ? (payload.ats as ExtractResponse["ats"]) : undefined,
          bullets: ok(payload.bullets) ? (payload.bullets as ExtractResponse["bullets"]) : undefined,
        });
      } catch {
        setError("The upload did not complete. Check your connection and try again.");
      } finally {
        inFlight.current = false;
        setPhase("idle");
        setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [setResume],
  );

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  if (resume) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-4 rounded-xl border border-positive/30 bg-positive-surface p-4 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-positive/15 text-positive">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate font-medium text-positive-foreground">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{resume.name}</span>
            </p>
            <p className="text-sm text-positive-foreground/80">
              {resume.kind.toUpperCase()} · {formatBytes(resume.size)} ·{" "}
              {resume.words.toLocaleString()} words extracted
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              {busy ? "Reading…" : "Replace"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={clearResume}>
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          </div>
        </div>
        {/* Extraction is lossy, and a mangled text layer produces a confusing
            analysis with no obvious cause. Showing exactly what was read lets
            someone catch that before spending a request on it. */}
        <details className="rounded-md border border-border-subtle">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Check what was extracted
          </summary>
          <div className="space-y-2 border-t border-border-subtle p-4">
            <p className="text-xs text-muted-foreground">
              This is the text the model will read. If it looks scrambled or is
              missing sections, export your resume again and re-upload.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-sunken p-3 font-sans text-xs leading-relaxed">
              {resume.text}
            </pre>
          </div>
        </details>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          aria-label="Replace resume file"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {error ? <Alert tone="negative">{error}</Alert> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* The whole zone is a button, so drag-and-drop is a shortcut rather than
          the only way in — keyboard and screen-reader users get the same path. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging
            ? "border-secondary bg-secondary/5"
            : "border-border bg-surface hover:border-secondary/60 hover:bg-surface-sunken",
          busy && "pointer-events-none opacity-70",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-8 animate-spin text-secondary" aria-hidden />
            <p className="font-medium">
              {phase === "reading" ? "Uploading…" : "Extracting text…"}
            </p>
            <div
              className="h-1.5 w-56 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={phase === "extracting" ? 100 : progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-full bg-secondary transition-[width] duration-200"
                style={{ width: `${phase === "extracting" ? 100 : progress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {phase === "extracting"
                ? "Reading the document on the server"
                : `${progress}%`}
            </p>
          </>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-full bg-secondary/10 text-secondary">
              <UploadCloud className="size-6" aria-hidden />
            </span>
            <p className="font-display text-lg font-semibold">
              Drop your resume here
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              or click to choose a file. PDF or DOCX, up to{" "}
              {formatBytes(MAX_FILE_BYTES)}. Text-based documents only — a scanned
              image has no text to read.
            </p>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx"
        aria-label="Resume file"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error ? (
        <Alert tone="negative" title="That did not work">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
