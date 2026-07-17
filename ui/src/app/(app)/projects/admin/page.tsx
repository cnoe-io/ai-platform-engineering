"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTemplateEditor } from "@/components/tome/PageTemplateEditor";

export default function TomeAdminPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

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
        <h1 className="text-2xl font-semibold">TOME Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage TOME configuration. Visible to TOME Admins only.
        </p>
      </div>

      <Tabs defaultValue="page-templates" className="space-y-6">
        <TabsList>
          <TabsTrigger value="page-templates">Page Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="page-templates" className="mt-0 space-y-4">
          <p className="text-sm text-muted-foreground">
            Pages seeded for each project and connected source. Both the wiki UI and the ingest
            agent read this config.
          </p>
          <PageTemplateEditor />
        </TabsContent>
      </Tabs>
    </section>
  );
}
