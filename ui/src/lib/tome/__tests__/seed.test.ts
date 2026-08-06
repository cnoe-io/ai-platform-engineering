jest.mock("../page-store", () => ({ getPageStore: jest.fn() }));
jest.mock("../page-templates-store", () => ({ getPageTemplate: jest.fn() }));

import { missingPageTemplates } from "../seed";

it("preserves existing stable pages when the first report is greenfield", () => {
  const existing = {
    "charter.md": "human-authored charter",
    "roadmap.md": "human-authored roadmap",
  };

  expect(
    missingPageTemplates(
      {
        "charter.md": "default charter template",
        "roadmap.md": "default roadmap template",
        "team-assignments.md": "default team template",
      },
      existing,
    ),
  ).toEqual({ "team-assignments.md": "default team template" });
  expect(existing["charter.md"]).toBe("human-authored charter");
});
