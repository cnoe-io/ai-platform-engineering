import { AuthGuard } from "@/components/auth-guard";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <AuthGuard>
      <ProjectDetailView slug={slug} />
    </AuthGuard>
  );
}
