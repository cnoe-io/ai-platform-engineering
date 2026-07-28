import { act,render,screen,waitFor } from "@testing-library/react";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("lucide-react", () => ({
  CheckCircle2: () => <span />,
  Clock: () => <span />,
  ExternalLink: () => <span />,
  Loader2: () => <span />,
  PauseCircle: () => <span />,
  Workflow: () => <span />,
  XCircle: () => <span />,
}));

import { WorkflowRunCard } from "../WorkflowRunCard";

const RUNNING_RUN = {
  _id: "run-1",
  workflow_config_id: "workflow-1",
  status: "running",
  steps: [{ status: "running", display_text: "Check service" }],
};

const COMPLETED_RUN = {
  ...RUNNING_RUN,
  status: "completed",
  steps: [{ status: "completed", display_text: "Check service", response: "Service is healthy" }],
};

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("WorkflowRunCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("refreshes a running workflow until its terminal status is rendered", async () => {
    let runRequestCount = 0;
    (global.fetch as jest.Mock).mockImplementation((input: string) => {
      if (input.startsWith("/api/workflow-configs")) {
        return Promise.resolve(response({ name: "Health check" }));
      }

      runRequestCount += 1;
      return Promise.resolve(response(runRequestCount === 1 ? RUNNING_RUN : COMPLETED_RUN));
    });

    render(<WorkflowRunCard runs={[{ runId: "run-1" }]} />);

    await screen.findByText("Running");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/workflow-runs?run_id=run-1",
      { cache: "no-store" },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    await screen.findByText("Completed");
    expect(screen.getByText("1/1 steps")).toBeInTheDocument();
    expect(screen.getByText("Check service: Service is healthy")).toBeInTheDocument();

    const requestsAtCompletion = runRequestCount;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(runRequestCount).toBe(requestsAtCompletion);
  });

  it("keeps polling a pending workflow instead of treating it as terminal", async () => {
    let runRequestCount = 0;
    (global.fetch as jest.Mock).mockImplementation((input: string) => {
      if (input.startsWith("/api/workflow-configs")) {
        return Promise.resolve(response({ name: "Pending workflow" }));
      }

      runRequestCount += 1;
      return Promise.resolve(response({ ...RUNNING_RUN, status: "pending" }));
    });

    render(<WorkflowRunCard runs={[{ runId: "run-1" }]} />);

    await screen.findByText("Pending");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });

    await waitFor(() => expect(runRequestCount).toBe(2));
  });
});
