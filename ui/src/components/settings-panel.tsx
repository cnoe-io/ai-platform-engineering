"use client";

import {
  COLOR_THEMES,
  applyCachedAppearance,
  getDefaultAppearancePreferences,
  mergeUnchangedServerAppearance,
  normalizeServerAppearancePreferences,
  readCachedAppearancePreferences,
  snapshotAppearanceInteractions,
} from "@/lib/appearance-preferences";
import { apiClient } from "@/lib/api-client";
import { Palette } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Header shortcut plus the global appearance hydrator.
 *
 * The controls themselves live at /settings/appearance so there is only one
 * canonical editing surface.
 */
export function SettingsPanel(): React.ReactElement {
  const { theme,setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const defaults = getDefaultAppearancePreferences();
    const cached = { ...defaults,...readCachedAppearancePreferences() };
    const interactionSnapshot = snapshotAppearanceInteractions();
    applyCachedAppearance(cached);

    void apiClient.getSettings()
      .then((settings) => {
        if (cancelled) return;
        const current = { ...cached,...readCachedAppearancePreferences() };
        const server = mergeUnchangedServerAppearance(
          current,
          normalizeServerAppearancePreferences(
            settings.preferences as unknown as Record<string,unknown>,
          ),
          interactionSnapshot,
        );
        applyCachedAppearance(server);
        setTheme(server.theme);
      })
      .catch((error: unknown) => {
        console.warn("[SettingsPanel] Account appearance could not be loaded; using this device",error);
      });

    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  const currentTheme = COLOR_THEMES.find((option) => option.id === theme);

  return (
    <Link
      aria-label="Appearance settings"
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      href="/settings/appearance"
      title="Appearance settings"
    >
      <Palette className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden whitespace-nowrap sm:block">
        {currentTheme?.label ?? "Appearance"}
      </span>
    </Link>
  );
}
