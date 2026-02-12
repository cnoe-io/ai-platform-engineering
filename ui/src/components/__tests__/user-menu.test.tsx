/**
 * Unit tests for UserMenu component
 *
 * Tests:
 * - Returns null when ssoEnabled=false
 * - Loading state
 * - Sign In when unauthenticated
 * - User initials, first name, dropdown
 * - User email, Admin/User badge, SSO info
 * - System button, Sign Out, Personal Insights
 * - signOut call, outside click
 * - User image, missing name fallback
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ============================================================================
// Mocks — must be before imports
// ============================================================================

const mockSignIn = jest.fn();
const mockSignOut = jest.fn();
let mockUseSession: jest.Mock;

jest.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

let mockConfig: Record<string, unknown> = {
  ssoEnabled: true,
  mongodbEnabled: true,
  appName: "CAIPE",
  tagline: "Test tagline",
};

jest.mock("@/lib/config", () => ({
  get config() {
    return new Proxy(
      {},
      {
        get(_: unknown, prop: string) {
          return mockConfig[prop];
        },
      }
    );
  },
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef(
      (
        { children, ...props }: { children?: React.ReactNode } & Record<string, unknown>,
        ref: React.Ref<HTMLDivElement>
      ) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      )
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

jest.mock("lucide-react", () => ({
  LogIn: () => <span data-testid="icon-login" />,
  LogOut: () => <span data-testid="icon-logout" />,
  ChevronDown: () => <span data-testid="icon-chevron" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Shield: () => <span data-testid="icon-shield" />,
  Settings: () => <span data-testid="icon-settings" />,
  Lightbulb: () => <span data-testid="icon-lightbulb" />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: React.forwardRef(
    (
      { children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void } & Record<string, unknown>,
      ref: React.Ref<HTMLButtonElement>
    ) => (
      <button ref={ref} onClick={onClick} {...props}>
        {children}
      </button>
    )
  ),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { UserMenu } from "../user-menu";

// ============================================================================
// Tests
// ============================================================================

describe("UserMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = {
      ssoEnabled: true,
      mongodbEnabled: true,
      appName: "CAIPE",
      tagline: "Test tagline",
    };
    mockUseSession = jest.fn().mockReturnValue({
      data: {
        user: { name: "John Doe", email: "john@example.com" },
        role: "user",
      },
      status: "authenticated",
      update: jest.fn(),
    });
  });

  it("returns null when ssoEnabled=false", () => {
    mockConfig = { ...mockConfig, ssoEnabled: false };
    const { container } = render(<UserMenu />);
    expect(container.firstChild).toBeNull();
  });

  it("shows loading state", () => {
    mockUseSession.mockReturnValue({ data: null, status: "loading" });
    const { container } = render(<UserMenu />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows Sign In when unauthenticated", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
    render(<UserMenu />);
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  it("shows user initials from name", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: "Jane Smith", email: "jane@example.com" },
        role: "user",
      },
      status: "authenticated",
      update: jest.fn(),
    });
    render(<UserMenu />);
    expect(screen.getByText("JS")).toBeInTheDocument();
  });

  it("shows first name", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: "Alice Johnson", email: "alice@example.com" },
        role: "user",
      },
      status: "authenticated",
      update: jest.fn(),
    });
    render(<UserMenu />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("opens dropdown on click", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
  });

  it("shows user email in dropdown", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
  });

  it("shows Admin badge for admin role", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { name: "Admin User", email: "admin@example.com" },
        role: "admin",
      },
      status: "authenticated",
      update: jest.fn(),
    });
    render(<UserMenu />);
    fireEvent.click(screen.getByText("Admin"));
    expect(screen.getAllByText("Admin").length).toBeGreaterThanOrEqual(1);
  });

  it("shows User badge for regular user", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("shows 'Authenticated via SSO'", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("Authenticated via SSO")).toBeInTheDocument();
  });

  it("shows System button", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("shows Sign Out button", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
  });

  it("calls signOut on Sign Out click", () => {
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    fireEvent.click(screen.getByText("Sign Out"));
    expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });

  it("shows Personal Insights link when mongodbEnabled", () => {
    mockConfig = { ...mockConfig, mongodbEnabled: true };
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("Personal Insights")).toBeInTheDocument();
  });

  it("hides Personal Insights when mongodbEnabled=false", () => {
    mockConfig = { ...mockConfig, mongodbEnabled: false };
    render(<UserMenu />);
    fireEvent.click(screen.getByText("John"));
    expect(screen.queryByText("Personal Insights")).not.toBeInTheDocument();
  });

  it("closes on outside click", () => {
    render(
      <div>
        <UserMenu />
        <button data-testid="outside">Outside</button>
      </div>
    );
    fireEvent.click(screen.getByText("John"));
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByText("john@example.com")).not.toBeInTheDocument();
  });

  it("shows user image when available", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          name: "Photo User",
          email: "photo@example.com",
          image: "https://example.com/avatar.png",
        },
        role: "user",
      },
      status: "authenticated",
      update: jest.fn(),
    });
    render(<UserMenu />);
    const img = screen.getByRole("img", { name: "Photo User" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/avatar.png");
  });

  it("handles missing name (shows 'User')", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { email: "noname@example.com" },
        role: "user",
      },
      status: "authenticated",
      update: jest.fn(),
    });
    render(<UserMenu />);
    expect(screen.getByText("User")).toBeInTheDocument();
  });
});
