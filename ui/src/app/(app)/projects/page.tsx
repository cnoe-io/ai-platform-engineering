import { AuthGuard } from "@/components/auth-guard";
import { ProjectsHub } from "@/components/projects/ProjectsHub";

export default function ProjectsPage() {
  return (
    <AuthGuard>
      <ProjectsHub />
    </AuthGuard>
  );
}
