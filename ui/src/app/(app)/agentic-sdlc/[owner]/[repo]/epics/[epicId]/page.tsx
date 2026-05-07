import Link from "next/link";

import { EpicView } from "@/components/agentic-sdlc/EpicView";

/**
 * Per-Epic Agentic SDLC page. Server component thinly wraps the client
 * EpicView which owns the data hook + visualisation switcher.
 *
 * Layout/auth gating happens in the parent layout; this page is
 * just routing + a breadcrumb.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default async function AgenticSdlcEpicPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; epicId: string }>;
}) {
  const { owner, repo, epicId } = await params;
  return (
    <div className="mx-auto flex w-full max-w-[1800px] min-w-0 flex-col gap-4 px-4 py-5 sm:px-6 md:p-8 lg:px-10">
      <nav
        aria-label="Breadcrumb"
        className="min-w-0 truncate text-xs text-muted-foreground"
      >
        <Link href="/agentic-sdlc" className="hover:text-foreground">
          Agentic SDLC
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={`/agentic-sdlc/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}
          className="hover:text-foreground"
        >
          {owner}/{repo}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-foreground">{epicId}</span>
      </nav>
      <EpicView owner={owner} repo={repo} epicId={epicId} />
    </div>
  );
}
