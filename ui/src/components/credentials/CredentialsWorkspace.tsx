"use client";

// assisted-by claude code claude-sonnet-4-6

import React from "react";

import { Columns2, Rows2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

type CredentialsTab = "connections" | "secrets";
type CredentialsLayout = "tabs" | "single";

const DEFAULT_TAB: CredentialsTab = "connections";
const LAYOUT_STORAGE_KEY = "caipe.credentials.layout";

function coerceCredentialsTab(value: string): CredentialsTab {
  return value === "secrets" ? "secrets" : DEFAULT_TAB;
}

function tabFromHash(hash: string): CredentialsTab {
  return coerceCredentialsTab(hash.replace(/^#/, "").toLowerCase());
}

export function CredentialsWorkspace() {
  const [layout, setLayout] = React.useState<CredentialsLayout>("tabs");
  const [activeTab, setActiveTab] = React.useState<CredentialsTab>(DEFAULT_TAB);
  const [appsCollapsed, setAppsCollapsed] = React.useState(false);
  const [secretsCollapsed, setSecretsCollapsed] = React.useState(false);

  // Hydrate layout from localStorage after mount to avoid SSR mismatch
  React.useEffect(() => {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    setLayout(stored === "single" ? "single" : "tabs");
  }, []);

  const setTabHash = React.useCallback((tab: CredentialsTab, mode: "push" | "replace") => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.hash = tab;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
  }, []);

  const showTab = React.useCallback(
    (tab: CredentialsTab, mode: "push" | "replace" = "push") => {
      setActiveTab(tab);
      setTabHash(tab, mode);
    },
    [setTabHash],
  );

  const toggleLayout = React.useCallback(() => {
    setLayout((prev) => {
      const next: CredentialsLayout = prev === "tabs" ? "single" : "tabs";
      localStorage.setItem(LAYOUT_STORAGE_KEY, next);
      if (next === "single" && typeof window !== "undefined") {
        // Remove hash when switching to single-page view
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(null, "", url.pathname + url.search);
      } else if (next === "tabs" && typeof window !== "undefined") {
        // Restore hash for current tab when switching back to tabs
        setTabHash(activeTab, "replace");
      }
      return next;
    });
  }, [activeTab, setTabHash]);

  // Sync tab state with URL hash (tabs mode only)
  React.useEffect(() => {
    if (layout !== "tabs") return;

    const syncTabWithHash = () => setActiveTab(tabFromHash(window.location.hash));

    syncTabWithHash();
    if (tabFromHash(window.location.hash) === DEFAULT_TAB && window.location.hash !== "#connections") {
      setTabHash(DEFAULT_TAB, "replace");
    }

    window.addEventListener("hashchange", syncTabWithHash);
    return () => window.removeEventListener("hashchange", syncTabWithHash);
  }, [layout, setTabHash]);

  // postMessage OAuth relay → switch to connections tab
  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "caipe.oauth.connection") return;
      if (layout === "tabs") showTab("connections", "replace");
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [layout, showTab]);

  // BroadcastChannel OAuth relay → switch to connections tab
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("caipe.oauth.connection");
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "caipe.oauth.connection" && layout === "tabs") {
        showTab("connections", "replace");
      }
    });
    return () => channel.close();
  }, [layout, showTab]);

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Credentials</h1>
          <p className="text-sm text-muted-foreground">
            Keep saved secrets and connected apps in one place. Secret values stay protected after
            you save them.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLayout}
              aria-label={layout === "tabs" ? "Switch to single-page view" : "Switch to tabbed view"}
            >
              {layout === "tabs" ? (
                <Rows2 className="h-4 w-4" />
              ) : (
                <Columns2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {layout === "tabs" ? "Single-page view" : "Tabbed view"}
          </TooltipContent>
        </Tooltip>
      </div>

      {layout === "single" ? (
        <>
          <ProviderConnections
            collapsed={appsCollapsed}
            onToggle={() => setAppsCollapsed((c) => !c)}
          />
          <hr className="border-border" />
          <SecretsManager
            collapsed={secretsCollapsed}
            onToggle={() => setSecretsCollapsed((c) => !c)}
          />
        </>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => showTab(coerceCredentialsTab(value))}
          className="space-y-6"
        >
          <TabsList aria-label="Credentials sections" className="grid w-full max-w-sm grid-cols-2">
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="secrets">Secrets</TabsTrigger>
          </TabsList>
          <TabsContent value="connections" className="mt-0">
            <ProviderConnections
              collapsed={appsCollapsed}
              onToggle={() => setAppsCollapsed((c) => !c)}
            />
          </TabsContent>
          <TabsContent value="secrets" className="mt-0">
            <SecretsManager
              collapsed={secretsCollapsed}
              onToggle={() => setSecretsCollapsed((c) => !c)}
            />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
