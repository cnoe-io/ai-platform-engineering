// assisted-by Codex Codex-sonnet-4-6

import { AuthGuard } from "@/components/auth-guard";
import { notFound } from "next/navigation";

import { AgenticAppShell } from "../AgenticAppShell";

interface AgenticAppPageProps {
  params: Promise<{ appId: string; path?: string[] }>;
}

/**
 * Canonical CAIPE shell for proxied Agentic Apps.
 *
 * `/apps/<id>` and its deep links remain browser-visible while the iframe
 * talks to the private authenticated runtime gateway under `/api`.
 */
export default async function AgenticAppPage({ params }: AgenticAppPageProps) {
  const { appId, path = [] } = await params;
  if (appId === "embed") {
    notFound();
  }
  return (
    <AuthGuard>
      <AgenticAppShell appId={appId} path={path} />
    </AuthGuard>
  );
}
