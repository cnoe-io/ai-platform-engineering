"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AGENTIC_SDLC_UI_SETTINGS_EVENT,
  type AgenticSdlcUiSettings,
  readAgenticSdlcUiSettings,
  resetAgenticSdlcUiSettings,
  writeAgenticSdlcUiSettings,
} from "@/lib/agentic-sdlc/ui-settings";

export function useAgenticSdlcUiSettings(): {
  settings: AgenticSdlcUiSettings;
  updateSettings: (updates: Partial<AgenticSdlcUiSettings>) => void;
  resetSettings: () => void;
} {
  const [settings, setSettings] = useState<AgenticSdlcUiSettings>(() =>
    readAgenticSdlcUiSettings(),
  );
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setSettings(readAgenticSdlcUiSettings());

    function onSettingsChanged(event: Event) {
      const detail = (event as CustomEvent<AgenticSdlcUiSettings>).detail;
      setSettings(detail ?? readAgenticSdlcUiSettings());
    }

    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key.includes("agentic-sdlc-ui-settings")) {
        setSettings(readAgenticSdlcUiSettings());
      }
    }

    window.addEventListener(AGENTIC_SDLC_UI_SETTINGS_EVENT, onSettingsChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AGENTIC_SDLC_UI_SETTINGS_EVENT, onSettingsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<AgenticSdlcUiSettings>) => {
    const next = writeAgenticSdlcUiSettings({
      ...settingsRef.current,
      ...updates,
    });
    setSettings(next);
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(resetAgenticSdlcUiSettings());
  }, []);

  return { settings, updateSettings, resetSettings };
}
