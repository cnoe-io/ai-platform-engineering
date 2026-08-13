"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTemplateEditor } from "@/components/tome/PageTemplateEditor";
import { TomeAdminsTab } from "@/components/tome/admin/TomeAdminsTab";
import { TomeAnalyticsTab } from "@/components/tome/admin/TomeAnalyticsTab";
import { TomeAuthorizationHealthTab } from "@/components/tome/admin/TomeAuthorizationHealthTab";
import { useSubtabParam } from "@/hooks/use-subtab-param";

const TOME_ADMIN_TABS = ["page-templates", "analytics", "authorization", "admins"] as const;
type TomeAdminTab = (typeof TOME_ADMIN_TABS)[number];

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
  const [activeTab, setActiveTab] = useSubtabParam<TomeAdminTab>(
    TOME_ADMIN_TABS,
    "page-templates",
    "tab",
  );

  useEffect(() => {
    fetch("/api/tome/admin")
      .then((res) => res.json())
      .then((body) => {
        if (!body.isTomeAdmin) router.replace("/projects");
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

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">TOME Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage TOME configuration and administrators. Visible to TOME Admins only.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TomeAdminTab)} className="space-y-6">
        <TabsList>
          <TabsTrigger value="page-templates">Page Templates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="authorization">Health</TabsTrigger>
          <TabsTrigger value="admins">Admins</TabsTrigger>
        </TabsList>

        <TabsContent value="page-templates" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pages seeded for each project and connected source. Both the wiki UI and the ingest
            agent read this config.
          </p>
          <PageTemplateEditor />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0 space-y-4">
          <TomeAnalyticsTab />
        </TabsContent>

        <TabsContent value="authorization" className="mt-0 space-y-4">
          <TomeAuthorizationHealthTab />
        </TabsContent>

        <TabsContent value="admins" className="mt-0 space-y-4">
          <TomeAdminsTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}
