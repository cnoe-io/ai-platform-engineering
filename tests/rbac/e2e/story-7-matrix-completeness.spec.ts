/**
 * Story 7 matrix-completeness spec — task T058.
 *
 * Maps to spec.md §"User Story 7 — Comprehensive automated test matrix
 * exists and runs in CI" (FR-008, FR-009, SC-006).
 *
 * What it asserts
 * ---------------
 * For every entry in `tests/rbac/rbac-matrix.yaml`, exactly ONE of the
 * following must be true:
 *
 *   (a) `surface == 'ui_bff'` AND it appears in the Jest matrix-driver
 *       results emitted by `ui/src/__tests__/rbac-matrix-driver.test.ts`.
 *   (b) `surface in {supervisor, mcp, dynamic_agents, rag, slack_bot}`
 *       AND it appears in the pytest matrix-driver results emitted by
 *       `tests/rbac/unit/py/test_matrix_driver.py`.
 *
 * Failure mode this protects against:
 *   "Matrix entry exists, but no test driver picks it up." — i.e. a
 *   route was added to the matrix to keep the linter happy but never
 *   wired up to actually run. The schema linter alone cannot detect
 *   this — we need the runtime view of "which test names actually ran
 *   in the most recent CI invocation".
 *
 * How it gets the runtime view
 * -----------------------------
 * Both drivers emit a JUnit XML report:
 *   - Jest:   ui/test-results/junit.xml          (configured in jest.config)
 *   - pytest: test-results/rbac-pytest.xml       (configured by --junitxml)
 *
 * In the CI pipeline (T060), the `make test-rbac-jest` and
 * `make test-rbac-pytest` steps run BEFORE this Playwright suite, so
 * the JUnit files are present when this spec runs.
 *
 * If the JUnit files aren't present (local dev where the prior steps
 * didn't run), this spec **skips with a warning** rather than failing —
 * the equivalent CI gate (T060) is the source of truth.
 *
 * Tagged `@rbac` so `make test-rbac-e2e` picks it up.
 */

import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";

import { test, expect } from "./persona-fixture";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MATRIX_YAML = path.join(REPO_ROOT, "tests", "rbac", "rbac-matrix.yaml");
const JEST_JUNIT = path.join(REPO_ROOT, "ui", "test-results", "junit.xml");
const PYTEST_JUNIT = path.join(REPO_ROOT, "test-results", "rbac-pytest.xml");

interface MatrixRow {
  id: string;
  surface: string;
  migration_status?: "migrated" | "pending";
}

function loadMatrixRows(): MatrixRow[] {
  const raw = fs.readFileSync(MATRIX_YAML, "utf-8");
  const data = YAML.parse(raw) as { routes?: MatrixRow[] };
  return data.routes ?? [];
}

function loadTestcaseNames(junitPath: string): Set<string> {
  if (!fs.existsSync(junitPath)) return new Set();
  const xml = fs.readFileSync(junitPath, "utf-8");
  // Cheap regex extraction — a full XML parser is overkill for the
  // narrow shape we read. JUnit emits <testcase name="..." classname="...">
  // and we only need the name to match against `${row.id}::${persona}`.
  const names = new Set<string>();
  const re = /<testcase[^>]*name="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) names.add(m[1]);
  return names;
}

test.describe("@rbac Story 7 — matrix completeness", () => {
  test("every active matrix entry is exercised by a driver", async () => {
    const rows = loadMatrixRows();
    const jestNames = loadTestcaseNames(JEST_JUNIT);
    const pytestNames = loadTestcaseNames(PYTEST_JUNIT);

    if (jestNames.size === 0 && pytestNames.size === 0) {
      test.skip(
        true,
        `No JUnit reports found at ${JEST_JUNIT} or ${PYTEST_JUNIT}. ` +
          `Run \`make test-rbac-jest\` and \`make test-rbac-pytest\` first ` +
          `(or rely on the CI pipeline which always runs them first).`
      );
      return;
    }

    const missing: { id: string; surface: string; reason: string }[] = [];
    for (const row of rows) {
      if (row.migration_status === "pending") continue;

      const idPrefix = row.id;
      const matched =
        row.surface === "ui_bff"
          ? Array.from(jestNames).some((n) => n.includes(idPrefix))
          : Array.from(pytestNames).some((n) => n.includes(idPrefix));

      if (!matched) {
        missing.push({
          id: idPrefix,
          surface: row.surface,
          reason: `expected a ${row.surface === "ui_bff" ? "Jest" : "pytest"} testcase containing id ${idPrefix}`,
        });
      }
    }

    if (missing.length > 0) {
      const detail = missing
        .map((m) => `  - ${m.id} (surface=${m.surface}): ${m.reason}`)
        .join("\n");
      throw new Error(
        `Story 7 (FR-009/SC-006): ${missing.length} matrix entries have no driver coverage:\n${detail}\n\n` +
          `Fix: either set migration_status: pending in tests/rbac/rbac-matrix.yaml ` +
          `(if the migration is intentionally deferred) or implement the driver coverage ` +
          `for that surface.`
      );
    }
    expect(missing).toHaveLength(0);
  });
});
