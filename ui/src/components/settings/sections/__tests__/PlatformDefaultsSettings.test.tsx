/**
 * @jest-environment jsdom
 */

import { fireEvent,render,screen,waitFor } from "@testing-library/react";

import { PlatformDefaultsSettings } from "../PlatformDefaultsSettings";

const AGENTS = [
  { _id: "sre",name: "Basic SRE",description: "Handles SRE workflows" },
  { _id: "kb",name: "Knowledge Base Agent",description: "Answers from knowledge bases" },
];

function installFetchMock({
  defaultAgentId = null,
  patchSuccess = true,
  source = "db",
}: {
  defaultAgentId?: string | null;
  patchSuccess?: boolean;
  source?: string;
} = {}): jest.Mock {
  const mock = jest.fn(async (input: RequestInfo | URL,init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/api/dynamic-agents/available")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: AGENTS }),
      } as Response;
    }
    if (path.includes("/api/admin/platform-config") && init?.method === "PATCH") {
      return {
        ok: patchSuccess,
        status: patchSuccess ? 200 : 500,
        json: async () => patchSuccess
          ? ({ success: true,data: { default_agent_id: defaultAgentId } })
          : ({ success: false,error: "Platform update failed" }),
      } as Response;
    }
    if (path.includes("/api/admin/platform-config")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true,data: { default_agent_id: defaultAgentId,source } }),
      } as Response;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  global.fetch = mock;
  return mock;
}

describe("PlatformDefaultsSettings",() => {
  beforeEach(() => {
    jest.clearAllMocks();
    installFetchMock();
  });

  it("shows a neutral no-default option without a Save button",async () => {
    render(<PlatformDefaultsSettings />);

    const picker = await screen.findByRole("button",{ name: /Platform default agent for new chats/i });
    fireEvent.click(picker);
    expect(await screen.findByRole("option",{ name: "No default agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button",{ name: /^save$/i })).not.toBeInTheDocument();
  });

  it("disables the platform agent picker in read-only simulation",async () => {
    render(<PlatformDefaultsSettings readOnly />);

    expect(
      await screen.findByRole("button",{ name: /Platform default agent for new chats/i }),
    ).toBeDisabled();
  });

  it("opens confirmation as soon as a consequential selection is made",async () => {
    const fetchMock = installFetchMock();
    render(<PlatformDefaultsSettings />);

    fireEvent.click(await screen.findByRole("button",{ name: /Platform default agent for new chats/i }));
    fireEvent.click(await screen.findByRole("option",{ name: "Basic SRE" }));

    expect(await screen.findByText(/Make “Basic SRE” the platform default/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/admin/platform-config",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("persists the acknowledged selection after confirmation",async () => {
    const fetchMock = installFetchMock();
    render(<PlatformDefaultsSettings />);

    fireEvent.click(await screen.findByRole("button",{ name: /Platform default agent for new chats/i }));
    fireEvent.click(await screen.findByRole("option",{ name: "Basic SRE" }));
    fireEvent.click(await screen.findByRole("button",{ name: "Make it the default" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/platform-config",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            default_agent_id: "sre",
            acknowledge_public_access: true,
          }),
        }),
      );
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("restores the saved selection when confirmation is cancelled",async () => {
    installFetchMock({ defaultAgentId: "sre" });
    render(<PlatformDefaultsSettings />);

    const picker = await screen.findByRole("button",{ name: /Platform default agent for new chats/i });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option",{ name: "Knowledge Base Agent" }));
    fireEvent.click(await screen.findByRole("button",{ name: "Cancel" }));

    await waitFor(() => expect(picker).toHaveTextContent("Basic SRE"));
  });

  it("confirms and persists clearing the platform default",async () => {
    const fetchMock = installFetchMock({ defaultAgentId: "sre" });
    render(<PlatformDefaultsSettings />);

    fireEvent.click(await screen.findByRole("button",{ name: /Platform default agent for new chats/i }));
    fireEvent.click(await screen.findByRole("option",{ name: "No default agent" }));
    expect(await screen.findByText(/Remove the platform default agent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{ name: "Remove default" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/platform-config",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ default_agent_id: null,acknowledge_public_access: true }),
        }),
      );
    });
  });

  it("shows when the current value comes from deployment configuration",async () => {
    installFetchMock({ defaultAgentId: "sre",source: "env" });
    render(<PlatformDefaultsSettings />);

    expect(await screen.findByText(/using the deployment default/i)).toBeInTheDocument();
    expect(screen.getByText("DEFAULT_AGENT_ID")).toBeInTheDocument();
  });
});
