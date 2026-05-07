import { RepoDetailShell } from "@/components/agentic-sdlc/RepoDetailShell";

/**
 * Per-repo Agentic SDLC detail page.
 *
 * Server component (no client state) that hands the {owner, repo}
 * pair down to the client `RepoDetailShell`. The parent layout
 * enforces the server-side feature toggle and the per-user gate.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default async function AgenticSdlcRepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return <RepoDetailShell owner={owner} repo={repo} />;
}
