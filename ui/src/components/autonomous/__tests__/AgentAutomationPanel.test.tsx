/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

import { AgentAutomationPanel } from "@/components/autonomous/AgentAutomationPanel";

const listResponse = {
  success: true,
  data: {
    schedulable: [],
    automatable: [
      { id: "docs-agent", name: "Docs Agent", owner_team_slug: "primary", autonomous_enabled: false },
    ],
    automatable_total: 1,
    can_schedule_any: false,
    can_automate_any: true,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => listResponse }) as never;
});

it("enables autonomous with a PUT carrying the owner team", async () => {
  render(<AgentAutomationPanel />);
  const toggle = await screen.findByRole("switch", { name: /docs agent/i });

  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/agents/docs-agent/automation",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ team_slug: "primary" }),
      }),
    ),
  );
});

it("disables autonomous with a DELETE", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      ...listResponse,
      data: {
        ...listResponse.data,
        automatable: [
          { id: "docs-agent", name: "Docs Agent", owner_team_slug: "primary", autonomous_enabled: true },
        ],
      },
    }),
  });

  render(<AgentAutomationPanel />);
  const toggle = await screen.findByRole("switch", { name: /docs agent/i });

  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/dynamic-agents/agents/docs-agent/automation",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
});

it("surfaces the eligibility error and reverts the switch on 409", async () => {
  render(<AgentAutomationPanel />);
  const toggle = await screen.findByRole("switch", { name: /docs agent/i });

  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ error: "not eligible", code: "TEAM_NOT_AUTOMATION_ELIGIBLE" }),
  });
  fireEvent.click(toggle);

  expect(await screen.findByText(/isn't autonomous-eligible/i)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("switch", { name: /docs agent/i })).not.toBeChecked());
});

it("shows an empty state when nothing is automatable", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { schedulable: [], automatable: [], automatable_total: 0, can_schedule_any: false, can_automate_any: false },
    }),
  });

  render(<AgentAutomationPanel />);
  expect(await screen.findByText(/no agents to manage/i)).toBeInTheDocument();
});

it("notifies the parent after a successful toggle so task sections refresh", async () => {
  const onChanged = jest.fn();
  render(<AgentAutomationPanel onChanged={onChanged} />);
  const toggle = await screen.findByRole("switch", { name: /docs agent/i });

  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  fireEvent.click(toggle);

  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it("does not notify the parent when the toggle fails", async () => {
  const onChanged = jest.fn();
  render(<AgentAutomationPanel onChanged={onChanged} />);
  const toggle = await screen.findByRole("switch", { name: /docs agent/i });

  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 409,
    json: async () => ({ error: "not eligible" }),
  });
  fireEvent.click(toggle);

  await screen.findByText(/isn't autonomous-eligible/i);
  expect(onChanged).not.toHaveBeenCalled();
});

