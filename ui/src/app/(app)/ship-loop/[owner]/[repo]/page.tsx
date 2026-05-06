import Link from "next/link";

import { RepoEpicList } from "@/components/ship-loop/RepoEpicList";

/**
 * Per-repo Epic list page.
 *
 * Server component (no client state) that hands the {owner, repo}
 * pair down to the client `RepoEpicList`. The parent layout
 * already enforces the server-side feature toggle and the per-user
 * gate, so this page only has to construct the URL crumbs.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default async function ShipLoopRepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-6 md:p-8 lg:px-12">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/ship-loop" className="hover:text-foreground">
          Ship Loop
        </Link>
        <span className="mx-1">/</span>
        <span className="text-foreground">
          {owner}/{repo}
        </span>
      </nav>
      <h1 className="text-xl font-semibold">
        <span className="text-muted-foreground">{owner}/</span>
        <span className="text-foreground">{repo}</span>
      </h1>
      <RepoEpicList owner={owner} repo={repo} />
    </div>
  );
}
