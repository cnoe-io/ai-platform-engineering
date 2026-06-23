import { AuthGuard } from "@/components/auth-guard";
import { CatalogExplorer } from "@/components/projects/CatalogExplorer";

export default function CatalogPage() {
  return (
    <AuthGuard>
      <CatalogExplorer />
    </AuthGuard>
  );
}
