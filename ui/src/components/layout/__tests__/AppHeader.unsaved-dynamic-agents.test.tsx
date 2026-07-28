/** User-facing unsaved-change behavior for application navigation links. */

import React from "react";
import { render, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be hoisted above component import
// ============================================================================

let mockPathname = "/dynamic-agents";
const mockRequestNavigation = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    onClick,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
  }) => (
    <a href={href} onClick={onClick} className={className} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

jest.mock("@/store/unsaved-changes-store", () => ({
  useUnsavedChangesStore: jest.fn(),
}));

import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { GuardedNavigationLink } from "../GuardedNavigationLink";

// ============================================================================
// Tests
// ============================================================================

describe("GuardedNavigationLink", () => {
  beforeEach(() => {
    mockRequestNavigation.mockReset();
    (useUnsavedChangesStore as unknown as jest.Mock).mockReset();
  });

  it("on /dynamic-agents with unsaved changes: click is intercepted", () => {
    mockPathname = "/dynamic-agents";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(
      <GuardedNavigationLink href="/chat">Chat</GuardedNavigationLink>,
    );
    const link = getByTestId("link-/chat");

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventSpy = jest.spyOn(ev, "preventDefault");
    link.dispatchEvent(ev);

    expect(preventSpy).toHaveBeenCalled();
    expect(mockRequestNavigation).toHaveBeenCalledWith("/chat");
  });

  it("on /dynamic-agents with NO unsaved changes: click is NOT intercepted", () => {
    mockPathname = "/dynamic-agents";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: false,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(
      <GuardedNavigationLink href="/chat">Chat</GuardedNavigationLink>,
    );
    fireEvent.click(getByTestId("link-/chat"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });

  it("on an unrelated path with unsaved changes: click is NOT intercepted", () => {
    mockPathname = "/some-other-page";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(
      <GuardedNavigationLink href="/chat">Chat</GuardedNavigationLink>,
    );
    fireEvent.click(getByTestId("link-/chat"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });

  it("on /workflows with unsaved changes: click is intercepted", () => {
    mockPathname = "/workflows";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(
      <GuardedNavigationLink href="/chat">Chat</GuardedNavigationLink>,
    );
    const link = getByTestId("link-/chat");

    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventSpy = jest.spyOn(ev, "preventDefault");
    link.dispatchEvent(ev);

    expect(preventSpy).toHaveBeenCalled();
    expect(mockRequestNavigation).toHaveBeenCalledWith("/chat");
  });

  it("clicking a link to the SAME pathname is not intercepted (no-op navigation)", () => {
    mockPathname = "/dynamic-agents";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(
      <GuardedNavigationLink href="/dynamic-agents">Self</GuardedNavigationLink>
    );
    fireEvent.click(getByTestId("link-/dynamic-agents"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });
});
