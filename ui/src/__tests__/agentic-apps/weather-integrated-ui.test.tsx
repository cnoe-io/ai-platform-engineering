/**
 * @jest-environment jsdom
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { render, screen } from "@testing-library/react";

import { WeatherIntegratedApp } from "@/components/agentic-apps/WeatherIntegratedApp";

describe("WeatherIntegratedApp", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
          surfaces: [
            {
              type: "weather.current",
              props: {
                city: "San Jose, CA",
                temperature: "72°F",
                condition: "Clear",
                wind: "7 mph NW",
                airQuality: "Good",
              },
            },
          ],
      }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders Weather inside a CAIPE-owned integrated app surface", () => {
    render(<WeatherIntegratedApp />);

    expect(screen.getByRole("heading", { name: "Weather Starter" })).toBeInTheDocument();
    expect(screen.getByText(/CAIPE shell remains in control/i)).toBeInTheDocument();
    expect(screen.getByText(/Integrated app surface/i)).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toHaveValue("San Jose, CA");
    expect(screen.getByRole("button", { name: /ask weather advisor/i })).toBeInTheDocument();
    expect(screen.getByText("Current conditions")).toBeInTheDocument();
    expect(screen.getByText("App assistant")).toBeInTheDocument();
    expect(screen.getByText("Weather radar")).toBeInTheDocument();
  });
});
