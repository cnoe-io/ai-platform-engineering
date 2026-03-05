"use client";

import React from "react";
import { Sparkles, Settings } from "lucide-react";

interface WelcomeBannerProps {
  userName?: string | null;
  onOpenPreferences?: () => void;
}

export function WelcomeBanner({ userName, onOpenPreferences }: WelcomeBannerProps) {
  const greeting = getGreeting();
  const displayName = userName?.split(" ")[0] || userName;

  return (
    <div data-testid="welcome-banner" className="relative overflow-hidden rounded-xl gradient-primary-br p-6">
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-white/80" />
            <span className="text-sm font-medium text-white/80">{greeting}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {displayName ? `Welcome back, ${displayName}` : "Welcome to CAIPE"}
          </h1>
          <p className="text-sm text-white/70 mt-1">
            Your AI-powered platform engineering assistant
          </p>
        </div>
        {onOpenPreferences && (
          <button
            onClick={onOpenPreferences}
            data-testid="preferences-shortcut"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-medium transition-colors backdrop-blur-sm"
          >
            <Settings className="h-3.5 w-3.5" />
            Preferences
          </button>
        )}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export { getGreeting };
