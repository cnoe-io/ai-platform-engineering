/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OversightGrid } from "@/components/autonomous/oversight/OversightGrid";
import type { OversightResult } from "@/lib/autonomous/oversight-grouping";

const data: OversightResult = {
  teams: [
    { slug: "eng", name: "Eng", counts: { total: 3, paused: 1, ack_failed: 0 }, members: [] },
    { slug: "plat", name: "Platform", counts: { total: 2, paused: 0, ack_failed: 0 }, members: [] },
    { slug: "design", name: "Design", counts: { total: 0, paused: 0, ack_failed: 0 }, members: [] },
  ],
  no_team: { counts: { total: 2, paused: 0, ack_failed: 1 }, members: [] },
  totals: { total: 7, paused: 1, ack_failed: 1 },
};

it("renders the org summary strip and the Needs attention section", () => {
  render(<OversightGrid data={data} onOpenTeam={() => {}} />);
  expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  // Summary strip surfaces org-wide totals.
  expect(screen.getByText("7")).toBeInTheDocument(); // distinct tasks
});

it("puts problem teams (paused/failed) in Needs attention and reports clicks", async () => {
  const onOpenTeam = jest.fn();
  const user = userEvent.setup();
  render(<OversightGrid data={data} onOpenTeam={onOpenTeam} />);
  await user.click(screen.getByText("Eng")); // paused → attention card
  expect(onOpenTeam).toHaveBeenCalledWith("eng");
  await user.click(screen.getByText(/no team/i)); // failed → attention card, null slug
  expect(onOpenTeam).toHaveBeenCalledWith(null);
});

it("shows healthy teams as chips and zero-task teams under Quiet", () => {
  render(<OversightGrid data={data} onOpenTeam={() => {}} />);
  expect(screen.getByText("Platform")).toBeInTheDocument(); // healthy chip
  expect(screen.getByText("Design")).toBeInTheDocument(); // quiet chip
  expect(screen.getByText(/quiet/i)).toBeInTheDocument();
});

it("shows an all-healthy note when nothing needs attention, and omits an empty no-team", () => {
  const healthy: OversightResult = {
    teams: [{ slug: "plat", name: "Platform", counts: { total: 2, paused: 0, ack_failed: 0 }, members: [] }],
    no_team: { counts: { total: 0, paused: 0, ack_failed: 0 }, members: [] },
    totals: { total: 2, paused: 0, ack_failed: 0 },
  };
  render(<OversightGrid data={healthy} onOpenTeam={() => {}} />);
  expect(screen.getByText(/all teams healthy/i)).toBeInTheDocument();
  expect(screen.queryByText(/no team/i)).not.toBeInTheDocument();
});
