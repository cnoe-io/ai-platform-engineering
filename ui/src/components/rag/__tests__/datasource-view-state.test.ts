import type { DataSourceInfo } from "../Models";
import {
  dataSourceFilterProjection,
  matchesDatasourceFilters,
  parseDatasourceViewState,
  serializeDatasourceViewState,
} from "../datasource-view-state";

function datasource(overrides: Partial<DataSourceInfo> = {}): DataSourceInfo {
  return {
    datasource_id: "example-source",
    name: "Example handbook",
    ingestor_id: "web-ingestor",
    description: "Example documentation",
    source_type: "web",
    last_updated: 1,
    owner_team_slug: "primary",
    search_with_teams: ["everyone"],
    ...overrides,
  };
}

describe("datasource view state", () => {
  it("round-trips ingest selection and composable filters through query params", () => {
    const parsed = parseDatasourceViewState(new URLSearchParams(
      "ingest=slack&type=web&type=file&owner=Team%3A+primary&access=Team%3A+everyone&q=handbook&page=3",
    ));

    expect(parsed).toEqual({
      ingestType: "slack",
      sourceTypes: ["file", "web"],
      owners: ["Team: primary"],
      searchAccess: ["Team: everyone"],
      query: "handbook",
      page: 3,
    });
    expect(parseDatasourceViewState(serializeDatasourceViewState(parsed))).toEqual(parsed);
  });

  it("matches type, owner, search access, and name together", () => {
    const projection = dataSourceFilterProjection(datasource());
    const state = parseDatasourceViewState(new URLSearchParams(
      "type=web&owner=Team%3A+primary&access=Team%3A+everyone&q=handbook",
    ));

    expect(matchesDatasourceFilters(projection, state)).toBe(true);
    expect(matchesDatasourceFilters(projection, { ...state, owners: ["Team: secondary"] })).toBe(false);
    expect(matchesDatasourceFilters(projection, { ...state, searchAccess: ["Team: private"] })).toBe(false);
  });

  it("uses the person's display identity for personal owner and search filters", () => {
    const projection = dataSourceFilterProjection(datasource({
      owner_team_slug: null,
      owner_subject: "test-user-subject",
      owner_display_name: "test-user@example.com",
      search_with_teams: [],
    }));

    expect(projection.owner).toBe("Person: test-user@example.com");
    expect(projection.searchAccess).toContain("Person: test-user@example.com");
    expect(JSON.stringify(projection)).not.toContain("test-user-subject");
  });
});
