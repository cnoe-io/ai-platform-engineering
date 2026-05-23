import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/components/ui/button", () => ({
  Button: React.forwardRef(({ children, ...props }: any, ref: any) => (
    <button ref={ref} {...props}>
      {children}
    </button>
  )),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
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
    expect(screen.getByRole("button", { name: "Open Migration Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip until next login" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Migration Assistant" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip until next login" }));
    fireEvent.click(screen.getByRole("button", { name: "Do not show again" }));

    expect(onOpenMigrationAssistant).toHaveBeenCalledTimes(1);
    expect(onSkipUntilNextLogin).toHaveBeenCalledTimes(1);
    expect(onDismissPermanently).toHaveBeenCalledTimes(1);
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
