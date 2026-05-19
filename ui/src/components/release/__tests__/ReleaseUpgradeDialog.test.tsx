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
    render(
      <ReleaseUpgradeDialog
        open
        isAdmin={false}
        releaseVersion="0.5.1"
        release={release}
        onOpenMigrationAssistant={jest.fn()}
        onSkipUntilNextLogin={jest.fn()}
        onDismissPermanently={jest.fn()}
      />,
    );

    expect(screen.getByText("What's new in 0.5.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Migration Assistant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip until next login" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
    expect(screen.queryByText("Added Slack and Webex ReBAC migration assistant")).not.toBeInTheDocument();
    expect(screen.queryByText(/schema migrations/i)).not.toBeInTheDocument();
  });
});
