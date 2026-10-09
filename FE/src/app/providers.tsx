import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { applyTheme, readStoredTheme, resolveInitialTheme, storeTheme, type Theme } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Market data goes stale quickly, but refetching on every window focus
      // would hammer the rate-limited KIS API.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

type ThemeContextValue = { theme: Theme; toggleTheme: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside AppProviders");
  }
  return value;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme(readStoredTheme()));

  // Layout effect so the palette is in place before the first paint.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      storeTheme(next);
      return next;
    });
  }, []);

  const themeValue = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
    </QueryClientProvider>
  );
}
