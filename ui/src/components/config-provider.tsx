"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import type { Config } from "@/lib/config";
import { _setClientConfig } from "@/lib/config";

/**
 * Default / fallback config used while the API fetch is in flight.
 * These mirror the server-side defaults so the UI renders correctly
 * even before the fetch completes.
 */
const DEFAULT_CONFIG: Config = {
  caipeUrl: "http://localhost:8000",
  ragUrl: "http://localhost:9446",
  isDev: false,
  isProd: false,
  ssoEnabled: false,
  ragEnabled: true,
  mongodbEnabled: false,
  enableSubAgentCards: false,
  tagline: "Multi-Agent Workflow Automation",
  description:
    "Where Humans and AI agents collaborate to deliver high quality outcomes.",
  appName: "CAIPE",
  logoUrl: "/logo.svg",
  previewMode: false,
  gradientFrom: "hsl(173,80%,40%)",
  gradientTo: "hsl(270,75%,60%)",
  logoStyle: "default",
  spinnerColor: null,
  showPoweredBy: true,
  supportEmail: "support@example.com",
  allowDevAdminWhenSsoDisabled: false,
  storageMode: "localStorage",
};

const ConfigContext = createContext<Config>(DEFAULT_CONFIG);

/**
 * React hook to read application config on the client.
 *
 * Must be used inside <ConfigProvider>.
 * Returns the full Config object fetched from GET /api/config.
 */
export function useConfig(): Config {
  return useContext(ConfigContext);
}

/**
 * ConfigProvider
 *
 * Fetches GET /api/config on mount and provides the result via React Context.
 * Blocks rendering (shows a loading indicator) until the config is ready,
 * ensuring that every child component sees consistent, server-sourced values.
 */
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/config", {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (cancelled) return;

        if (res.ok) {
          const data = (await res.json()) as Config;
          _setClientConfig(data);
          setConfig(data);
        } else {
          console.warn("[ConfigProvider] /api/config returned", res.status);
          _setClientConfig(DEFAULT_CONFIG);
          setConfig(DEFAULT_CONFIG);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[ConfigProvider] Failed to fetch config:", err);
        _setClientConfig(DEFAULT_CONFIG);
        setConfig(DEFAULT_CONFIG);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}
