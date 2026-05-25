import { render, screen, waitFor } from "@testing-library/react";

import { CredentialAuditPanel } from "../CredentialAuditPanel";

describe("CredentialAuditPanel", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ action: "secret.create", result: "success", resource: { id: "secret-1" } }],
      }),
    })) as jest.Mock;
  });

  it("renders redacted credential audit events", async () => {
    render(<CredentialAuditPanel endpoint="/api/admin/credentials/audit" />);

    await waitFor(() => expect(screen.getByText("secret.create")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith("/api/admin/credentials/audit");
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });
});
