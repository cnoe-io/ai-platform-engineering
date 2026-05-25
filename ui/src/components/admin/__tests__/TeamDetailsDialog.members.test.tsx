import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TeamDetailsDialog } from "../TeamDetailsDialog";
import type { Team } from "@/types/teams";

const fetchMock = jest.fn();

const baseTeam: Team = {
  _id: "team-1",
  slug: "platform",
  name: "Platform Engineering",
  owner_id: "owner@example.com",
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
  members: [
    {
      user_id: "owner@example.com",
      role: "owner",
      added_at: new Date("2026-01-01"),
    },
    {
      user_id: "alice@example.com",
      role: "member",
      added_at: new Date("2026-01-02"),
    },
  ],
};

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("calls onTeamMutated (not onTeamUpdated) when a member is added", async () => {
  const onTeamMutated = jest.fn();
  const onTeamUpdated = jest.fn();

  // Server returns the patched team document.
  const updatedTeam: Team = {
    ...baseTeam,
    members: [
      ...baseTeam.members,
      {
        user_id: "bob@example.com",
        role: "member",
        added_at: new Date("2026-01-03"),
      },
    ],
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/teams/team-1/members" && init?.method === "POST") {
      return jsonResponse({ success: true, data: { team: updatedTeam } });
    }
    // Secondary background hydrate calls (refreshTeam) — return harmless empties.
    return jsonResponse({ success: true, data: { team: updatedTeam } });
  });

  render(
    <TeamDetailsDialog
      team={baseTeam}
      mode="members"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={onTeamUpdated}
      onTeamMutated={onTeamMutated}
    />,
  );

  const input = screen.getByPlaceholderText(/Search by name or email/i);
  fireEvent.change(input, { target: { value: "bob@example.com" } });

  const form = input.closest("form");
  if (!form) throw new Error("Add-member form not found");
  fireEvent.submit(form);

  await waitFor(() => {
    expect(onTeamMutated).toHaveBeenCalledTimes(1);
  });

  // The heavy parent-page reload callback must NOT fire when the
  // lightweight onTeamMutated path is wired in. This is the regression
  // guard for the "Add member refreshes the entire admin page" bug.
  expect(onTeamUpdated).not.toHaveBeenCalled();
  expect(onTeamMutated).toHaveBeenCalledWith(
    expect.objectContaining({ _id: "team-1" }),
  );

  // The modal stays mounted — the new member is now visible in the list
  // without any full-page reload having to happen.
  await waitFor(() => {
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });
});

it("shows an inline confirm row instead of window.confirm when removing a member", async () => {
  const onTeamMutated = jest.fn();
  const onTeamUpdated = jest.fn();

  const updatedTeam: Team = {
    ...baseTeam,
    members: baseTeam.members.filter((m) => m.user_id !== "alice@example.com"),
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (
      url.startsWith("/api/admin/teams/team-1/members") &&
      init?.method === "DELETE"
    ) {
      return jsonResponse({ success: true, data: { team: updatedTeam } });
    }
    return jsonResponse({ success: true, data: { team: updatedTeam } });
  });

  // Regression guard: the old flow called window.confirm() which is a
  // blocking modal at the browser level. We now use an inline confirm
  // row, so window.confirm must NEVER be invoked.
  const confirmSpy = jest.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error(
      "window.confirm must not be called — use the inline confirm row",
    );
  });

  render(
    <TeamDetailsDialog
      team={baseTeam}
      mode="members"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={onTeamUpdated}
      onTeamMutated={onTeamMutated}
    />,
  );

  // First click: stages the inline confirm row, does NOT fire the API.
  const removeButton = screen.getByRole("button", {
    name: /^Remove alice@example.com$/i,
  });
  fireEvent.click(removeButton);

  // The DELETE call must not have happened yet — only the trash icon
  // was clicked, the user still has to confirm.
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        url.startsWith("/api/admin/teams/team-1/members") &&
        (init as RequestInit | undefined)?.method === "DELETE",
    ),
  ).toHaveLength(0);

  // The inline confirm row should now be in the document.
  const confirmButton = await screen.findByRole("button", {
    name: /Confirm remove alice@example.com/i,
  });
  expect(confirmButton).toBeInTheDocument();
  expect(screen.getByText("Remove?")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Cancel removal/i }),
  ).toBeInTheDocument();

  // Second click: confirm.
  fireEvent.click(confirmButton);

  await waitFor(() => {
    expect(onTeamMutated).toHaveBeenCalledTimes(1);
  });
  expect(onTeamUpdated).not.toHaveBeenCalled();

  await waitFor(() => {
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();
  });

  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it("cancels the inline confirm row without calling the API", async () => {
  const onTeamMutated = jest.fn();
  const onTeamUpdated = jest.fn();

  fetchMock.mockImplementation(async () =>
    jsonResponse({ success: true, data: {} }),
  );

  render(
    <TeamDetailsDialog
      team={baseTeam}
      mode="members"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={onTeamUpdated}
      onTeamMutated={onTeamMutated}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: /^Remove alice@example.com$/i }),
  );

  // Confirm row visible.
  expect(
    await screen.findByRole("button", {
      name: /Confirm remove alice@example.com/i,
    }),
  ).toBeInTheDocument();

  // Cancel.
  fireEvent.click(screen.getByRole("button", { name: /Cancel removal/i }));

  // Confirm row gone, original trash button returns, member still present.
  await waitFor(() => {
    expect(
      screen.queryByRole("button", {
        name: /Confirm remove alice@example.com/i,
      }),
    ).not.toBeInTheDocument();
  });
  expect(screen.getByText("alice@example.com")).toBeInTheDocument();

  // No DELETE call should have been issued.
  expect(
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === "string" &&
        url.startsWith("/api/admin/teams/team-1/members") &&
        (init as RequestInit | undefined)?.method === "DELETE",
    ),
  ).toHaveLength(0);

  expect(onTeamMutated).not.toHaveBeenCalled();
  expect(onTeamUpdated).not.toHaveBeenCalled();
});

it("falls back to onTeamUpdated when onTeamMutated is not provided (legacy behaviour)", async () => {
  const onTeamUpdated = jest.fn();

  const updatedTeam: Team = {
    ...baseTeam,
    members: [
      ...baseTeam.members,
      {
        user_id: "charlie@example.com",
        role: "member",
        added_at: new Date("2026-01-04"),
      },
    ],
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/teams/team-1/members" && init?.method === "POST") {
      return jsonResponse({ success: true, data: { team: updatedTeam } });
    }
    return jsonResponse({ success: true, data: { team: updatedTeam } });
  });

  render(
    <TeamDetailsDialog
      team={baseTeam}
      mode="members"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={onTeamUpdated}
    />,
  );

  const input = screen.getByPlaceholderText(/Search by name or email/i);
  fireEvent.change(input, { target: { value: "charlie@example.com" } });
  const form = input.closest("form");
  if (!form) throw new Error("Add-member form not found");
  fireEvent.submit(form);

  await waitFor(() => {
    expect(onTeamUpdated).toHaveBeenCalledTimes(1);
  });
});
