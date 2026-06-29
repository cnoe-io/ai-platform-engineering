"use client";

// assisted-by claude code claude-sonnet-4-6
// assisted-by Codex Codex-sonnet-4-6

import React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

type CredentialsTab = "connections" | "secrets";

const DEFAULT_TAB: CredentialsTab = "connections";

function coerceCredentialsTab(value: string): CredentialsTab {
  return value === "secrets" ? "secrets" : DEFAULT_TAB;
}

function tabFromHash(hash: string): CredentialsTab {
  return coerceCredentialsTab(hash.replace(/^#/, "").toLowerCase());
}

export function CredentialsWorkspace() {
  const [activeTab, setActiveTab] = React.useState<CredentialsTab>(DEFAULT_TAB);
  const [appsCollapsed, setAppsCollapsed] = React.useState(false);
  const [secretsCollapsed, setSecretsCollapsed] = React.useState(false);

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

  React.useEffect(() => {
    const syncTabWithHash = () => setActiveTab(tabFromHash(window.location.hash));

    syncTabWithHash();
    if (tabFromHash(window.location.hash) === DEFAULT_TAB && window.location.hash !== "#connections") {
      // assisted-by Codex Codex-sonnet-4-6
      setTabHash(DEFAULT_TAB, "replace");
    }

    window.addEventListener("hashchange", syncTabWithHash);
    return () => window.removeEventListener("hashchange", syncTabWithHash);
  }, [setTabHash]);

  React.useEffect(() => {
    const showConnectionsAfterOAuth = () => showTab("connections", "replace");

    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "caipe.oauth.connection") return;
      showConnectionsAfterOAuth();
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [showTab]);

  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("caipe.oauth.connection");
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "caipe.oauth.connection") {
        showTab("connections", "replace");
      }
    });
    return () => channel.close();
  }, [showTab]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Keep saved secrets and connected apps in one place. Secret values stay protected after
          you save them.
        </p>
      </div>
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
    </section>
  );
}
