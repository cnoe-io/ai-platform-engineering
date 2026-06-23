// assisted-by Codex Codex-sonnet-4-6

import { AgenticAppEmbed } from "./AgenticAppEmbed";
import { AuthGuard } from "@/components/auth-guard";

interface EmbedPageProps {
  params: Promise<{ appId: string }>;
}

/**
 * Embed shell for Agentic Apps that opt into `runtime.chrome === "iframe"`.
 *
 * Routes like `/apps/embed/<id>` render the upstream app inside an `<iframe>`
 * underneath the standard CAIPE shell (top header + banner). The iframe `src`
 * is the physical proxy mount path (e.g. `/apps/<id>`), so all of the
 * upstream's XHR/fetch traffic continues to flow through CAIPE's reverse
 * proxy at `/apps/[appId]/[[...path]]/route.ts`.
 *
 * Apps with `runtime.chrome === "fullscreen"` (default) skip this page and
 * launch directly at `manifest.runtime.mountPath` — the upstream owns the
 * whole viewport. Switching modes is a manifest-only change; no UI plumbing.
 */
export default async function AgenticAppEmbedPage({ params }: EmbedPageProps) {
  const { appId } = await params;
  return (
    <AuthGuard>
      <AgenticAppEmbed appId={appId} />
    </AuthGuard>
  );
}
