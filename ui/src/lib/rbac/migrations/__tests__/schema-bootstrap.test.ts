import { schemaAreasNeedingVersionBootstrap } from "../schema-bootstrap";

describe("schemaAreasNeedingVersionBootstrap", () => {
  it("includes unversioned schema areas that have a migration target", () => {
    expect(
      schemaAreasNeedingVersionBootstrap([
        { schema_area: "messages", current_version: null, target_version: 1, status: "unknown" },
        { schema_area: "conversations", current_version: 2, target_version: 2, status: "current" },
      ]),
    ).toEqual(["messages"]);
  });

  it("excludes orphan Mongo collections with no migration target", () => {
    expect(
      schemaAreasNeedingVersionBootstrap([
        { schema_area: "orphan_collection", current_version: null, target_version: null, status: "unknown" },
        { schema_area: "feedback", current_version: null, target_version: 1, status: "unknown" },
      ]),
    ).toEqual(["feedback"]);
  });
});
