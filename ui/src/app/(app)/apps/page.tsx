// assisted-by Codex Codex-sonnet-4-6

import { AgenticAppsHub } from "@/components/agentic-apps/AgenticAppsHub";
import {
  getEnabledAgenticApps,
  isAgenticAppsInstallEnabled,
} from "@/lib/agentic-apps/registry";
import { notFound } from "next/navigation";

export default function AppsPage() {
  if (!isAgenticAppsInstallEnabled()) {
    notFound();
  }

  const apps = getEnabledAgenticApps().filter((app) => app.surfaces.showInHub);

  return <AgenticAppsHub apps={apps} />;
}
