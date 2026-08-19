"use client";

import { AuthGuard } from "@/components/auth-guard";
import { ClassicHomePage } from "@/components/home/ClassicHomePage";
import { NewHomePage } from "@/components/home/NewHomePage";
import { WelcomeBanner } from "@/components/home/WelcomeBanner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHomeWidgetsStore } from "@/store/home-widgets-store";
import { useEffect } from "react";

export default function HomePage() {
  const experience = useHomeWidgetsStore((s) => s.experience);
  const initialize = useHomeWidgetsStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <AuthGuard>
      <ScrollArea className="flex-1" data-testid="home-page">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <WelcomeBanner />
          {experience === "classic" ? <ClassicHomePage /> : <NewHomePage />}
        </div>
      </ScrollArea>
    </AuthGuard>
  );
}
