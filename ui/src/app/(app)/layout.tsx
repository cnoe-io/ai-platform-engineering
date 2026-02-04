"use client";

import React from "react";
import { AppHeader } from "@/components/layout/AppHeader";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen flex flex-col bg-background noise-overlay">
      <AppHeader />
      {children}
    </div>
  );
}
