"use client";

import {
  HISTORY_CHANGE_EVENT,
  HISTORY_ENTRIES_KEY,
  HISTORY_OPT_IN_KEY,
  addEntry,
  clearHistory,
  exportHistory,
  importHistory,
  isHistoryEnabled,
  parseEntries,
  readRawEntries,
  removeEntry,
  setHistoryEnabled,
  type HistoryEntry,
  type ImportResult,
} from "@/lib/history/store";
import { useCallback, useSyncExternalStore } from "react";

interface Snapshot {
  enabled: boolean;
  entries: HistoryEntry[];
}

const SERVER_SNAPSHOT: Snapshot = { enabled: false, entries: [] };

// useSyncExternalStore needs a referentially stable snapshot between changes,
// so the parsed list is cached against the raw string it came from.
let cache: { key: string; snapshot: Snapshot } | null = null;

function getSnapshot(): Snapshot {
  const enabled = isHistoryEnabled();
  const raw = enabled ? readRawEntries() : null;
  const key = `${enabled ? 1 : 0}:${raw ?? ""}`;
  if (cache?.key === key) return cache.snapshot;
  const snapshot = { enabled, entries: enabled ? parseEntries(raw) : [] };
  cache = { key, snapshot };
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    // Another tab changed history.
    if (event.key === null || event.key === HISTORY_ENTRIES_KEY || event.key === HISTORY_OPT_IN_KEY) {
      onChange();
    }
  };
  window.addEventListener(HISTORY_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(HISTORY_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export interface UseHistory {
  /** False on the server and until the user opts in. */
  enabled: boolean;
  /** Newest first. */
  entries: HistoryEntry[];
  /** Turning it off deletes all stored entries. */
  setEnabled: (enabled: boolean) => void;
  add: (entry: HistoryEntry) => HistoryEntry | null;
  remove: (id: string) => void;
  clear: () => void;
  exportJson: () => string;
  importJson: (json: string) => ImportResult;
}

export function useHistory(): UseHistory {
  const { enabled, entries } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const exportJson = useCallback(() => exportHistory(), []);
  return {
    enabled,
    entries,
    setEnabled: setHistoryEnabled,
    add: addEntry,
    remove: removeEntry,
    clear: clearHistory,
    exportJson,
    importJson: importHistory,
  };
}
