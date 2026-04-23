import { getServerConfig } from "@/lib/config";
import { AppLayoutClient } from "./app-layout-client";

/**
 * Server wrapper: pass NPS flag from the same config source as `window.__APP_CONFIG__`
 * so the client tree matches SSR and avoids hydration mismatches.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const npsEnabled = getServerConfig().npsEnabled;

  return <AppLayoutClient npsEnabled={npsEnabled}>{children}</AppLayoutClient>;
}
