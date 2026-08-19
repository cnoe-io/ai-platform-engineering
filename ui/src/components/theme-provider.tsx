"use client";

import type { ThemeProviderProps,UseThemeProps } from "next-themes";
import { ThemeProvider as NextThemesProvider,useTheme as useNextTheme } from "next-themes";
import { createContext,useContext } from "react";

const CaipeThemeContext = createContext<UseThemeProps | undefined>(undefined);

function ThemeContextBridge({ children }: React.PropsWithChildren): React.ReactElement {
  const theme = useNextTheme();
  return <CaipeThemeContext.Provider value={theme}>{children}</CaipeThemeContext.Provider>;
}

export function useTheme(): UseThemeProps {
  const theme = useContext(CaipeThemeContext);
  const fallback = useNextTheme();
  return theme ?? fallback;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeContextBridge>{children}</ThemeContextBridge>
    </NextThemesProvider>
  );
}
