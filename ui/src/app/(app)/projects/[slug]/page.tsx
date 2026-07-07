import { redirect } from "next/navigation";

import { AuthGuard } from "@/components/auth-guard";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";
import { isTomeServerEnabled } from "@/lib/tome/guard";

/**
 * Project detail (apps grid + edit/delete). When Tome is enabled it's the
 * project's primary surface, so opening a project bounces straight into it —
 * skipping this grid as an intermediary hop. The detail page stays reachable
 * via `?apps=1` (Tome's back breadcrumb points here) so project settings and
 * any other app tiles aren't orphaned.
 */
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ apps?: string }>;
}) {
  const { slug } = await params;
  const { apps } = await searchParams;

  if (isTomeServerEnabled() && apps === undefined) {
    redirect(`/projects/${slug}/tome`);
  }

  return (
    <AuthGuard>
      <ProjectDetailView slug={slug} />
    </AuthGuard>
  );
}
