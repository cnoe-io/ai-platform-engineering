import { render, screen } from "@testing-library/react";

import { RagAuthIndicator } from "../RagAuthBanner";

const mockUseRagPermissions = jest.fn();

jest.mock("@/hooks/useRagPermissions", () => ({
  Permission: {
    READ: "read",
    INGEST: "ingest",
    DELETE: "delete",
  },
  useRagPermissions: () => mockUseRagPermissions(),
}));

describe("RagAuthIndicator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render trusted-network status from stale user info fields", () => {
    mockUseRagPermissions.mockReturnValue({
      userInfo: {
        email: "user@example.com",
        role: "readonly",
        is_authenticated: true,
        permissions: ["read"],
        in_trusted_network: true,
      },
      hasPermission: (permission: string) => permission === "read",
      isLoading: false,
    });

    render(<RagAuthIndicator />);

    expect(screen.queryByText("Trusted network")).not.toBeInTheDocument();
  });

  it("shows non-admin status for normal KB access", () => {
    mockUseRagPermissions.mockReturnValue({
      userInfo: {
        email: "authenticated-user",
        role: "OPENFGA",
        is_authenticated: true,
        permissions: ["read"],
      },
      hasPermission: (permission: string) => permission === "read",
      isLoading: false,
    });

    render(<RagAuthIndicator />);

    expect(screen.getByText("Non-admin")).toBeInTheDocument();
    expect(screen.queryByText("authenticated-user")).not.toBeInTheDocument();
    expect(screen.queryByText("Role:")).not.toBeInTheDocument();
    expect(screen.queryByText("OPENFGA")).not.toBeInTheDocument();
  });

  it("shows admin status for org-admin RAG access", () => {
    mockUseRagPermissions.mockReturnValue({
      userInfo: {
        email: "authenticated-user",
        role: "ADMIN",
        is_authenticated: true,
        permissions: ["read", "ingest", "delete"],
      },
      hasPermission: () => true,
      isLoading: false,
    });

    render(<RagAuthIndicator />);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText("authenticated-user")).not.toBeInTheDocument();
  });
});
