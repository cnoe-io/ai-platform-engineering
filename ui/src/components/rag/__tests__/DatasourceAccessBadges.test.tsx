/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { DatasourceAccessBadges } from "../DatasourceAccessBadges";

describe("DatasourceAccessBadges", () => {
  it("shows the management owner separately from search teams", () => {
    render(
      <DatasourceAccessBadges
        ownerTeamSlug="management-team"
        searchTeamSlugs={["reader-team", "secondary-team"]}
        detailsKnown
      />,
    );

    expect(screen.getByText("Owner: management-team")).toBeInTheDocument();
    expect(screen.getByText("Search: reader-team +1")).toBeInTheDocument();
    expect(screen.getByTitle("Search access: reader-team, secondary-team")).toBeInTheDocument();
  });

  it("labels a personal source as personally owned and searchable", () => {
    render(
      <DatasourceAccessBadges
        ownerSubject="test-user"
        ownerDisplayName="test-user@example.com"
        searchTeamSlugs={[]}
        detailsKnown
      />,
    );

    expect(screen.getByText("Owner: test-user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Search: test-user@example.com")).toBeInTheDocument();
  });

  it("includes both the personal owner and shared search teams", () => {
    render(
      <DatasourceAccessBadges
        ownerSubject="test-user"
        ownerDisplayName="test-user@example.com"
        searchTeamSlugs={["reader-team"]}
        detailsKnown
      />,
    );

    expect(screen.getByText("Search: test-user@example.com +1")).toBeInTheDocument();
    expect(screen.getByTitle("Search access: test-user@example.com, reader-team")).toBeInTheDocument();
  });

  it("does not expose policy details to a content-only reader", () => {
    render(
      <DatasourceAccessBadges
        detailsKnown={false}
        canReadContent
      />,
    );

    expect(screen.getByText("Owner: Restricted")).toBeInTheDocument();
    expect(screen.getByText("Search: Shared with you")).toBeInTheDocument();
  });
});
