"use client";

import { CapabilityCards } from "@/components/home/CapabilityCards";
import { HomeExperienceToggle } from "@/components/home/HomeExperienceToggle";
import { InsightsWidget } from "@/components/home/InsightsWidget";
import { RecentChats } from "@/components/home/RecentChats";
import { SharedConversations } from "@/components/home/SharedConversations";
import { getStorageMode } from "@/lib/storage-config";
import { useHomeWidgetsStore } from "@/store/home-widgets-store";

/**
 * The Home page layout that predates the customizable widget system —
 * kept as an opt-out for users who switch away from the new experience via
 * `HomeExperienceToggle`, until it's retired.
 */
export function ClassicHomePage() {
  const setExperience = useHomeWidgetsStore((s) => s.setExperience);
  const isMongoMode = getStorageMode() === "mongodb";

  return (
    <div className="space-y-6">
      <HomeExperienceToggle
        label="Try the new Home experience"
        onClick={() => setExperience("new")}
        testId="switch-to-new-home"
      />

      <CapabilityCards />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentChats />
        </div>
        {isMongoMode && (
          <div className="lg:col-span-1">
            <InsightsWidget />
          </div>
        )}
      </div>

      {isMongoMode && <SharedConversations />}

      <p className="text-center text-xs text-muted-foreground/50 pt-4 pb-2">
        ⚡ Powered by{" "}
        <a
          href="https://caipe.io"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-muted-foreground/70 transition-colors"
        >
          caipe.io
        </a>
      </p>
    </div>
  );
}
