import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/components/ui/button", () => {
  const MockButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    ),
  );
  MockButton.displayName = "MockButton";
  return { Button: MockButton };
});

interface MockDialogProps {
  open: boolean;
  children: React.ReactNode;
}

interface MockChildrenProps {
  children: React.ReactNode;
}

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: MockDialogProps) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: MockChildrenProps) => <div>{children}</div>,
  DialogHeader: ({ children }: MockChildrenProps) => <div>{children}</div>,
  DialogTitle: ({ children }: MockChildrenProps) => <h2>{children}</h2>,
  DialogDescription: ({ children }: MockChildrenProps) => <p>{children}</p>,
  DialogFooter: ({ children }: MockChildrenProps) => <div>{children}</div>,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({
    children,
    components = {},
  }: {
    children: React.ReactNode;
    components?: Record<string, React.ElementType<{ children: React.ReactNode }>>;
  }) => {
    const text = String(children ?? "");
    const rendered = text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
      const match = part.match(/^\*\*([^*]+)\*\*$/);
      if (!match) return <React.Fragment key={index}>{part}</React.Fragment>;
      const Strong = components.strong ?? "strong";
      return <Strong key={index}>{match[1]}</Strong>;
    });
    const P = components.p;
    return P ? <P>{rendered}</P> : <div>{rendered}</div>;
  },
}));

import { ReleaseUpgradeDialog } from "../ReleaseUpgradeDialog";

const release = {
  version: "0.5.1",
  date: "2026-05-19",
  sections: [
    {
      type: "Features",
      items: [
        { text: "Added Slack and Webex ReBAC migration assistant", scope: "rbac" },
        { text: "Improved admin migration visibility", scope: null },
      ],
    },
  ],
};

describe("ReleaseUpgradeDialog", () => {
  it("shows admin release notes with migration assistant and skip actions", () => {
    const onOpenMigrationAssistant = jest.fn();
    const onSkipUntilNextLogin = jest.fn();
    const onDismissPermanently = jest.fn();

    render(
      <ReleaseUpgradeDialog
        open
        isAdmin
        releaseVersion="0.5.1"
        release={release}
        onOpenMigrationAssistant={onOpenMigrationAssistant}
        onSkipUntilNextLogin={onSkipUntilNextLogin}
        onDismissPermanently={onDismissPermanently}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("What's new in 0.5.1")).toBeInTheDocument();
    expect(screen.getByText("Added Slack and Webex ReBAC migration assistant")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View full changelog" })).toHaveAttribute(
      "href",
      "https://github.com/cnoe-io/ai-platform-engineering/blob/main/CHANGELOG.md",
    );
    expect(screen.getByRole("button", { name: "Open Migration Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip until next login" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Migration Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip until next login" }));
    fireEvent.click(screen.getByRole("button", { name: "Do not show again" }));

    expect(onOpenMigrationAssistant).toHaveBeenCalledTimes(1);
    expect(onSkipUntilNextLogin).toHaveBeenCalledTimes(1);
    expect(onDismissPermanently).toHaveBeenCalledTimes(1);
  });

  it("renders markdown emphasis in release note items", () => {
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin
        releaseVersion="0.5.1"
        release={{
          version: "0.5.1",
          date: "2026-05-19",
          sections: [
            {
              type: "Feat",
              items: [{ text: "**rbac/ui**: gate Graph tab on any-KB-readable", scope: "rbac/ui" }],
            },
          ],
        }}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    expect(screen.queryByText(/\*\*rbac\/ui\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText("rbac/ui", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/gate Graph tab on any-KB-readable/)).toBeInTheDocument();
  });

  it("shows non-admin feature notes without migration assistant language", () => {
    const onDismissPermanently = jest.fn();

    render(
      <ReleaseUpgradeDialog
        open
        isAdmin={false}
        releaseVersion="0.5.1"
        release={release}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={onDismissPermanently}
      />,
    );

    expect(screen.getByText("What's new in 0.5.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Migration Assistant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip until next login" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Do not show again" }));
    expect(screen.queryByText("Added Slack and Webex ReBAC migration assistant")).not.toBeInTheDocument();
    expect(screen.queryByText(/schema migrations/i)).not.toBeInTheDocument();
    expect(onDismissPermanently).toHaveBeenCalledTimes(1);
  });

  it("does not mention migrations to admins when the migration CTA is hidden", () => {
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin
        releaseVersion="0.5.1"
        release={release}
        showMigrationCta={false}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    expect(screen.queryByText(/schema migrations/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Admin migration reminder")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Migration Assistant" })).not.toBeInTheDocument();
  });

  const markdownNotes = {
    matchedVersion: "0.5.7",
    title: "Release 0.5.7",
    date: "2026-06-04",
    body: [
      "## Highlights",
      "Brand new feature for everyone.",
      "",
      "## Upgrade Guide: 0.5.6 → 0.5.7",
      "Run the migration runbook before applying schema changes.",
    ].join("\n"),
  };

  it("renders the full curated markdown body and prefers it over parsed sections (admin)", () => {
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin
        releaseVersion="0.5.7"
        release={release}
        releaseMarkdown={markdownNotes}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    // Curated markdown body is rendered.
    expect(screen.getByText(/Brand new feature for everyone/)).toBeInTheDocument();
    // Admins see the Upgrade Guide section.
    expect(screen.getByText(/Run the migration runbook/)).toBeInTheDocument();
    // The terse parsed CHANGELOG sections are NOT shown when markdown is present.
    expect(screen.queryByText("Added Slack and Webex ReBAC migration assistant")).not.toBeInTheDocument();
  });

  it("hides the admin Upgrade Guide portion of the markdown body for non-admins", () => {
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin={false}
        releaseVersion="0.5.7"
        release={release}
        releaseMarkdown={markdownNotes}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    expect(screen.getByText(/Brand new feature for everyone/)).toBeInTheDocument();
    // Non-admins do not see the upgrade runbook / migration content.
    expect(screen.queryByText(/Run the migration runbook/)).not.toBeInTheDocument();
  });

  it("uses user-centric 0.5.1 highlights when release details are unavailable", () => {
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin={false}
        releaseVersion="dev"
        release={null}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    expect(screen.getByText("What's new in dev")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use the same agents and knowledge from the web UI, Slack, and Webex with more consistent permissions.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Get clearer next steps when a Slack channel or Webex space needs to be connected to your team.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Stay signed in through longer CAIPE sessions during normal work and validation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Review the dev release notes for new CAIPE platform capabilities."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/ReBAC admin diagnostics/i)).not.toBeInTheDocument();
  });
});
