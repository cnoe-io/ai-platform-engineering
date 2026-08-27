import { describe, expect, it } from "@jest/globals";

import { filterAgenticApps } from "@/lib/agentic-apps/hub-search";

const apps = [
  {
    id: "example-cost-dashboard",
    displayName: "Cost Dashboard",
    description: "Track infrastructure efficiency and spend.",
    access: { tokenScopes: ["cost:read", "agents:invoke"] },
    catalog: {
      categories: ["operations"],
      capabilities: ["budget forecasting"],
    },
    agents: [
      {
        id: "example-cost-agent",
        displayName: "Cost Assistant",
        required: true,
        capabilities: ["optimization"],
      },
    ],
  },
  {
    id: "example-weather-dashboard",
    displayName: "Weather Dashboard",
    description: "View current conditions and forecasts.",
    access: { tokenScopes: ["weather:read"] },
    catalog: {
      categories: ["starter"],
      capabilities: ["forecasting"],
    },
  },
];

describe("filterAgenticApps", () => {
  it.each([
    ["cost", "example-cost-dashboard"],
    ["infrastructure spend", "example-cost-dashboard"],
    ["budget forecasting", "example-cost-dashboard"],
    ["cost:read", "example-cost-dashboard"],
    ["optimization", "example-cost-dashboard"],
    ["weather_dashboard", "example-weather-dashboard"],
  ])("matches '%s' against app metadata", (query, expectedId) => {
    expect(filterAgenticApps(apps, query).map((app) => app.id)).toEqual([
      expectedId,
    ]);
  });

  it("returns every app for an empty query", () => {
    expect(filterAgenticApps(apps, "   ")).toBe(apps);
  });

  it("returns no apps when every query term cannot be matched", () => {
    expect(filterAgenticApps(apps, "weather optimization")).toEqual([]);
  });
});
