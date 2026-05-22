"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ProviderConnections } from "./ProviderConnections";
import { SecretsManager } from "./SecretsManager";

export function CredentialsWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedTab = searchParams.get("tab") === "secrets" ? "secrets" : "connections";
  const [activeTab, setActiveTab] = React.useState(linkedTab);

  React.useEffect(() => {
    setActiveTab(linkedTab);
  }, [linkedTab]);

  const updateTab = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connections &amp; Secrets</h1>
        <p className="text-sm text-muted-foreground">
          Manage your credential references and OAuth provider connections. Raw secret material is
          accepted only through create, rotate, and OAuth callback flows.
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={updateTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="connections">My Connections</TabsTrigger>
          <TabsTrigger value="secrets">My Secrets</TabsTrigger>
        </TabsList>
        <TabsContent value="connections">
          <ProviderConnections />
        </TabsContent>
        <TabsContent value="secrets" className="space-y-8">
          <SecretsManager />
        </TabsContent>
      </Tabs>
    </section>
  );
}
