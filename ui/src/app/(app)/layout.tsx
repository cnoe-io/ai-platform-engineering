"use client";

import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { useUserInit } from "@/hooks/use-user-init";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Initialize user in MongoDB on first login
  useUserInit();
  
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background noise-overlay">
      <AppHeader />
      {children}
    </div>
  );
}
