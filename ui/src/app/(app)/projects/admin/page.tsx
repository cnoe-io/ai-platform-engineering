"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspacePageHeader } from "@/components/layout/WorkspacePageHeader";
import { PageTemplateEditor } from "@/components/tome/PageTemplateEditor";
import { ModelConfigTab } from "@/components/tome/admin/ModelConfigTab";
import { TomeAdminsTab } from "@/components/tome/admin/TomeAdminsTab";
import { TomeAnalyticsTab } from "@/components/tome/admin/TomeAnalyticsTab";
import { TomeAuthorizationHealthTab } from "@/components/tome/admin/TomeAuthorizationHealthTab";
import { AutoIngestCredentialHealthTab } from "@/components/tome/admin/AutoIngestCredentialHealthTab";
import { ExperimentsTab } from "@/components/tome/admin/ExperimentsTab";
import { useSubtabParam } from "@/hooks/use-subtab-param";

const TOME_ADMIN_TABS = [
  "page-templates",
  "models",
  "experiments",
  "analytics",
  "authorization",
  "admins",
] as const;
type TomeAdminTab = (typeof TOME_ADMIN_TABS)[number];

const TOME_ADMIN_TAB_LABELS: Record<TomeAdminTab, string> = {
  "page-templates": "Page Templates",
  models: "Models",
  experiments: "Model Evaluations",
  analytics: "Analytics",
  authorization: "RBAC Health",
  admins: "Admins",
};

export default function TomeAdminPage() {
  return (
    // useSubtabParam reads useSearchParams(), which requires a Suspense
    // boundary so a direct/refreshed load of a `?tab=` deep link doesn't bail
    // the whole route out of static rendering.
    <Suspense fallback={null}>
      <TomeAdminPageContent />
    </Suspense>
  );
}

function TomeAdminPageContent() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useSubtabParam<TomeAdminTab>(
    TOME_ADMIN_TABS,
    "page-templates",
    "tab",
  );

  useEffect(() => {
    fetch("/api/tome/admin")
      .then((res) => res.json())
      .then((body) => {
        if (body.isTomeAdmin) setAuthorized(true);
        else router.replace("/projects");
      })
      .catch(() => router.replace("/projects"))
      .finally(() => setChecking(false));
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  // Keep privileged tab content unmounted while a denied redirect completes.
  // The API is independently protected, but mounting here would still issue
  // avoidable forbidden requests and surface error toasts to non-admins.
  if (!authorized) return null;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <WorkspacePageHeader
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "TOME", href: "/projects" },
          { label: "Settings", href: "/projects/admin" },
          { label: TOME_ADMIN_TAB_LABELS[activeTab] },
        ]}
        description="Manage TOME configuration and administrators. Visible to TOME Admins only."
        title="TOME Settings"
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TomeAdminTab)} className="w-full space-y-6">
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value="page-templates">Page Templates</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="experiments">Model Evaluations</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="authorization">RBAC Health</TabsTrigger>
          <TabsTrigger value="admins">Admins</TabsTrigger>
        </TabsList>

        <TabsContent value="page-templates" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pages seeded for each project and connected source. Both the wiki UI and the ingest
            agent read this config.
          </p>
          <PageTemplateEditor />
        </TabsContent>

        <TabsContent value="models" className="mt-0 space-y-4">
          <ModelConfigTab />
        </TabsContent>

        <TabsContent value="experiments" className="mt-0 space-y-4">
          <ExperimentsTab />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0 space-y-4">
          <TomeAnalyticsTab />
        </TabsContent>

        <TabsContent value="authorization" className="mt-0 space-y-8">
          <TomeAuthorizationHealthTab />
          <div className="border-t border-border/60 pt-8">
            <AutoIngestCredentialHealthTab />
          </div>
        </TabsContent>

        <TabsContent value="admins" className="mt-0 space-y-4">
          <TomeAdminsTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}
