"use client";

import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LiveStreamBanner } from "@/components/layout/LiveStreamBanner";
import { NPSSurvey } from "@/components/nps/NPSSurvey";
import { useUserInit } from "@/hooks/use-user-init";

/**
 * Client shell for authenticated app routes. NPS visibility is passed from the
 * server layout so the first client render matches SSR: `getConfig("npsEnabled")`
 * in a client component can read `DEFAULT_CONFIG` before `window.__APP_CONFIG__`
 * exists, causing React hydration error #418.
 */
export function AppLayoutClient({
  children,
  npsEnabled,
}: {
  children: React.ReactNode;
  npsEnabled: boolean;
}) {
  useUserInit();

  return (
    <div className="h-screen flex flex-col bg-background noise-overlay">
      <AppHeader />
      <LiveStreamBanner />
      {children}
      {npsEnabled && <NPSSurvey />}
    </div>
  );
}
