import { notFound } from "next/navigation";

import { AuthGuard } from "@/components/auth-guard";
import { TomeWiki } from "@/components/tome/TomeWiki";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

/**
 * Tome wiki for a CAIPE project, mounted at `/projects/<slug>/tome` — a native
 * surface of the project, not a standalone app. Server-gated on `TOME_ENABLED`
 * (404 when off); page-level RBAC comes from CAIPE project membership in the
 * `/api/tome/**` layer.
 *
 * An optional catch-all (`[[...path]]`) so the active view lives in the URL and
 * is deep-linkable. Trailing segments map to a view (see `TomeWiki`):
 * (none)→agent, `talk`, `ingest`, `ingest/<runId>`, `wiki/<...page>`,
 * `history/<...page>`. The client reads them via `useParams`.
 */
export default async function ProjectTomePage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  if (!isTomeServerEnabled()) {
    notFound();
  }
  const { slug } = await params;
  return (
    <AuthGuard>
      <TomeWiki slug={slug} />
    </AuthGuard>
  );
}
