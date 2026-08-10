import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionDebuggerTab } from "../PermissionDebuggerTab";

describe("PermissionDebuggerTab", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the admin-required message when not admin", () => {
    render(<PermissionDebuggerTab isAdmin={false} />);
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
  });

  it("spells out the service name (no bare acronym) in the description", () => {
    render(<PermissionDebuggerTab isAdmin={true} />);
    expect(screen.getByText(/Centralized Authorization Service/i)).toBeInTheDocument();
  });

  it("disables Explain until subject and resource ids are filled", () => {
    render(<PermissionDebuggerTab isAdmin={true} />);
    const explain = screen.getByRole("button", { name: /Explain/i });
    expect(explain).toBeDisabled();
  });

  it("submits an explain request and renders the decision + OpenFGA debug block", async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        decision: "DENY",
        reason: "NO_CAPABILITY",
        retriable: false,
        debug: { engine: "openfga", relation: "can_use", checked: ["user:bob can_use agent:pe"], store: "store-xyz" },
      }),
    });
    render(<PermissionDebuggerTab isAdmin={true} />);

    fireEvent.change(screen.getByPlaceholderText(/subject id/i), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText(/resource id/i), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));

    await waitFor(() => expect(screen.getByText("DENY")).toBeInTheDocument());
    expect(screen.getByText("can_use")).toBeInTheDocument();
    expect(screen.getByText("user:bob can_use agent:pe")).toBeInTheDocument();

    const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(sentBody).toEqual({
      subject: { type: "user", id: "bob" },
      resource: { type: "agent", id: "pe" },
      action: "use",
    });
  });

  it("surfaces an error from a failed explain call", async () => {
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });
    render(<PermissionDebuggerTab isAdmin={true} />);
    fireEvent.change(screen.getByPlaceholderText(/subject id/i), { target: { value: "bob" } });
    fireEvent.change(screen.getByPlaceholderText(/resource id/i), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    await waitFor(() => expect(screen.getByText("nope")).toBeInTheDocument());
  });
});
