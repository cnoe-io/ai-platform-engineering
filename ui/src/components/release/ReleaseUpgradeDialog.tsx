"use client";

import { ArrowRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReleaseMarkdown, ReleaseNote } from "@/hooks/use-release-upgrade-prompt";

interface ReleaseUpgradeDialogProps {
  open: boolean;
  isAdmin: boolean;
  releaseVersion: string;
  release: ReleaseNote | null;
  releaseMarkdown?: ReleaseMarkdown | null;
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

/**
 * The curated release blog posts end with an admin-oriented "Upgrade Guide"
 * (runbook, Helm values diff, data migrations). Non-admins only see the
 * user-facing portion above it.
 */
function userVisibleMarkdownBody(body: string, isAdmin: boolean): string {
  if (isAdmin) return body;
  const lines = body.split("\n");
  const cutIndex = lines.findIndex((line) => /^#{1,6}\s+upgrade guide\b/i.test(line.trim()));
  const visible = cutIndex >= 0 ? lines.slice(0, cutIndex) : lines;
  return visible.join("\n").replace(/\n*-{3,}\s*$/g, "").trim();
}

/** Rich-markdown renderer for the full curated release notes body. */
function ReleaseNotesMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h2 className="mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>,
        h2: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
        h3: ({ children }) => (
          <h4 className="mt-3 text-sm font-semibold text-muted-foreground first:mt-0">{children}</h4>
        ),
        p: ({ children }) => <p className="my-2 text-sm leading-relaxed text-muted-foreground">{children}</p>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        code: ({ className, children }) => {
          const isBlock = (className ?? "").includes("language-");
          if (isBlock) {
            return <code className="font-mono text-xs">{children}</code>;
          }
          return (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{children}</code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{children}</pre>
        ),
        hr: () => <hr className="my-3 border-border" />,
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}

function ReleaseNoteItemMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function ReleaseUpgradeDialog({
  open,
  isAdmin,
  releaseVersion,
  release,
  releaseMarkdown = null,
  onOpenMigrationAssistant,
  onSkipUntilNextLogin,
  onDismissPermanently,
  showMigrationCta = true,
  isDismissing = false,
}: ReleaseUpgradeDialogProps) {
  const markdownBody = releaseMarkdown?.body
    ? userVisibleMarkdownBody(releaseMarkdown.body, isAdmin)
    : null;
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

        <div className="max-h-[420px] overflow-y-auto rounded-lg border bg-muted/20 p-4">
          {markdownBody ? (
            <div className="min-w-0">
              <ReleaseNotesMarkdown body={markdownBody} />
            </div>
          ) : (
            <div className="space-y-4">
              {visibleSections.map((section) => (
                <section key={section.type} className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">{section.type}</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {section.items.map((item, index) => (
                      <li key={`${section.type}-${index}`} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span className="min-w-0">
                          <ReleaseNoteItemMarkdown text={item.text} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
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
