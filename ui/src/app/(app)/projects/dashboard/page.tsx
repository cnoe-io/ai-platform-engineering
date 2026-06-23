import { AuthGuard } from "@/components/auth-guard";
import { ProjectsDashboard } from "@/components/projects/ProjectsDashboard";

export default function ProjectsDashboardPage() {
  return (
    <AuthGuard>
      <ProjectsDashboard />
    </AuthGuard>
  );
}
