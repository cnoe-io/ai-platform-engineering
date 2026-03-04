"use client";

import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { LiveStreamBanner } from "@/components/layout/LiveStreamBanner";
import { NPSSurvey } from "@/components/nps/NPSSurvey";
import { useUserInit } from "@/hooks/use-user-init";
import { getConfig } from "@/lib/config";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize user in MongoDB on first login
  useUserInit();
  
  return (
    <div className="h-screen flex flex-col bg-background noise-overlay">
      <AppHeader />
      <LiveStreamBanner />
      {children}
      {getConfig('npsEnabled') && <NPSSurvey />}
    </div>
  );
}
