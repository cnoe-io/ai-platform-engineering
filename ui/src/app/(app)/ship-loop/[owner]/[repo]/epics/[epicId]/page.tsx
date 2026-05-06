import Link from "next/link";

import { EpicView } from "@/components/ship-loop/EpicView";

/**
 * Per-Epic page. Server component thinly wraps the client EpicView
 * which owns the data hook + visualisation switcher.
 *
 * Layout/auth gating happens in the parent layout; this page is
 * just routing + a breadcrumb.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default async function ShipLoopEpicPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; epicId: string }>;
}) {
  const { owner, repo, epicId } = await params;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6 md:p-8">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/ship-loop" className="hover:text-foreground">
          Ship Loop
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={`/ship-loop/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}
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
