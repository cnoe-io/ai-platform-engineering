"use client";

import { AppHeader } from "@/components/layout/AppHeader";
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
    <div className="h-screen flex flex-col bg-background noise-overlay">
      <AppHeader />
      <LiveStreamBanner />
      {children}
    </div>
  );
}
