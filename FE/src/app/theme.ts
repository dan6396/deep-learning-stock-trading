export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "kospi-theme.v1";
export const DEFAULT_THEME: Theme = "dark";

/** A stored choice wins; otherwise the product default (dark). */
export function resolveInitialTheme(stored: string | null | undefined): Theme {
  return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
}

export function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for the session only.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
