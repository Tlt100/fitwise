"use client";

import { ComparePanel } from "@/components/features/compare-panel";
import { downloadText } from "@/components/features/export-text";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MAX_COMPARE, MIN_COMPARE } from "@/lib/history/compare";
import { MAX_HISTORY_ENTRIES, type HistoryEntry } from "@/lib/history/store";
import { useHistory } from "@/lib/history/use-history";
import { Download, Lock, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

export interface HistoryPanelProps {
  /**
   * The current analysis mapped with `toHistoryEntry(...)`. When given and
   * history is on, a "Save this analysis" button appears.
   */
  currentEntry?: HistoryEntry | null;
  /** Called whenever the comparison selection changes. */
  onSelectionChange?: (entries: HistoryEntry[]) => void;
  /** Render the comparison table below the list (default true). */
  showCompare?: boolean;
}

export function HistoryPanel({
  currentEntry,
  onSelectionChange,
  showCompare = true,
}: HistoryPanelProps) {
  const history = useHistory();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "positive" | "negative" | "info"; text: string } | null>(
    null,
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Drop selections whose entries were deleted.
  const liveSelected = selected.filter((id) => history.entries.some((e) => e.id === id));
  const selectedEntries = liveSelected
    .map((id) => history.entries.find((e) => e.id === id))
    .filter((e): e is HistoryEntry => !!e);

  function updateSelection(next: string[]) {
    setSelected(next);
    onSelectionChange?.(
      next
        .map((id) => history.entries.find((e) => e.id === id))
        .filter((e): e is HistoryEntry => !!e),
    );
  }

  function toggle(id: string) {
    if (liveSelected.includes(id)) {
      updateSelection(liveSelected.filter((s) => s !== id));
    } else if (liveSelected.length < MAX_COMPARE) {
      updateSelection([...liveSelected, id]);
    }
  }

  const alreadySaved =
    !!currentEntry &&
    history.entries.some(
      (e) => e.jdHash === currentEntry.jdHash && e.resumeHash === currentEntry.resumeHash,
    );

  function save() {
    if (!currentEntry) return;
    const saved = history.add(currentEntry);
    setMessage(
      saved
        ? { tone: "positive", text: `Saved "${saved.roleTitle}".` }
        : { tone: "negative", text: "Could not save. This browser may be blocking storage." },
    );
  }

  function exportAll() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(history.exportJson(), `fitwise-history-${stamp}.json`);
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ tone: "negative", text: "That file is too large to be a history export." });
      return;
    }
    const result = history.importJson(await file.text());
    setMessage(
      result.error
        ? { tone: "negative", text: result.error }
        : {
            tone: "positive",
            text: `Imported ${result.imported} ${result.imported === 1 ? "entry" : "entries"}${
              result.skipped ? `, skipped ${result.skipped} duplicate or invalid` : ""
            }.`,
          },
    );
  }

  function disable() {
    history.setEnabled(false);
    updateSelection([]);
    setConfirmClear(false);
    setMessage({ tone: "info", text: "History is off and everything it stored has been deleted." });
  }

  function clearAll() {
    history.clear();
    updateSelection([]);
    setConfirmClear(false);
    setMessage({ tone: "info", text: "All saved analyses were deleted." });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Saved analyses</CardTitle>
          <CardDescription>
            Keep a record of postings you have checked, then compare them side by side.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-start gap-3 rounded-lg bg-surface-sunken p-3 text-sm">
            <input
              type="checkbox"
              checked={history.enabled}
              onChange={(e) => (e.target.checked ? history.setEnabled(true) : disable())}
              className="mt-0.5 size-4 accent-[var(--color-secondary)]"
            />
            <span className="flex-1 space-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Lock className="size-4 text-secondary" aria-hidden />
                Save analyses in this browser
              </span>
              <span className="block text-muted-foreground">
                Off by default. When on, each saved analysis keeps the job description, its scores
                and the missing keywords in this browser&apos;s local storage, on this device only.
                Your resume text is never saved: only a fingerprint of it, so entries scored against
                different resumes can be told apart. Nothing is uploaded. Turning this off deletes
                everything it stored. Up to {MAX_HISTORY_ENTRIES} entries are kept.
              </span>
            </span>
          </label>

          <div aria-live="polite">
            {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          </div>

          {history.enabled ? (
            <>
              <div className="flex flex-wrap gap-2">
                {currentEntry ? (
                  <Button size="sm" onClick={save} disabled={alreadySaved}>
                    <Save className="size-4" aria-hidden />
                    {alreadySaved ? "This analysis is saved" : "Save this analysis"}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={exportAll} disabled={history.entries.length === 0}>
                  <Download className="size-4" aria-hidden />
                  Export JSON
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" aria-hidden />
                  Import JSON
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Import history file"
                  onChange={importFile}
                />
                {history.entries.length > 0 ? (
                  confirmClear ? (
                    <span className="inline-flex items-center gap-2">
                      <Button size="sm" variant="danger" onClick={clearAll}>
                        Delete all {history.entries.length}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                      <Trash2 className="size-4" aria-hidden />
                      Clear all
                    </Button>
                  )
                ) : null}
              </div>

              {history.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing saved yet. Run an analysis and choose &ldquo;Save this analysis&rdquo;.
                </p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium">
                    Select {MIN_COMPARE} to {MAX_COMPARE} to compare{" "}
                    <span className="font-normal text-muted-foreground">
                      ({liveSelected.length} selected)
                    </span>
                  </legend>
                  <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                    {history.entries.map((entry) => {
                      const checked = liveSelected.includes(entry.id);
                      const atLimit = !checked && liveSelected.length >= MAX_COMPARE;
                      return (
                        <li key={entry.id} className="flex items-center gap-3 p-3">
                          <input
                            id={`history-${entry.id}`}
                            type="checkbox"
                            checked={checked}
                            disabled={atLimit}
                            onChange={() => toggle(entry.id)}
                            className="size-4 accent-[var(--color-secondary)]"
                          />
                          <label htmlFor={`history-${entry.id}`} className="min-w-0 flex-1 cursor-pointer text-sm">
                            <span className="block truncate font-medium">{entry.roleTitle}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {entry.company ? `${entry.company} · ` : ""}
                              {new Date(entry.createdAt).toLocaleString()}
                              {typeof entry.scores.composite === "number"
                                ? ` · score ${entry.scores.composite}`
                                : ""}
                              {entry.resumeFileName ? ` · ${entry.resumeFileName}` : ""}
                            </span>
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => history.remove(entry.id)}
                            aria-label={`Delete saved analysis for ${entry.roleTitle}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      {showCompare && history.enabled && selectedEntries.length >= MIN_COMPARE ? (
        <ComparePanel entries={selectedEntries} />
      ) : null}
    </div>
  );
}
