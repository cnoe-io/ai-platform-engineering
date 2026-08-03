"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import {
  ApplicationNavigationDrawer,
  ApplicationNavigationRail,
} from "@/components/layout/ApplicationNavigation";
import { ApplicationNavigationProvider } from "@/components/layout/ApplicationNavigationContext";
import { LiveStreamBanner } from "@/components/layout/LiveStreamBanner";
import { useUserInit } from "@/hooks/use-user-init";
import React from "react";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize user in MongoDB on first login
  useUserInit();
  
  return (
    <ApplicationNavigationProvider>
      <div className="flex h-screen bg-background noise-overlay">
        <ApplicationNavigationRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <LiveStreamBanner />
          <div className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </div>
        <ApplicationNavigationDrawer />
      </div>
    </ApplicationNavigationProvider>
  );
}
