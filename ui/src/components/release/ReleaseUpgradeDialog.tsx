"use client";

import { ArrowRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReleaseNote } from "@/hooks/use-release-upgrade-prompt";

interface ReleaseUpgradeDialogProps {
  open: boolean;
  isAdmin: boolean;
  releaseVersion: string;
  release: ReleaseNote | null;
  onOpenMigrationAssistant: () => void;
  onSkipUntilNextLogin: () => void;
  onDismissPermanently: () => void | Promise<void>;
  showMigrationCta?: boolean;
  isDismissing?: boolean;
}

const RELEASE_051_FALLBACK_SECTIONS: ReleaseNote["sections"] = [
  {
    type: "Highlights",
    items: [
      {
        text: "Use the same agents and knowledge from the web UI, Slack, and Webex with more consistent permissions.",
        scope: null,
      },
      {
        text: "Get clearer next steps when a Slack channel or Webex space needs to be connected to your team.",
        scope: null,
      },
      {
        text: "Stay signed in through longer CAIPE sessions during normal work and validation.",
        scope: null,
      },
    ],
  },
  {
    type: "Admin and Operator Notes",
    items: [
      {
        text: "ReBAC admin diagnostics now show migration health, graph views, tuple checks, and access decisions.",
        scope: "admin",
      },
      {
        text: "Keycloak reconciliation, token exchange, bot client secrets, and the CAIPE login theme are now chart-managed.",
        scope: "admin",
      },
      {
        text: "RBAC matrix, Playwright, and CI checks were expanded across Keycloak init, OpenFGA bridge, Webex bot, and docs validation.",
        scope: "admin",
      },
    ],
  },
];

function fallbackSections(releaseVersion: string): ReleaseNote["sections"] {
  const normalizedReleaseVersion = releaseVersion.trim().replace(/^v/, "").toLowerCase();
  if (normalizedReleaseVersion === "0.5.1" || normalizedReleaseVersion === "dev") {
    return RELEASE_051_FALLBACK_SECTIONS;
  }

  return [
    {
      type: "Highlights",
      items: [
        {
          text: `Review the ${releaseVersion} release notes for new CAIPE platform capabilities.`,
          scope: null,
        },
      ],
    },
  ];
}

function userVisibleSections(sections: ReleaseNote["sections"], isAdmin: boolean): ReleaseNote["sections"] {
  if (isAdmin) return sections;

  const adminOnlyPattern = /\b(admin|migration|migrations|schema|rbac|rebac|openfga)\b/i;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !adminOnlyPattern.test(`${item.scope ?? ""} ${item.text}`)),
    }))
    .filter((section) => section.items.length > 0);
}

export function ReleaseUpgradeDialog({
  open,
  isAdmin,
  releaseVersion,
  release,
  onOpenMigrationAssistant,
  onSkipUntilNextLogin,
  onDismissPermanently,
  showMigrationCta = true,
  isDismissing = false,
}: ReleaseUpgradeDialogProps) {
  const sourceSections = release?.sections?.length ? release.sections : fallbackSections(releaseVersion);
  const sections = userVisibleSections(sourceSections, isAdmin);
  const visibleSections = sections.length > 0 ? sections : fallbackSections(releaseVersion);
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    if (isAdmin) {
      onSkipUntilNextLogin();
      return;
    }
    void onDismissPermanently();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>What&apos;s new in {releaseVersion}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "This deployment includes new release updates and schema migrations. Review the notes, then open the migration assistant when you are ready."
              : "This deployment includes CAIPE updates that make agent access and chat connector setup easier to understand."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[360px] space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4">
          {visibleSections.map((section) => (
            <section key={section.type} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{section.type}</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {section.items.map((item, index) => (
                  <li key={`${section.type}-${index}`} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {isAdmin && showMigrationCta && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
            <div className="font-medium">Admin migration reminder</div>
            <div className="mt-1 text-xs">
              Run dry-runs before applying {releaseVersion} schema migrations, especially RBAC and messaging ReBAC backfills.
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          {isAdmin ? (
            <>
              <Button variant="ghost" onClick={onSkipUntilNextLogin} className="gap-2">
                <Clock3 className="h-4 w-4" />
                Skip until next login
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={onDismissPermanently} disabled={isDismissing}>
                  Do not show again
                </Button>
                {showMigrationCta && (
                  <Button onClick={onOpenMigrationAssistant} className="gap-2">
                    Open Migration Assistant
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Button onClick={onDismissPermanently} disabled={isDismissing}>
              Do not show again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
