import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BaselineFgaProfilePanel } from "../BaselineFgaProfilePanel";

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        profile: {
          member_grants: ["organization-member", "admin-surface:users:read"],
          admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
          source: "mongo",
        },
        available_grants: {
          member: [
            {
              id: "organization-member",
              label: "Organization member",
              description: "Use organization resources.",
            },
            {
              id: "admin-surface:users:read",
              label: "Read users admin surface",
              description: "Read-only users tab.",
            },
            {
              id: "admin-surface:metrics:read",
              label: "Read metrics admin surface",
              description: "Read-only metrics tab.",
            },
          ],
          admin: [
            {
              id: "organization-admin",
              label: "Organization admin",
              description: "Administer organization resources.",
            },
            {
              id: "admin-surface:migrations:manage",
              label: "Manage migrations admin surface",
              description: "Manage migrations.",
            },
          ],
        },
      },
    }),
  });
});

it("saves edited baseline grant menus and applies them to all known users", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        profile: {
          member_grants: ["organization-member", "admin-surface:users:read", "admin-surface:metrics:read"],
          admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
          source: "mongo",
        },
        reconciliation: { mode: "all", user_count: 2, writes: 6, deletes: 0 },
        available_grants: { member: [], admin: [] },
      },
    }),
  });

  render(<BaselineFgaProfilePanel isAdmin />);

  expect(await screen.findByText("Baseline FGA")).toBeInTheDocument();
  const memberMenu = await screen.findByLabelText("Non-admin baseline grant menu");
  fireEvent.change(memberMenu, {
    target: { value: "admin-surface:metrics:read" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add non-admin grant" }));
  fireEvent.click(screen.getByRole("button", { name: "Save baseline profile" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/admin/openfga/baseline-profile",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        member_grants: ["organization-member", "admin-surface:users:read", "admin-surface:metrics:read"],
        admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
        apply: { mode: "all" },
      }),
    }),
  );
  expect(await screen.findByText("Applied to 2 user(s): 6 writes, 0 deletes.")).toBeInTheDocument();
});

it("renders read-only controls for non-admin viewers", async () => {
  render(<BaselineFgaProfilePanel isAdmin={false} />);

  expect(await screen.findByText("Baseline FGA")).toBeInTheDocument();
  await screen.findByLabelText("Non-admin baseline grant menu");
  expect(screen.getByRole("button", { name: "Save baseline profile" })).toBeDisabled();
  expect(screen.getByText("Only admins can update and reconcile baseline grants.")).toBeInTheDocument();
});
