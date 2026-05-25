import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ReviewConfigsTab } from "../ReviewConfigsTab";

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const fetchMock = jest.fn();

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function reviewConfig(target: string) {
  return {
    _id: target,
    target,
    label: target,
    enabled: true,
    enforcement: "informational",
    min_score: 0.85,
    grade_thresholds: { A: 0.9, B: 0.8, C: 0.7, D: 0.6 },
    model: { id: "global.anthropic.claude-sonnet-4-6", provider: "bedrock" },
    criteria: [
      {
        id: "clarity",
        name: "Clarity",
        severity: "warning",
        weight: 1,
        micro_prompt: "Is this clear?",
        expects_fix: false,
      },
    ],
    updated_at: "2026-05-19T00:00:00.000Z",
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href === "/api/dynamic-agents/models") {
      return jsonResponse({
        data: [
          {
            model_id: "global.anthropic.claude-sonnet-4-6",
            name: "Claude Sonnet",
            provider: "bedrock",
          },
        ],
      });
    }
    if (href.startsWith("/api/review-configs/")) {
      return jsonResponse({
        data: reviewConfig(decodeURIComponent(href.split("/").pop() ?? "agent-system-prompt")),
      });
    }
    return jsonResponse({ error: "not found" }, { status: 404, statusText: "Not Found" });
  });
});

it("keeps the AI Review save action in the page header row", async () => {
  render(<ReviewConfigsTab />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/review-configs/agent-system-prompt"));

  const header = screen.getByRole("region", { name: "AI Review configurations header" });
  expect(
    within(header).getByRole("heading", { name: "AI Review configurations" }),
  ).toBeInTheDocument();
  const save = within(header).getByRole("button", { name: "Save" });
  expect(save).toBeInTheDocument();
  await waitFor(() => expect(save).not.toBeDisabled());

  fireEvent.click(save);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/review-configs/agent-system-prompt",
      expect.objectContaining({ method: "PUT" }),
    ),
  );
});
