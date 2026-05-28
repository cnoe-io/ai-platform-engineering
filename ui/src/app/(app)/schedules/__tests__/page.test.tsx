/**
 * Unit tests for the Schedules page.
 *
 * The Status table column is intentionally role-independent. AuthGuard decides
 * whether a user can view the app at all; once the page renders, table columns
 * do not branch on admin/non-admin state.
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockCreateConversation = jest.fn();
const mockSetPendingMessage = jest.fn();
const mockRouterPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock("@/components/auth-guard", () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-guard">{children}</div>
  ),
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

jest.mock("lucide-react", () => ({
  AlertTriangle: (props: any) => <svg {...props} />,
  Bot: (props: any) => <svg {...props} />,
  CalendarClock: (props: any) => <svg {...props} />,
  CheckCircle2: (props: any) => <svg {...props} />,
  Clock3: (props: any) => <svg {...props} />,
  History: (props: any) => <svg {...props} />,
  Pause: (props: any) => <svg {...props} />,
  Pencil: (props: any) => <svg {...props} />,
  Play: (props: any) => <svg {...props} />,
  RefreshCw: (props: any) => <svg {...props} />,
  RotateCcw: (props: any) => <svg {...props} />,
  Save: (props: any) => <svg {...props} />,
  Trash2: (props: any) => <svg {...props} />,
}));

jest.mock("@/lib/config", () => ({
  getConfig: jest.fn(() => undefined),
}));

jest.mock("@/lib/utils", () => ({
  formatRelativeTime: () => "just now",
}));

jest.mock("@/store/chat-store", () => ({
  useChatStore: (selector: any) =>
    selector({
      createConversation: mockCreateConversation,
      setPendingMessage: mockSetPendingMessage,
    }),
}));

import SchedulesPage from "../page";

describe("SchedulesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateConversation.mockResolvedValue("conversation-1");
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          total: 1,
          items: [
            {
              schedule_id: "schedule-1",
              agent_id: "agent-1",
              edit_agent_id: "agent-sunny-webex-meeting-test",
              agent_name: "Agent One",
              title: "Important Team 2 Meeting Prep",
              message_template: "Run the job",
              pod_id: "important-team-2",
              attributes: {
                pod_id: "important-team-2",
                workflow: "prep",
              },
              cron: "*/5 * * * *",
              tz: "UTC",
              enabled: true,
              cronjob_name: "caipe-sched-schedule-1",
              version: 1,
              versions: [],
              created_at: "2026-05-25T00:00:00Z",
              updated_at: null,
              last_run: null,
            },
          ],
        },
      }),
    });
  });

  it("renders the Status column whenever the page renders", async () => {
    render(<SchedulesPage />);

    await waitFor(() =>
      expect(screen.getByText("Important Team 2 Meeting Prep")).toBeInTheDocument()
    );

    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("renders the job title, agent, schedule id, and display attributes", async () => {
    render(<SchedulesPage />);

    await waitFor(() =>
      expect(screen.getByText("Important Team 2 Meeting Prep")).toBeInTheDocument()
    );

    expect(screen.getByText("agent: Agent One")).toBeInTheDocument();
    expect(screen.getByText("schedule_id: schedule-1")).toBeInTheDocument();
    expect(screen.getByText("pod id:")).toBeInTheDocument();
    expect(screen.getByText("important-team-2")).toBeInTheDocument();
    expect(screen.getByText("workflow:")).toBeInTheDocument();
    expect(screen.getByText("prep")).toBeInTheDocument();
    expect(screen.getByText("Every 5 minutes")).toBeInTheDocument();
    expect(screen.getByText("Timezone: UTC")).toBeInTheDocument();
    expect(screen.queryByText("caipe-sched-schedule-1")).not.toBeInTheDocument();
  });

  it("lets users edit the schedule title", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          total: 1,
          items: [
            {
              schedule_id: "schedule-1",
              agent_id: "agent-1",
              edit_agent_id: null,
              agent_name: "Agent One",
              title: "Important Team 2 Meeting Prep",
              message_template: "Run the job",
              pod_id: "important-team-2",
              attributes: {},
              cron: "*/5 * * * *",
              tz: "UTC",
              enabled: true,
              cronjob_name: null,
              version: 1,
              versions: [],
              created_at: "2026-05-25T00:00:00Z",
              updated_at: null,
              last_run: null,
            },
          ],
        },
      }),
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          schedule_id: "schedule-1",
          agent_id: "agent-1",
          edit_agent_id: null,
          agent_name: "Agent One",
          title: "Renamed Meeting Prep",
          message_template: "Run the job",
          pod_id: "important-team-2",
          attributes: {},
          cron: "*/5 * * * *",
          tz: "UTC",
          enabled: true,
          cronjob_name: null,
          version: 2,
          versions: [],
          created_at: "2026-05-25T00:00:00Z",
          updated_at: "2026-05-28T00:00:00Z",
          last_run: null,
        },
      }),
    });

    render(<SchedulesPage />);

    await waitFor(() =>
      expect(screen.getByText("Important Team 2 Meeting Prep")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /modify schedule-1/i }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Renamed Meeting Prep" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith(
        "/api/schedules/schedule-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"title":"Renamed Meeting Prep"'),
        })
      )
    );
  });

  it("starts schedule edit chat with the schedule-specific edit agent", async () => {
    render(<SchedulesPage />);

    await waitFor(() =>
      expect(screen.getByText("Important Team 2 Meeting Prep")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: /modify schedule-1/i }));
    fireEvent.click(screen.getByRole("button", { name: "Chat with agent" }));

    await waitFor(() =>
      expect(mockCreateConversation).toHaveBeenCalledWith(
        "agent-sunny-webex-meeting-test"
      )
    );
    expect(mockSetPendingMessage).toHaveBeenCalledWith(
      expect.stringContaining("edit_agent_id: agent-sunny-webex-meeting-test")
    );
    expect(mockRouterPush).toHaveBeenCalledWith("/chat/conversation-1");
  });

  it("asks for confirmation before deleting a schedule", async () => {
    render(<SchedulesPage />);

    await waitFor(() =>
      expect(screen.getByText("Important Team 2 Meeting Prep")).toBeInTheDocument()
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { deleted: "schedule-1" },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /delete schedule-1/i }));

    expect(screen.getByText("Delete Scheduled Job?")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete scheduled job" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenLastCalledWith("/api/schedules/schedule-1", {
        method: "DELETE",
      })
    );
    expect(screen.getByText("No scheduled jobs yet.")).toBeInTheDocument();
  });
});
