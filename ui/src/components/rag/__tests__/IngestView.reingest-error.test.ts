/**
 * @jest-environment node
 */

import { readFileSync } from "fs";
import path from "path";

describe("IngestView re-ingest error UX", () => {
  it("does not use a blocking browser alert for re-ingest failures", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/rag/IngestView.tsx"),
      "utf8",
    );

    expect(source).not.toContain("alert(`❌ Re-ingest failed:");
    expect(source).toContain("Re-ingest failed");
    expect(source).toContain("<Dialog");
  });

  it("uses in-app notifications instead of blocking browser alerts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/rag/IngestView.tsx"),
      "utf8",
    );

    expect(source).not.toContain("alert(");
    expect(source).toContain("useToast");
  });
});
