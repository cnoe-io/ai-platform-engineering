"use client";

import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight,BrainCircuit,Megaphone,Shield,SlidersHorizontal } from "lucide-react";
import Link from "next/link";

interface SettingsCenterLinksProps {
  readOnly?: boolean;
  readOnlyReason?: string;
  section?: "general" | "ai-review";
}

const GENERAL_LINKS = [
  {
    href: "/settings/platform/defaults",
    label: "Platform defaults",
    description: "Choose the fallback agent for people without a personal default.",
    icon: SlidersHorizontal,
  },
  {
    href: "/settings/platform/access",
    label: "Access before sign-in",
    description: "Review access granted to unlinked Slack and Webex callers.",
    icon: Shield,
  },
  {
    href: "/settings/platform/announcements",
    label: "Announcements",
    description: "Control the release announcement shown after login.",
    icon: Megaphone,
  },
] as const;

export function SettingsCenterLinks({
  readOnly = false,
  readOnlyReason = "Platform-admin access is required to manage these settings",
  section = "general",
}: SettingsCenterLinksProps): React.ReactElement {
  const links = section === "ai-review"
    ? [{
        href: "/settings/platform/ai-review",
        label: "AI review",
        description: "Configure review policies for AI-generated changes.",
        icon: BrainCircuit,
      }]
    : GENERAL_LINKS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section === "ai-review" ? "AI review settings moved" : "Platform settings moved"}</CardTitle>
        <CardDescription>
          Platform configuration now lives in the Settings Center, where platform scope is separated from personal preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {links.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              <span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          );

          return readOnly ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-border/70 p-4 opacity-60"
              key={item.href}
              title={readOnlyReason}
            >
              {content}
            </div>
          ) : (
            <Link
              className={cn(
                "flex items-start gap-3 rounded-lg border border-border/70 p-4 transition-colors",
                "hover:border-primary/40 hover:bg-primary/5",
              )}
              href={item.href}
              key={item.href}
            >
              {content}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
