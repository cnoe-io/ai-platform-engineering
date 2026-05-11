/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgenticAppManifest } from "@/types/agentic-app";
import { AgenticAppsHub } from "@/components/agentic-apps/AgenticAppsHub";

const mockGetSettings = jest.fn();
const mockUpdatePreferences = jest.fn();

jest.mock("@/lib/api-client", () => ({
  apiClient: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args),
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
  },
}));

const finopsApp: AgenticAppManifest = {
  id: "finops",
  displayName: "FinOps Dashboard",
  description: "Cloud spend insights.",
  apiVersion: "1.0",
  runtime: {
    kind: "proxied-next-zone",
    origin: "http://localhost:3010",
    mountPath: "/apps/finops",
  },
  surfaces: { showInHub: true },
  access: { tokenScopes: ["finops:read", "agents:invoke"] },
  health: { endpoint: "/healthz" },
};

describe("AgenticAppsHub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      preferences: {
        favorite_agentic_apps: [],
      },
    });
    mockUpdatePreferences.mockResolvedValue({
      preferences: {
        favorite_agentic_apps: ["finops"],
      },
    });
  });

  it("renders configured app launch cards", () => {
    render(<AgenticAppsHub apps={[finopsApp]} />);

    expect(screen.getByRole("heading", { name: "Agentic Apps Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create or add your app/i })).toHaveAttribute(
      "href",
      "/apps/create",
    );
    expect(screen.getByLabelText("FinOps Dashboard app icon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open FinOps Dashboard" })).toHaveAttribute(
      "title",
      "Open FinOps Dashboard",
    );
    expect(screen.queryByText("Open FinOps Dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("FinOps Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Cloud spend insights.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open FinOps Dashboard" })).toHaveAttribute(
      "href",
      "/apps/finops",
    );
  });

  it("hides inline runtime labels and exposes them only via the runtime info tooltip", async () => {
    const user = userEvent.setup();
    render(<AgenticAppsHub apps={[finopsApp]} />);

    const info = screen.getByRole("button", {
      name: /Runtime details for FinOps Dashboard/i,
    });
    expect(info).toBeInTheDocument();
    expect(info).toHaveAttribute("aria-expanded", "false");

    await user.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");

    // Runtime details are now contained in a single info popover rather than
    // sitting as plain badges on the card surface.
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/In-process[\s\S]*runs inside the CAIPE shell/i);
    expect(tooltip).toHaveTextContent(/Separate process[\s\S]*runs as its own service/i);
    expect(tooltip).toHaveTextContent(/This app:\s*Separate process/i);
    expect(tooltip).toHaveTextContent(/proxied-next-zone/i);
  });

  it("pins an app to the home page with user settings", async () => {
    const user = userEvent.setup();
    render(<AgenticAppsHub apps={[finopsApp]} />);

    await user.click(await screen.findByRole("button", { name: "Pin FinOps Dashboard to home" }));

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        favorite_agentic_apps: ["finops"],
      });
    });
    expect(screen.getByRole("button", { name: "Unpin FinOps Dashboard from home" })).toBeInTheDocument();
  });

  it("shows a setup hint when no apps are enabled", () => {
    render(<AgenticAppsHub apps={[]} />);

    expect(screen.getByText(/no agentic apps are enabled/i)).toBeInTheDocument();
    expect(screen.getAllByText(/create or add your app/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/AGENTIC_APPS_ENABLED=finops/i)).toBeInTheDocument();
  });

  it("renders disabled launch controls for blocked app records", () => {
    render(
      <AgenticAppsHub
        apps={[
          {
            ...finopsApp,
            canLaunch: false,
            blockedReasons: ["unauthorized"],
            runtimeStatus: "healthy",
          },
        ]}
      />,
    );

    expect(screen.getByText("Launch blocked")).toBeInTheDocument();
    expect(screen.getByText(/unauthorized/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open FinOps Dashboard" })).not.toBeInTheDocument();
  });

  it("renders blocked cards for disabled, unhealthy, unsupported, and unauthorized states", () => {
    render(
      <AgenticAppsHub
        apps={[
          {
            ...finopsApp,
            id: "disabled",
            displayName: "Disabled App",
            canLaunch: false,
            blockedReasons: ["disabled"],
          },
          {
            ...finopsApp,
            id: "unhealthy",
            displayName: "Unhealthy App",
            canLaunch: false,
            blockedReasons: ["unhealthy"],
          },
          {
            ...finopsApp,
            id: "unsupported",
            displayName: "Unsupported App",
            canLaunch: false,
            blockedReasons: ["unsupported_runtime"],
          },
          {
            ...finopsApp,
            id: "unauthorized",
            displayName: "Unauthorized App",
            canLaunch: false,
            blockedReasons: ["unauthorized"],
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Launch blocked")).toHaveLength(4);
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.getByText("unhealthy")).toBeInTheDocument();
    expect(screen.getByText("unsupported runtime")).toBeInTheDocument();
    expect(screen.getByText("unauthorized")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open Disabled App/i })).not.toBeInTheDocument();
  });
});
