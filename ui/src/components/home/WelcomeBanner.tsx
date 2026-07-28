"use client";

import { Settings,Sparkles } from "lucide-react";
import { useEffect,useRef } from "react";

interface WelcomeBannerProps {
  userName?: string | null;
  onOpenPreferences?: () => void;
}

export function WelcomeBanner({ userName, onOpenPreferences }: WelcomeBannerProps) {
  const greeting = getGreeting();
  const displayName = userName?.split(" ")[0] || userName;
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const handlePointerMove = (event: PointerEvent) => {
      const banner = bannerRef.current;
      if (!banner || window.innerWidth === 0 || window.innerHeight === 0) return;
      const x = Math.max(0,Math.min(100,(event.clientX / window.innerWidth) * 100));
      const y = Math.max(0,Math.min(100,(event.clientY / window.innerHeight) * 100));
      banner.style.setProperty("--welcome-pointer-x",`${x.toFixed(1)}%`);
      banner.style.setProperty("--welcome-pointer-y",`${y.toFixed(1)}%`);
    };

    window.addEventListener("pointermove",handlePointerMove,{ passive: true });
    return () => {
      window.removeEventListener("pointermove",handlePointerMove);
    };
  },[]);

  return (
    <div
      className="welcome-banner relative isolate overflow-hidden rounded-xl p-6"
      data-testid="welcome-banner"
      ref={bannerRef}
    >
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="welcome-banner-sparkle h-5 w-5 text-white/80" />
            <span className="text-sm font-medium text-white/80">{greeting}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {displayName ? `Welcome back, ${displayName}` : "Welcome to CAIPE"}
          </h1>
          <p className="text-sm text-white/70 mt-1">
            What do you want to get done today?
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
