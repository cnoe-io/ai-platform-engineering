import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockShareDialog = jest.fn(() => null);

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: unknown) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: unknown) => <>{children}</>,
  TooltipContent: ({ children }: unknown) => <>{children}</>,
  TooltipProvider: ({ children }: unknown) => <>{children}</>,
  TooltipTrigger: ({ children }: unknown) => <>{children}</>,
}));

jest.mock("lucide-react", () => ({
  Check: (props: unknown) => <span data-testid="icon-check" {...props} />,
  Share2: (props: unknown) => <span data-testid="icon-share2" {...props} />,
  Users2: (props: unknown) => <span data-testid="icon-users2" {...props} />,
}));

jest.mock("../ShareDialog", () => ({
  ShareDialog: (props: unknown) => {
    mockShareDialog(props);
    return props.open ? <div data-testid="share-dialog" /> : null;
  },
}));

import { ShareButton } from "../ShareButton";

describe("ShareButton", () => {
  const writeText = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies the link for read-only shared recipients", async () => {
    render(
      <ShareButton
        conversationId="conv-recipient"
        conversationTitle="Recipient Chat"
        isOwner={false}
        isSharedWithViewer
        sharedBy="owner@test.com"
        accessLevel="shared_readonly"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Shared by owner@test.com" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shared by owner@test.com")).toBeInTheDocument();
    expect(screen.getByText("Click to copy link")).toBeInTheDocument();
    expect(screen.getByTestId("icon-users2")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-share2")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Shared by owner@test.com" }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/chat/conv-recipient`,
      );
    });
    expect(screen.queryByTestId("share-dialog")).not.toBeInTheDocument();
    expect(mockShareDialog).not.toHaveBeenCalled();
  });

  it("opens sharing details for edit-mode shared recipients", async () => {
    render(
      <ShareButton
        conversationId="conv-edit-recipient"
        conversationTitle="Editable Recipient Chat"
        isOwner={false}
        isSharedWithViewer
        sharedBy="owner@test.com"
        accessLevel="shared"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Shared by owner@test.com" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shared by owner@test.com")).toBeInTheDocument();
    expect(screen.queryByText("Click to copy link")).not.toBeInTheDocument();
    expect(screen.getByTestId("icon-users2")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-share2")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Shared by owner@test.com" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("share-dialog")).toBeInTheDocument(),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(mockShareDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        canManageSharing: false,
        open: true,
        sharedBy: "owner@test.com",
      }),
    );
  });

  it("opens the share dialog for owners", () => {
    render(
      <ShareButton
        conversationId="conv-owner"
        conversationTitle="Owner Chat"
        isOwner
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share conversation" }));

    expect(screen.getByTestId("share-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("icon-share2")).toHaveClass("text-foreground");
    expect(screen.queryByTestId("icon-users2")).not.toBeInTheDocument();
  });

  it("uses the blue team icon for owner conversations with active sharing", () => {
    render(
      <ShareButton
        conversationId="conv-owner-shared"
        conversationTitle="Owner Shared Chat"
        isOwner
        sharing={{
          is_public: false,
          shared_with: ["teammate@test.com"],
          shared_with_teams: [],
          share_link_enabled: false,
        }}
      />,
    );

    expect(screen.getByTestId("icon-users2")).toBeInTheDocument();
    expect(screen.getByTestId("icon-users2")).toHaveClass("text-blue-500");
    expect(screen.queryByTestId("icon-share2")).not.toBeInTheDocument();
    expect(screen.getByText("Edit Share")).toBeInTheDocument();
  });
});
