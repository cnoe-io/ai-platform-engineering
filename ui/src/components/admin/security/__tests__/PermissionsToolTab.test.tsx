import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionsToolTab } from "../../PermissionsToolTab";

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

const MATRIX = {
  results: [
    { action: "use", decision: "ALLOW", reason: "OK", retriable: false, via: "org_admin", debug: { engine: "openfga", relation: "can_use", checked: ["user:bob-sub can_use agent:pe"], store: "s" } },
    { action: "read", decision: "DENY", reason: "NO_CAPABILITY", retriable: false, debug: { engine: "openfga", relation: "can_read", checked: ["user:bob-sub can_read agent:pe"], store: "s" } },
  ],
};

function routedFetch(opts: { explain?: unknown; explainOk?: boolean; resources?: { id: string }[] } = {}) {
  const { explain = {}, explainOk = true, resources = [{ id: "pe" }, { id: "agent-sre-agent" }] } = opts;
  return jest.fn((url: string) => {
    const u = String(url);
    if (u.includes("/api/admin/users")) return ok([{ id: "bob-sub", email: "bob@example.com" }]);
    if (u.includes("/api/admin/authz/resources")) return ok({ resources });
    if (u.includes("/api/admin/authz/explain")) return Promise.resolve({ ok: explainOk, json: async () => explain } as Response);
    return ok({});
  });
}

describe("PermissionsToolTab", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the admin-required message when not admin", () => {
    render(<PermissionsToolTab isAdmin={false} />);
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
  });

  it("spells out the service name (no bare acronym)", () => {
    (global.fetch as jest.Mock) = routedFetch();
    render(<PermissionsToolTab isAdmin={true} />);
    expect(screen.getByText(/Centralized Authorization Service/i)).toBeInTheDocument();
  });

  it("renders a pick dropdown AND an editable text field for subject and resource", async () => {
    (global.fetch as jest.Mock) = routedFetch();
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" }); // users loaded
    await screen.findByRole("option", { name: "agent-sre-agent" }); // resources (OpenFGA) loaded
    expect((screen.getByLabelText("Subject options") as HTMLElement).tagName).toBe("SELECT");
    expect((screen.getByLabelText("Subject") as HTMLElement).tagName).toBe("INPUT");
    expect((screen.getByLabelText("Resource options") as HTMLElement).tagName).toBe("SELECT");
    expect((screen.getByLabelText("Resource") as HTMLElement).tagName).toBe("INPUT");
  });

  it("picking a resource from the dropdown fills the editable text field", async () => {
    (global.fetch as jest.Mock) = routedFetch();
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "agent-sre-agent" });
    fireEvent.change(screen.getByLabelText("Resource options"), { target: { value: "agent-sre-agent" } });
    expect((screen.getByLabelText("Resource") as HTMLInputElement).value).toBe("agent-sre-agent");
  });

  it("evaluates the whole matrix and renders a row per action", async () => {
    (global.fetch as jest.Mock) = routedFetch({ explain: MATRIX });
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" });
    fireEvent.change(screen.getByLabelText("Subject options"), { target: { value: "bob-sub" } });
    fireEvent.change(screen.getByLabelText("Resource options"), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain all actions/i }));

    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    expect(screen.getByText("can_use")).toBeInTheDocument();
    expect(screen.getByText("can_read")).toBeInTheDocument();
    expect(screen.getByText("ALLOW")).toBeInTheDocument();
    expect(screen.getByText("admin bypass")).toBeInTheDocument(); // via column for the org-admin ALLOW

    const explainCall = (global.fetch as jest.Mock).mock.calls.find((c) => String(c[0]).includes("/explain"));
    const sent = JSON.parse(explainCall[1].body);
    expect(sent.subject).toEqual({ type: "user", id: "bob-sub" });
    expect(sent.resource).toEqual({ type: "agent", id: "pe" });
    expect(Array.isArray(sent.actions)).toBe(true);
  });

  it("shows a text-only field when no resources exist for the type", async () => {
    (global.fetch as jest.Mock) = routedFetch({ resources: [] });
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" });
    await waitFor(() => expect(screen.queryByLabelText("Resource options")).not.toBeInTheDocument());
    expect((screen.getByLabelText("Resource") as HTMLElement).tagName).toBe("INPUT");
  });

  it("refresh re-pulls the resource choices", async () => {
    (global.fetch as jest.Mock) = routedFetch();
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "agent-sre-agent" });
    const before = (global.fetch as jest.Mock).mock.calls.filter((c) => String(c[0]).includes("/resources")).length;
    fireEvent.click(screen.getByRole("button", { name: /Refresh resource choices/i }));
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.filter((c) => String(c[0]).includes("/resources")).length).toBeGreaterThan(before),
    );
  });

  it("surfaces an error from a failed explain call", async () => {
    (global.fetch as jest.Mock) = routedFetch({ explain: { error: "nope" }, explainOk: false });
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" });
    fireEvent.change(screen.getByLabelText("Subject options"), { target: { value: "bob-sub" } });
    fireEvent.change(screen.getByLabelText("Resource options"), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain all actions/i }));
    await waitFor(() => expect(screen.getByText("nope")).toBeInTheDocument());
  });

  it("does not offer revoke when an ALLOW is inherited rather than a direct grant", async () => {
    (global.fetch as jest.Mock) = routedFetch({
      explain: {
        results: [
          {
            action: "use",
            decision: "ALLOW",
            reason: "OK",
            retriable: false,
            via: "tuple",
            directGrant: {
              tuple: "user:bob-sub user agent:pe",
              present: false,
              revocable: false,
            },
            debug: {
              engine: "openfga",
              relation: "can_use",
              checked: ["user:bob-sub can_use agent:pe"],
              store: "s",
            },
          },
        ],
      },
    });
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" });
    fireEvent.change(screen.getByLabelText("Subject options"), { target: { value: "bob-sub" } });
    fireEvent.change(screen.getByLabelText("Resource options"), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain all actions/i }));

    await waitFor(() => expect(screen.getByText("Permission matrix")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
    expect(screen.getByText("Inherited")).toBeInTheDocument();
  });

  it("greys out unsupported capabilities and does not offer grant actions", async () => {
    (global.fetch as jest.Mock) = routedFetch({
      explain: {
        results: [
          {
            action: "ingest",
            supported: false,
            decision: "DENY",
            reason: "INVALID_REQUEST",
            unsupportedReason: "capability is not supported for this resource type",
            retriable: false,
            via: null,
            debug: {
              engine: "openfga",
              relation: "can_ingest",
              checked: ["user:bob-sub can_ingest agent:pe"],
              store: "s",
            },
          },
        ],
      },
    });
    render(<PermissionsToolTab isAdmin={true} />);
    await screen.findByRole("option", { name: "bob@example.com" });
    fireEvent.change(screen.getByLabelText("Subject options"), { target: { value: "bob-sub" } });
    fireEvent.change(screen.getByLabelText("Resource options"), { target: { value: "pe" } });
    fireEvent.click(screen.getByRole("button", { name: /Explain all actions/i }));

    const row = await screen.findByTestId("permission-row-ingest");
    expect(row).toHaveClass("opacity-50");
    expect(screen.getAllByText("Not supported")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Grant" })).not.toBeInTheDocument();
  });
});
