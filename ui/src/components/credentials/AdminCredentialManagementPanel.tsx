"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { AdminSecretsManager } from "./AdminSecretsManager";
import { CredentialAuditPanel } from "./CredentialAuditPanel";
import { OAuthConnectorAdminPanel } from "./OAuthConnectorAdminPanel";

export function AdminCredentialManagementPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("credentialsTab");
  const linkedTab =
    requestedTab === "secrets" || requestedTab === "audit" ? requestedTab : "oauth-providers";
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
          Manage global OAuth providers and credential metadata under the OpenFGA credentials admin surface.
        </p>
      </div>
      <Tabs value={activeTab} onValueChange={updateTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="oauth-providers">OAuth Providers</TabsTrigger>
          <TabsTrigger value="secrets">Global Secrets</TabsTrigger>
          <TabsTrigger value="audit">Credential Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="oauth-providers">
          <OAuthConnectorAdminPanel />
        </TabsContent>
        <TabsContent value="secrets">
          <AdminSecretsManager />
        </TabsContent>
        <TabsContent value="audit">
          <CredentialAuditPanel endpoint="/api/admin/credentials/audit" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
