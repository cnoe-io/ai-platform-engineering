import { fireEvent,render,screen } from "@testing-library/react";
import { Home,Settings } from "lucide-react";
import React from "react";

jest.mock("@/components/layout/GuardedNavigationLink", () => ({
  GuardedNavigationLink: React.forwardRef(function MockNavigationLink(
    { children,href,...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
    ref: React.ForwardedRef<HTMLAnchorElement>,
  ) {
    return <a href={href} ref={ref} {...props}>{children}</a>;
  }),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children,open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children,...props }: React.HTMLAttributes<HTMLDivElement>) =>
    <div {...props}>{children}</div>,
  DialogDescription: ({ children,...props }: React.HTMLAttributes<HTMLParagraphElement>) =>
    <p {...props}>{children}</p>,
  DialogHeader: ({ children,...props }: React.HTMLAttributes<HTMLDivElement>) =>
    <div {...props}>{children}</div>,
  DialogTitle: ({ children,...props }: React.HTMLAttributes<HTMLHeadingElement>) =>
    <h2 {...props}>{children}</h2>,
}));

jest.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import {
  ApplicationNavigationSearch,
  filterApplicationNavigationEntries,
  searchApplicationResources,
  type ApplicationNavigationSearchEntry,
} from "../ApplicationNavigationSearch";

const entries: ApplicationNavigationSearchEntry[] = [
  {
    id: "home",
    label: "Home",
    group: "Pages",
    href: "/",
    icon: Home,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Choose the updates you want to see",
    group: "Settings",
    href: "/settings/notifications",
    icon: Settings,
  },
];

function response(body: unknown,ok = true): Promise<Response> {
  return Promise.resolve({
    ok,
    json: async () => body,
  } as Response);
}

describe("ApplicationNavigationSearch", () => {
  it("matches navigation labels, groups, and descriptions", () => {
    expect(filterApplicationNavigationEntries(entries,"updates settings"))
      .toEqual([entries[1]]);
    expect(filterApplicationNavigationEntries(entries,"missing")).toEqual([]);
  });

  it("opens with Ctrl+K and supports arrow and Enter navigation", () => {
    const onNavigate = jest.fn();
    render(
      <ApplicationNavigationSearch
        collapsed={false}
        enableShortcut
        entries={entries}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole("button", { name: "Open command palette" }))
      .toBeInTheDocument();

    fireEvent.keyDown(window,{ key: "k",ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Search pages and resources" });
    expect(input).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close command palette" }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(input,{ key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Notifications/ }))
      .toHaveAttribute("aria-selected","true");
    fireEvent.keyDown(input,{ key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("maps only results returned by the user-scoped resource APIs", async () => {
    const fetchImplementation = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/user/accessible-agents")) {
        return response({
          success: true,
          data: {
            agents: [
              { id: "agent-visible",name: "Release Agent",description: "Ships releases" },
              { id: "agent-unmatched",name: "Triage",description: "Handles incidents" },
            ],
          },
        });
      }
      if (url.startsWith("/api/chat/search")) {
        return response({
          success: true,
          data: { items: [{ _id: "conversation-visible",title: "Release checklist" }] },
        });
      }
      if (url.startsWith("/api/skills")) {
        return response({
          skills: [{ id: "skill-visible",name: "Release notes",description: "Draft a release" }],
          meta: { total: 1 },
        });
      }
      return response({},false);
    });

    const results = await searchApplicationResources(
      "release",
      undefined,
      fetchImplementation,
    );

    expect(results.map((result) => result.id)).toEqual([
      "resource-agent-agent-visible",
      "resource-conversation-conversation-visible",
      "resource-skill-skill-visible",
    ]);
    expect(results.map((result) => result.href)).toEqual([
      "/dynamic-agents?tab=agents&agent=agent-visible",
      "/chat/conversation-visible",
      "/skills/workspace/skill-visible",
    ]);
  });

  it("keeps partial results when one resource API is unavailable", async () => {
    const fetchImplementation = jest.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/skills")) {
        return Promise.reject(new Error("skills unavailable"));
      }
      if (String(input).startsWith("/api/chat/search")) {
        return response({ success: true,data: { items: [] } });
      }
      return response({
        success: true,
        data: { agents: [{ id: "agent-1",name: "Primary Agent" }] },
      });
    });

    await expect(searchApplicationResources("primary",undefined,fetchImplementation))
      .resolves.toEqual([
        expect.objectContaining({ id: "resource-agent-agent-1" }),
      ]);
  });
});
