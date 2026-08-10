"use client";

// assisted-by Codex Codex-sonnet-4-6

import { usePathname,useRouter,useSearchParams } from "next/navigation";
import React from "react";

import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";

import { AdminSecretsManager } from "./AdminSecretsManager";
import { OAuthConnectorAdminPanel } from "./OAuthConnectorAdminPanel";

export function AdminCredentialManagementPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("credentialsTab");
  const linkedTab = requestedTab === "oauth-providers" ? requestedTab : "secrets";
  const [activeTab, setActiveTab] = React.useState(linkedTab);

  React.useEffect(() => {
    setActiveTab(linkedTab);
  }, [linkedTab]);

  const updateTab = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "credentials");
    params.set("credentialsTab", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-muted-foreground">
          Review saved secrets, connected apps, access, usage, and recent activity.
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={updateTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
          <TabsTrigger value="oauth-providers">Connected Apps</TabsTrigger>
        </TabsList>
        <TabsContent value="secrets">
          <AdminSecretsManager />
        </TabsContent>
        <TabsContent value="oauth-providers">
          <OAuthConnectorAdminPanel />
        </TabsContent>
      </Tabs>
    </section>
  );
}
