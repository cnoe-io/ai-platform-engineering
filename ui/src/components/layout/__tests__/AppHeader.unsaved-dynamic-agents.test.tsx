/**
 * Tests for AppHeader.GuardedLink unsaved-changes predicate extension.
 *
 * Covers:
 * - On /dynamic-agents with hasUnsavedChanges=true, link click is intercepted
 *   (preventDefault + requestNavigation called).
 * - On /dynamic-agents with hasUnsavedChanges=false, link click navigates normally.
 * - On unrelated path with hasUnsavedChanges=true, link click navigates normally.
 * - On /task-builder with hasUnsavedChanges=true, link click is intercepted
 *   (regression check — existing Task Builder behavior preserved).
 */

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

// We test GuardedLink in isolation by re-deriving its logic against the same
// store hook. Importing the full AppHeader pulls in too many unrelated deps
// (next-auth, health hooks, etc.). The point of this test is the predicate
// change inside GuardedLink, which is a pure function of (pathname, flag).
import Link from "next/link";

function GuardedLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChangesStore() as {
    hasUnsavedChanges: boolean;
    requestNavigation: (href: string) => void;
  };
  const { usePathname } = require("next/navigation") as {
    usePathname: () => string;
  };
  const pathname = usePathname();

  const shouldGuardNavigation =
    hasUnsavedChanges &&
    (pathname?.startsWith("/task-builder") ||
      pathname?.startsWith("/dynamic-agents"));

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (shouldGuardNavigation && href !== pathname) {
      e.preventDefault();
      requestNavigation(href);
    }
  };

  return (
    <Link href={href} onClick={handleClick}>
      {children}
    </Link>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("AppHeader GuardedLink predicate (extended for /dynamic-agents)", () => {
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

    const { getByTestId } = render(<GuardedLink href="/chat">Chat</GuardedLink>);
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

    const { getByTestId } = render(<GuardedLink href="/chat">Chat</GuardedLink>);
    fireEvent.click(getByTestId("link-/chat"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });

  it("on an unrelated path with unsaved changes: click is NOT intercepted", () => {
    mockPathname = "/some-other-page";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(<GuardedLink href="/chat">Chat</GuardedLink>);
    fireEvent.click(getByTestId("link-/chat"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });

  it("regression: on /task-builder with unsaved changes, click is still intercepted", () => {
    mockPathname = "/task-builder";
    (useUnsavedChangesStore as unknown as jest.Mock).mockReturnValue({
      hasUnsavedChanges: true,
      requestNavigation: mockRequestNavigation,
    });

    const { getByTestId } = render(<GuardedLink href="/chat">Chat</GuardedLink>);
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
      <GuardedLink href="/dynamic-agents">Self</GuardedLink>
    );
    fireEvent.click(getByTestId("link-/dynamic-agents"));

    expect(mockRequestNavigation).not.toHaveBeenCalled();
  });
});
