"use client";

import { Settings,Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";

interface WelcomeBannerProps {
  onOpenPreferences?: () => void;
}

export function WelcomeBanner({ onOpenPreferences }: WelcomeBannerProps = {}) {
  const { data: session } = useSession();
  const userName = session?.user?.name;
  const greeting = getGreeting();
  const displayName = userName?.split(" ")[0] || userName;

  return (
    <div
      className="welcome-banner relative isolate overflow-hidden rounded-xl px-5 py-3"
      data-testid="welcome-banner"
    >
      <div className="relative z-10 flex min-h-8 items-center justify-between gap-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden"
          data-testid="welcome-banner-copy"
        >
          <Sparkles className="welcome-banner-sparkle h-4 w-4 shrink-0 text-white/80" />
          <span className="shrink-0 whitespace-nowrap text-sm font-medium text-white/80">
            {greeting}
          </span>
          <h1 className="truncate whitespace-nowrap text-lg font-semibold leading-none text-white">
            {displayName ? `Welcome back, ${displayName}` : "Welcome to CAIPE"}
          </h1>
        </div>
        {onOpenPreferences && (
          <button
            onClick={onOpenPreferences}
            data-testid="preferences-shortcut"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/25"
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
