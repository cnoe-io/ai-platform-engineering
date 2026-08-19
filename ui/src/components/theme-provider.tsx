"use client";

import type { ThemeProviderProps,UseThemeProps } from "next-themes";
import { ThemeProvider as NextThemesProvider,useTheme as useNextTheme } from "next-themes";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";

const CaipeThemeContext = createContext<UseThemeProps | undefined>(undefined);

export function useTheme(): UseThemeProps {
  const theme = useContext(CaipeThemeContext);
  const fallback = useNextTheme();
  return theme ?? fallback;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  enableSystem = true,
  forcedTheme,
  storageKey = "theme",
  themes = ["light","dark"],
  ...props
}: ThemeProviderProps): React.ReactElement {
  // Keep the first render deterministic. The nested next-themes script applies
  // browser storage before paint; this controlled state takes ownership after
  // hydration and when account preferences arrive.
  const [theme,setThemeState] = useState<string>();
  const [systemTheme,setSystemTheme] = useState<"dark" | "light">();

  useEffect(() => {
    let cancelled = false;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    const updateStoredTheme = (event: StorageEvent) => {
      if (event.key === storageKey) setThemeState(event.newValue ?? defaultTheme);
    };
    media.addEventListener("change",updateSystemTheme);
    window.addEventListener("storage",updateStoredTheme);
    void Promise.resolve().then(() => {
      if (cancelled) return;
      updateSystemTheme();
      setThemeState(localStorage.getItem(storageKey) ?? defaultTheme);
    });
    return () => {
      cancelled = true;
      media.removeEventListener("change",updateSystemTheme);
      window.removeEventListener("storage",updateStoredTheme);
    };
  }, [defaultTheme,storageKey]);

  const setTheme = useCallback((value: SetStateAction<string>) => {
    setThemeState((current) => {
      const next = typeof value === "function" ? value(current ?? defaultTheme) : value;
      localStorage.setItem(storageKey,next);
      return next;
    });
  }, [defaultTheme,storageKey]);

  const resolvedTheme = theme === "system" ? systemTheme : theme;
  const contextValue = useMemo<UseThemeProps>(() => ({
    forcedTheme,
    resolvedTheme,
    setTheme,
    systemTheme: enableSystem ? systemTheme : undefined,
    theme,
    themes: enableSystem ? [...themes,"system"] : themes,
  }), [enableSystem,forcedTheme,resolvedTheme,setTheme,systemTheme,theme,themes]);

  return (
    <NextThemesProvider
      {...props}
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      forcedTheme={forcedTheme ?? resolvedTheme}
      storageKey={storageKey}
      themes={themes}
    >
      <CaipeThemeContext.Provider value={contextValue}>
        {children}
      </CaipeThemeContext.Provider>
    </NextThemesProvider>
  );
}
