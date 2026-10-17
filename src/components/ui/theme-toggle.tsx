"use client";

import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "fitwise-theme";

/**
 * The current theme lives on <html data-theme>, set before paint by the inline
 * script in the root layout. Keeping it out of React state means no mount
 * effect, no hydration mismatch and no flash — CSS picks which icon to show.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse writes; the theme still applies here.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Moon className="size-5 dark:hidden" aria-hidden />
      <Sun className="hidden size-5 dark:block" aria-hidden />
    </button>
  );
}
