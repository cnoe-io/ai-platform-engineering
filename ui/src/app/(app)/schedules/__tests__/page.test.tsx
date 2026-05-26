/**
 * Unit tests for the Schedules page.
 *
 * The Status table column is intentionally role-independent. AuthGuard decides
 * whether a user can view the app at all; once the page renders, table columns
 * do not branch on admin/non-admin state.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
      createConversation: jest.fn(),
      setPendingMessage: jest.fn(),
    }),
}));

import SchedulesPage from "../page";

describe("SchedulesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
              agent_name: "Agent One",
              message_template: "Run the job",
              pod_id: null,
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
  });

  it("renders the Status column whenever the page renders", async () => {
    render(<SchedulesPage />);

    await waitFor(() => expect(screen.getByText("Agent One")).toBeInTheDocument());

    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });
});
