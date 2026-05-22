import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BaselineFgaProfilePanel } from "../BaselineFgaProfilePanel";

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/admin/openfga/baseline-profile" && init?.method === "PUT") {
      return response({
        success: true,
        data: {
          bundle: {
            global_member_profile_id: "org-member",
            global_admin_profile_id: "org-admin",
            source: "mongo",
            profiles: [
              {
                id: "org-member",
                name: "Organization member",
                role: "member",
                grants: ["organization-member", "admin-surface:users:read"],
                built_in: true,
              },
              {
                id: "org-admin",
                name: "Organization admin",
                role: "admin",
                grants: ["organization-admin", "admin-surface:migrations:manage"],
                built_in: true,
              },
              {
                id: "support-member",
                name: "Support member",
                role: "member",
                grants: ["organization-member", "admin-surface:metrics:read"],
                built_in: false,
              },
            ],
          },
          profile: {
            member_grants: ["organization-member", "admin-surface:users:read"],
            admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
            source: "mongo",
          },
          team_assignments: [
            {
              team_id: "team-1",
              team_slug: "support",
              team_name: "Support",
              member_profile_id: "support-member",
            },
          ],
          reconciliation: { mode: "all", user_count: 2, writes: 6, deletes: 0 },
          available_grants: { member: [], admin: [] },
        },
      });
    }
    if (url === "/api/admin/openfga/baseline-profile") {
      return response(baselineProfilePayload());
    }
    if (url === "/api/admin/openfga/catalog") {
      return response(catalogPayload());
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
      return response(tuplePayload());
    }
    return response({ success: false, error: `Unexpected URL ${url}` }, false, 404);
  });
});

it("saves edited profile grants and team override assignments", async () => {
  render(<BaselineFgaProfilePanel isAdmin />);

  expect(await screen.findByText("Default OpenFGA Grants Applied on Login")).toBeInTheDocument();
  expect(
    screen.getByText(/These profiles are templates that materialize concrete OpenFGA tuples/i),
  ).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText("Default grant profile"), {
    target: { value: "support-member" },
  });
  fireEvent.click(screen.getAllByRole("button", { name: "Add" })[1]);
  fireEvent.change(screen.getByLabelText("Member profile for Support"), {
    target: { value: "support-member" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save default grant profiles" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/openfga/baseline-profile",
      expect.objectContaining({ method: "PUT" }),
    ),
  );
  const requestInit = fetchMock.mock.calls.find(
    ([url, init]) => url === "/api/admin/openfga/baseline-profile" && init?.method === "PUT",
  )?.[1] as RequestInit;
  const body = JSON.parse(requestInit.body);
  expect(body.bundle.profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "support-member",
        grants: ["organization-member", "admin-surface:metrics:read"],
      }),
    ]),
  );
  expect(body.team_assignments).toEqual([
    expect.objectContaining({ team_id: "team-1", member_profile_id: "support-member" }),
  ]);
  expect(body.apply).toEqual({ mode: "all" });
  expect(await screen.findByText("Applied to 2 user(s): 6 writes, 0 deletes.")).toBeInTheDocument();
});

it("renders read-only controls for non-admin viewers", async () => {
  render(<BaselineFgaProfilePanel isAdmin={false} />);

  expect(await screen.findByText("Default OpenFGA Grants Applied on Login")).toBeInTheDocument();
  await screen.findByLabelText("Default grant profile");
  expect(screen.getByRole("button", { name: "Save default grant profiles" })).toBeDisabled();
  expect(screen.getByText("Only admins can update and reconcile default grant profiles.")).toBeInTheDocument();
});

it("renders the complete FGA catalog and all relationship summary in the baseline workspace", async () => {
  render(<BaselineFgaProfilePanel isAdmin />);

  expect(await screen.findByText("OpenFGA Store: Catalog & Live Relationships")).toBeInTheDocument();
  expect(
    screen.getByText(/This is the live authorization store, including relationships created by login defaults/i),
  ).toBeInTheDocument();
  expect(await screen.findByLabelText("2 resource types")).toBeInTheDocument();
  expect(screen.getByLabelText("4 actions")).toBeInTheDocument();
  expect(screen.getByLabelText("3 catalog resources")).toBeInTheDocument();
  expect(screen.getByLabelText("2 live tuples")).toBeInTheDocument();
  expect(screen.getAllByText("agent").length).toBeGreaterThan(0);
  expect(screen.getAllByText("can_use").length).toBeGreaterThan(0);
  expect(screen.getByText("user:alice@example.com")).toBeInTheDocument();
  expect(screen.getAllByText("agent:platform-engineer").length).toBeGreaterThan(0);
});

it("lets OpenFGA catalog lists flow with the page instead of clipping inside nested scroll boxes", async () => {
  render(<BaselineFgaProfilePanel isAdmin />);

  expect(await screen.findByText("OpenFGA Store: Catalog & Live Relationships")).toBeInTheDocument();
  for (const testId of [
    "fga-resource-type-list",
    "fga-relationship-family-list",
    "fga-discovered-resource-list",
    "fga-live-relationship-list",
  ]) {
    expect((await screen.findByTestId(testId)).className).not.toMatch(/max-h-|overflow-auto|overflow-y-auto/);
  }
});

function baselineProfilePayload() {
  return {
    success: true,
    data: {
      bundle: {
        global_member_profile_id: "org-member",
        global_admin_profile_id: "org-admin",
        source: "mongo",
        profiles: [
          {
            id: "org-member",
            name: "Organization member",
            role: "member",
            grants: ["organization-member", "admin-surface:users:read"],
            built_in: true,
          },
          {
            id: "org-admin",
            name: "Organization admin",
            role: "admin",
            grants: ["organization-admin", "admin-surface:migrations:manage"],
            built_in: true,
          },
          {
            id: "support-member",
            name: "Support member",
            role: "member",
            grants: ["organization-member"],
            built_in: false,
          },
        ],
      },
      profile: {
        member_grants: ["organization-member", "admin-surface:users:read"],
        admin_grants: ["organization-admin", "admin-surface:migrations:manage"],
        source: "mongo",
      },
      team_assignments: [
        {
          team_id: "team-1",
          team_slug: "support",
          team_name: "Support",
        },
      ],
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
  };
}

function catalogPayload() {
  return {
    success: true,
    data: {
      resource_types: [
        { type: "agent", actions: ["discover", "read", "use"] },
        { type: "tool", actions: ["call"] },
      ],
      actions: {
        agent: ["discover", "read", "use"],
        tool: ["call"],
      },
      universal_resources: [
        { type: "agent", id: "platform-engineer", display_name: "Platform Engineer" },
        { type: "tool", id: "jira_*", display_name: "Jira Tools" },
        { type: "admin_surface", id: "users", display_name: "Users Admin Surface" },
      ],
    },
  };
}

function tuplePayload() {
  return {
    success: true,
    data: {
      tuples: [
        {
          key: {
            user: "user:alice@example.com",
            relation: "can_use",
            object: "agent:platform-engineer",
          },
        },
        {
          key: {
            user: "team:platform#member",
            relation: "caller",
            object: "tool:jira_*",
          },
        },
      ],
    },
  };
}

function response(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}
