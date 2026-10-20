import { fireEvent, render, screen } from "@testing-library/react";
import { AgenticAppIcon } from "../AgenticAppIcon";
import { AppIcon } from "../AppIcon";

it("renders the App spark mark at the caller's size with unique masks", () => {
  const { container } = render(<>
    <AgenticAppIcon className="h-4 w-4" aria-label="Primary app" />
    <AgenticAppIcon className="h-5 w-5" aria-label="Secondary app" />
  </>);
  expect(screen.getByLabelText("Primary app")).toHaveClass("lucide-app-spark", "h-4", "w-4");
  expect(screen.getByLabelText("Secondary app")).toHaveClass("h-5", "w-5");
  const masks = Array.from(container.querySelectorAll("mask"));
  expect(masks).toHaveLength(2);
  expect(masks[0].id).not.toBe(masks[1].id);
  expect(container.querySelectorAll(".lucide-app-window")).toHaveLength(2);
  expect(container.querySelectorAll(".lucide-sparkles")).toHaveLength(2);
});

it.each([undefined, "https://example.test/logo.svg"])("uses App spark for missing or unsafe branding: %s", icon => {
  const { container } = render(<AppIcon appId="example-app" icon={icon} className="h-5 w-5" />);
  expect(container.querySelector(".lucide-app-spark")).toHaveClass("h-5", "w-5");
  expect(container.querySelector("img")).toBeNull();
});

it("retains catalog branding and falls back to App spark if the image fails", () => {
  const { container } = render(<AppIcon appId="example-app" icon="/app-icons/example-app/logo.png" />);
  const image = container.querySelector("img")!;
  expect(new URL(image.getAttribute("src")!, window.location.origin).pathname).toBe("/app-icons/example-app/logo.png");
  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".lucide-app-spark")).toBeInTheDocument();
});
