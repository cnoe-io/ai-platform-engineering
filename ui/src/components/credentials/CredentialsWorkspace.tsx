"use client";

// assisted-by Codex Codex-sonnet-4-6

import { usePathname,useRouter,useSearchParams } from "next/navigation";
import React from "react";

import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

export function CredentialsWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedTab = searchParams.get("tab") === "connections" ? "connections" : "secrets";
  const [activeTab, setActiveTab] = React.useState(linkedTab);

  React.useEffect(() => {
    setActiveTab(linkedTab);
  }, [linkedTab]);

  const updateTab = React.useCallback((value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin && event.origin !== window.location.origin) return;
      if (event.data?.type !== "caipe.oauth.connection") return;
      if (event.data?.status !== "success") return;
      updateTab("connections");
    };

    window.addEventListener("message", handleOAuthMessage);
    if (typeof BroadcastChannel === "undefined") {
      return () => window.removeEventListener("message", handleOAuthMessage);
    }

    const channel = new BroadcastChannel("caipe.oauth.connection");
    channel.addEventListener("message", handleOAuthMessage);
    return () => {
      window.removeEventListener("message", handleOAuthMessage);
      channel.close();
    };
  }, [updateTab]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Keep saved secrets and connected apps in one place. Secret values stay protected after
          you save them.
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={updateTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="secrets">Saved Secrets</TabsTrigger>
          <TabsTrigger value="connections">Connected Apps</TabsTrigger>
        </TabsList>
        <TabsContent value="secrets" className="space-y-8">
          <SecretsManager />
        </TabsContent>
        <TabsContent value="connections">
          <ProviderConnections />
        </TabsContent>
      </Tabs>
    </section>
  );
}
