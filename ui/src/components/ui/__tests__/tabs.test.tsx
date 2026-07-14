import { fireEvent,render,screen } from "@testing-library/react";
import React from "react";

import { SlidingSelectorIndicator } from "@/components/ui/sliding-selector";
import { Tabs,TabsList,TabsTrigger } from "@/components/ui/tabs";

jest.mock("framer-motion", () => ({
  motion: {
    span: ({
      animate,
      children,
      initial,
      layoutId,
      transition,
      ...props
    }: React.ComponentProps<"span"> & {
      animate?: { height?: number; width?: number; x?: number; y?: number };
      initial?: unknown;
      layoutId?: string;
      transition?: { duration?: number; type?: string };
    }) => {
      void initial;
      return (
        <span
          data-layout-id={layoutId}
          data-position-x={animate?.x}
          data-position-y={animate?.y}
          data-transition-duration={transition?.duration}
          data-transition-type={transition?.type}
          {...props}
        >
          {children}
        </span>
      );
    },
  },
  useReducedMotion: () => false,
}));

function ControlledTabs({
  indicator,
}: {
  indicator?: "pill" | "underline" | "none";
}) {
  const [value, setValue] = React.useState("first");

  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList indicator={indicator}>
        <TabsTrigger value="first">First</TabsTrigger>
        <TabsTrigger value="second">Second</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function activeIndicator(): HTMLElement | null {
  return screen
    .getByRole("tablist")
    .querySelector('[data-slot="sliding-selector-indicator"]');
}

describe("Tabs sliding selector", () => {
  it("uses a shared pill selector by default and moves it to the active tab", () => {
    render(<ControlledTabs />);

    const firstIndicator = activeIndicator();
    expect(firstIndicator).toHaveAttribute("data-variant", "pill");
    expect(firstIndicator).toHaveAttribute("data-transition-type", "tween");
    expect(firstIndicator).toHaveAttribute("data-transition-duration", "0.24");
    expect(
      screen
        .getByRole("tab", { name: "First" })
        .querySelector('[data-slot="sliding-selector-indicator"]'),
    ).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Second" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(activeIndicator()).toBe(firstIndicator);
    expect(activeIndicator()).not.toHaveAttribute("data-layout-id");
  });

  it("supports an animated underline for specialized tab headers", () => {
    render(<ControlledTabs indicator="underline" />);

    expect(activeIndicator()).toHaveAttribute("data-variant", "underline");
  });

  it("keeps the spring motion exclusive to the intentional liquid variant", () => {
    const { container } = render(
      <div className="relative">
        <SlidingSelectorIndicator layoutId="liquid-test" variant="liquid" />
      </div>,
    );

    expect(
      container.querySelector('[data-slot="sliding-selector-indicator"]'),
    ).toHaveAttribute("data-transition-type", "spring");
  });

  it("allows non-navigation controls such as steppers to opt out", () => {
    render(<ControlledTabs indicator="none" />);

    expect(activeIndicator()).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Second" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(activeIndicator()).not.toBeInTheDocument();
  });

  it("resets the motion identity when a tab list changes navigation scope", () => {
    const { rerender } = render(
      <Tabs value="first">
        <TabsList indicatorScope="settings">
          <TabsTrigger value="first">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const settingsIndicator = activeIndicator();

    rerender(
      <Tabs value="first">
        <TabsList indicatorScope="people">
          <TabsTrigger value="first">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    expect(activeIndicator()).not.toBe(settingsIndicator);
  });

  it("tracks uncontrolled Radix tab state", () => {
    render(
      <Tabs defaultValue="first">
        <TabsList>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="second">Second</TabsTrigger>
        </TabsList>
      </Tabs>,
    );

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Second" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(activeIndicator()).toBeInTheDocument();
  });
});
