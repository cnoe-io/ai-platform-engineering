import { config } from "@/lib/config";

/**
 * Keep the public route name stable while allowing the private deployment to
 * present the same destination as its TOME workspace.
 */
export function getProjectsNavigationLabel(): "Projects" | "TOME" {
  return config.tomeEnabled ? "TOME" : "Projects";
}
