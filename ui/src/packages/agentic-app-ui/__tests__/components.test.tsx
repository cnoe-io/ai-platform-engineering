/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AppBadge,
  AppButton,
  AppTabs,
  AssistantTrigger,
  EmptyState,
  MetricCard,
  PageHeader,
  Toolbar,
} from "../index";

describe("agentic app React UI kit", () => {
  it("renders layout and primitive components", () => {
    render(
      <div>
        <PageHeader
          eyebrow="External app"
          title="Weather"
          description="Forecasts"
          actions={<AppButton>Refresh</AppButton>}
        />
        <Toolbar>
          <AppBadge tone="emerald">Healthy</AppBadge>
          <AssistantTrigger hasContext />
        </Toolbar>
        <MetricCard label="Forecast" value="72F" description="Sunny" />
        <EmptyState title="No alerts" description="Everything is quiet." />
      </div>,
    );

    expect(screen.getByRole("heading", { name: "Weather" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask CAIPE with context" })).toBeInTheDocument();
    expect(screen.getByText("72F")).toBeInTheDocument();
    expect(screen.getByText("No alerts")).toBeInTheDocument();
  });

  it("renders selectable tabs", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <AppTabs
        activeId="summary"
        onSelect={onSelect}
        tabs={[
          { id: "summary", label: "Summary" },
          { id: "details", label: "Details" },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(onSelect).toHaveBeenCalledWith("details");
  });
});
