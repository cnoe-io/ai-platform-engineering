/**
 * @jest-environment jsdom
 *
 * ServiceAccountSelect — unit tests (TEST-10 / TEST-9)
 *
 * Covers:
 *   - teamSlug absent → "No team assigned" empty state (no fetch fired)
 *   - teamSlug present + empty server response → "No active service accounts" empty state
 *   - fetch rejects → distinct error state + retry button re-triggers fetch
 *   - happy path → options render + onChange fires with (sa_sub, name)
 *   - search filters the option list by name
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceAccountSelect } from "../ServiceAccountSelect";

// Utility: build a minimal Response-shaped object
function mockResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// Server payload for two active service accounts
function twoActiveAccounts() {
  return {
    success: true,
    data: {
      items: [
        { id: "sub-alpha-001", name: "incident-bot", status: "active" },
        { id: "sub-beta-002", name: "deploy-bot", status: "active" },
      ],
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Empty / no-team states
// ---------------------------------------------------------------------------

it("shows 'No team assigned' empty state when teamSlug is absent — no fetch fired", () => {
  global.fetch = jest.fn();

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug={undefined} />,
  );

  expect(screen.getByText(/no team assigned/i)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("shows 'No active service accounts' when teamSlug is set but server returns empty list", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    mockResponse({ success: true, data: { items: [] } }),
  );

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="platform-engineering" />,
  );

  expect(await screen.findByText(/no active service accounts/i)).toBeInTheDocument();
  // Confirm it scoped the fetch to the right team
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("team=platform-engineering"),
  );
});

// ---------------------------------------------------------------------------
// displayName fallback (caller lacks team membership but a value is saved)
// ---------------------------------------------------------------------------

it("shows the displayName fallback (not the empty-state message) when SA list is empty but value+displayName are set", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    mockResponse({ success: true, data: { items: [] } }),
  );

  render(
    <ServiceAccountSelect
      value="sub-saved-999"
      onChange={jest.fn()}
      teamSlug="platform-engineering"
      displayName="legacy-incident-bot"
    />,
  );

  const trigger = await screen.findByRole("button", { name: "Service account" });
  expect(trigger).toHaveTextContent("legacy-incident-bot");
  expect(screen.queryByText(/no active service accounts/i)).not.toBeInTheDocument();
});

it("still shows the empty-state message when list is empty and neither value nor displayName is set", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    mockResponse({ success: true, data: { items: [] } }),
  );

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="platform-engineering" />,
  );

  expect(await screen.findByText(/no active service accounts/i)).toBeInTheDocument();
});

it("prefers the fetched SA's own name over displayName once the list loads and contains it", async () => {
  global.fetch = jest.fn().mockResolvedValue(mockResponse(twoActiveAccounts()));

  render(
    <ServiceAccountSelect
      value="sub-beta-002"
      onChange={jest.fn()}
      teamSlug="platform-engineering"
      displayName="stale-cached-name"
    />,
  );

  const trigger = await screen.findByRole("button", { name: "Service account" });
  expect(trigger).toHaveTextContent("deploy-bot");
  expect(trigger).not.toHaveTextContent("stale-cached-name");
});

// ---------------------------------------------------------------------------
// TEST-9: fetch failure → distinct error state + retry
// ---------------------------------------------------------------------------

it("shows an error message and Retry button when the fetch rejects", async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error("network error"));

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="my-team" />,
  );

  expect(await screen.findByText(/failed to load service accounts/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  // Must NOT show the empty-SAs message (different state)
  expect(screen.queryByText(/no active service accounts/i)).not.toBeInTheDocument();
});

it("retries the fetch when the Retry button is clicked", async () => {
  // First call fails, second call succeeds
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValueOnce(mockResponse(twoActiveAccounts()));

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="my-team" />,
  );

  // Error state appears
  await screen.findByText(/failed to load service accounts/i);
  const retryBtn = screen.getByRole("button", { name: /retry/i });

  fireEvent.click(retryBtn);

  // After retry the popover trigger should appear (list is non-empty)
  expect(await screen.findByRole("button", { name: /service account/i })).toBeInTheDocument();
  // Error message should be gone
  expect(screen.queryByText(/failed to load service accounts/i)).not.toBeInTheDocument();
  // fetch was called twice
  expect(fetch).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// Happy path: options render, onChange fires with sub + name
// ---------------------------------------------------------------------------

it("renders picker trigger and option list on success, fires onChange with sub and name", async () => {
  global.fetch = jest.fn().mockResolvedValue(mockResponse(twoActiveAccounts()));

  const onChange = jest.fn();

  render(
    <ServiceAccountSelect
      value=""
      onChange={onChange}
      teamSlug="platform-engineering"
    />,
  );

  // Trigger appears after load
  const trigger = await screen.findByRole("button", { name: "Service account" });
  fireEvent.click(trigger);

  // Both options are in the listbox
  const listbox = await screen.findByRole("listbox");
  expect(within(listbox).getByText("incident-bot")).toBeInTheDocument();
  expect(within(listbox).getByText("deploy-bot")).toBeInTheDocument();

  // Pick the first option
  fireEvent.click(within(listbox).getByText("incident-bot").closest("[role='option']")!);

  expect(onChange).toHaveBeenCalledWith("sub-alpha-001", "incident-bot");
});

it("pre-selects the option matching the current value prop", async () => {
  global.fetch = jest.fn().mockResolvedValue(mockResponse(twoActiveAccounts()));

  render(
    <ServiceAccountSelect
      value="sub-beta-002"
      onChange={jest.fn()}
      teamSlug="platform-engineering"
    />,
  );

  // Trigger shows the selected SA name (not placeholder)
  const trigger = await screen.findByRole("button", { name: "Service account" });
  expect(trigger).toHaveTextContent("deploy-bot");
});

// ---------------------------------------------------------------------------
// Search filtering
// ---------------------------------------------------------------------------

it("filters options by name when search query is typed", async () => {
  global.fetch = jest.fn().mockResolvedValue(mockResponse(twoActiveAccounts()));

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="platform-engineering" />,
  );

  const trigger = await screen.findByRole("button", { name: "Service account" });
  fireEvent.click(trigger);

  const searchInput = screen.getByRole("textbox", { name: /search service accounts/i });
  fireEvent.change(searchInput, { target: { value: "incident" } });

  const listbox = screen.getByRole("listbox");
  await waitFor(() => {
    expect(within(listbox).getByText("incident-bot")).toBeInTheDocument();
    expect(within(listbox).queryByText("deploy-bot")).not.toBeInTheDocument();
  });
});

it("shows 'No service accounts match' when query matches nothing", async () => {
  global.fetch = jest.fn().mockResolvedValue(mockResponse(twoActiveAccounts()));

  render(
    <ServiceAccountSelect value="" onChange={jest.fn()} teamSlug="platform-engineering" />,
  );

  const trigger = await screen.findByRole("button", { name: "Service account" });
  fireEvent.click(trigger);

  const searchInput = screen.getByRole("textbox", { name: /search service accounts/i });
  fireEvent.change(searchInput, { target: { value: "zzznotabot" } });

  const listbox = screen.getByRole("listbox");
  expect(within(listbox).getByText(/no service accounts match/i)).toBeInTheDocument();
});
