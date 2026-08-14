import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const PROJECT_SLUG = "example-project";
const PROJECT_ID = "example-project-id";
const RUN_ID = "default-off-run";
const EXPERIMENT_ID = "model-label-experiment";
const MODEL_A = "provider/model-alpha";
const MODEL_B = "provider/model-beta";
const SONNET_5_MODEL = "bedrock/global.anthropic.claude-sonnet-5";
const OPUS_5_MODEL = "bedrock/global.anthropic.claude-opus-5";

const RUBRIC_IDS = [
  "atomic_claim_inventory",
  "claim_evidence",
  "citation_coverage",
  "citation_correctness",
  "citation_specificity",
  "grounding",
  "unsupported_claims",
  "contradictions",
  "unverifiable_claims",
  "unsupported_critical_claims",
  "fabricated_entities",
  "fabricated_quantitative_details",
  "explicit_gaps",
  "semantic_fidelity",
  "conflict_disclosure",
  "source_freshness",
  "material_coverage",
  "scope_fidelity",
  "stable_page_preservation",
  "template_compliance",
  "internal_link_validity",
  "attribution_integrity",
  "evaluator_confidence",
  "cost_efficiency",
  "latency_efficiency",
] as const;

const globalOffPolicy = {
  _id: "global:*",
  scope_kind: "global",
  scope_id: null,
  version: 0,
  mode: "off",
  evaluator_model: "",
  rubrics: Object.fromEntries(RUBRIC_IDS.map((id) => [id, {
    enabled: true,
    blocking: false,
  }])),
  require_human_review: true,
  allow_steward_override: true,
  updated_at: "1970-01-01T00:00:00.000Z",
  updated_by: null,
};

const project = {
  _id: PROJECT_ID,
  type: "project",
  slug: PROJECT_SLUG,
  name: "Example Project",
  title: "Example Project",
  description: "Neutral model-evaluation fixture.",
  status: "active",
  team_id: "example-team-id",
  team_slug: "example-team",
  team_name: "Example Team",
  owner_id: "owner@example.test",
  member_ids: [],
  tags: [],
  sources: { repos: [], confluence_url: "", webex_rooms: [] },
};
const area = {
  ...project,
  _id: "example-area-id",
  type: "area",
  slug: "example-area",
  name: "Example Area",
  title: "Example Area",
};

test.describe("TOME model evaluations default-off behavior (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked TOME browser regression.",
    );
    await page.addInitScript(() => {
      window.localStorage.setItem("tome.onboarding.seen", "1");
    });
  });

  test("rejects a non-admin deep link before loading evaluation data", async ({ page }) => {
    let evaluationRequests = 0;
    const handler: MockRouteHandler = async ({ route, path, method }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: false });
        return true;
      }
      if (path.startsWith("/api/tome/admin/experiments")) {
        evaluationRequests += 1;
        await fulfillJson(route, { error: "Forbidden" }, 403);
        return true;
      }
      if (path === "/api/projects" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: { projects: [], active_ingest_count: 0 },
        });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [handler],
    });

    await page.goto("/projects/admin?tab=experiments", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/projects(?:\?.*)?$/);
    await expect(page.getByRole("tab", { name: "Model Evaluations" })).toHaveCount(0);
    expect(evaluationRequests).toBe(0);
  });

  test("shows the experimental admin surface defaulted Off without starting a run", async ({
    page,
  }) => {
    let startRequests = 0;
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [project] } });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "GET") {
        await fulfillJson(route, { data: [] });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "POST") {
        startRequests += 1;
        await fulfillJson(route, { data: { _id: "unexpected-run" } }, 202);
        return true;
      }
      if (path === "/api/tome/admin/quality-policies" && method === "GET") {
        await fulfillJson(route, { data: [globalOffPolicy] });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: {
        email: "tome-admin@example.test",
        name: "Example TOME Admin",
        role: "admin",
        canViewAdmin: true,
      },
      handlers: [handler],
    });

    await page.goto("/projects/admin?tab=experiments", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("tab", { name: "Model Evaluations" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByText("Note: Experimental", { exact: true })).toBeVisible();
    await expect(page.getByText(/LLM as a judge/)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Mode", exact: true })).toHaveValue("off");
    await expect(page.getByRole("button", { name: "Run model evaluation" })).toBeVisible();

    const policyGroundingHelp = page.getByRole("button", { name: "About Grounding", exact: true });
    await policyGroundingHelp.hover();
    await expect(page.getByText(
      "Scores checkable claims by evidence support: supported claims count fully and partially supported claims count half.",
      { exact: true },
    )).toBeVisible();

    for (const name of ["Model A", "Model B", "Evaluator model"]) {
      const modelPicker = page.getByRole("combobox", { name, exact: true });
      for (const model of [SONNET_5_MODEL, OPUS_5_MODEL]) {
        await expect(modelPicker.locator(`option[value="${model}"]`)).toHaveCount(1);
      }
    }
    const modelBPicker = page.getByRole("combobox", { name: "Model B", exact: true });
    await modelBPicker.selectOption(OPUS_5_MODEL);
    await expect(modelBPicker).toHaveValue(OPUS_5_MODEL);
    await modelBPicker.selectOption({ label: "Custom…" });
    const customModelInput = page.getByRole("textbox", {
      name: "Model B custom model id",
      exact: true,
    });
    await customModelInput.fill("provider/custom-model");
    await expect(customModelInput).toHaveValue("provider/custom-model");
    await modelBPicker.selectOption(OPUS_5_MODEL);
    await expect(customModelInput).toHaveCount(0);

    const newEvaluationToggle = page.getByRole("button", {
      name: "New paired model evaluation",
      exact: true,
    });
    const qualityPolicyToggle = page.getByRole("button", {
      name: "Quality policy",
      exact: true,
    });
    const evaluationRunsToggle = page.getByRole("button", {
      name: "Evaluation runs",
      exact: true,
    });
    await expect(newEvaluationToggle).toHaveAttribute("aria-expanded", "true");
    await expect(qualityPolicyToggle).toHaveAttribute("aria-expanded", "true");
    await expect(evaluationRunsToggle).toHaveAttribute("aria-expanded", "true");

    await newEvaluationToggle.click();
    await expect(newEvaluationToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Run model evaluation" })).toHaveCount(0);

    await qualityPolicyToggle.click();
    await expect(qualityPolicyToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("combobox", { name: "Mode", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save policy", exact: true })).toHaveCount(0);

    await evaluationRunsToggle.click();
    await expect(evaluationRunsToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("No experiments yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    expect(startRequests).toBe(0);
  });

  test("keeps the operation valid when the selected entity type changes", async ({ page }) => {
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [project, area] } });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "GET") {
        await fulfillJson(route, { data: [] });
        return true;
      }
      if (path === "/api/tome/admin/quality-policies" && method === "GET") {
        await fulfillJson(route, { data: [globalOffPolicy] });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: {
        email: "tome-admin@example.test",
        name: "Example TOME Admin",
        role: "admin",
        canViewAdmin: true,
      },
      handlers: [handler],
    });
    await page.goto("/projects/admin?tab=experiments", {
      waitUntil: "domcontentloaded",
    });

    const entity = page.getByRole("combobox", { name: "Entity", exact: true });
    const operation = page.getByRole("combobox", { name: "Operation", exact: true });
    await expect(entity).toHaveValue(PROJECT_ID);
    await expect(operation).toHaveValue("ingest");
    await expect(operation.locator('option[value="synthesize"]')).toHaveCount(0);

    await entity.selectOption("example-area-id");
    await expect(operation).toHaveValue("synthesize");
    await expect(operation.locator('option[value="ingest"]')).toHaveCount(0);
    await expect(page.getByText("Areas and BHAGs support synthesize and compact evaluations."))
      .toBeVisible();

    await operation.selectOption("compact");
    await entity.selectOption(PROJECT_ID);
    await expect(operation).toHaveValue("compact");
    await expect(operation.locator('option[value="synthesize"]')).toHaveCount(0);
  });

  test("shows active evaluation progress, model, judge, and pages", async ({ page }) => {
    const experiment = {
      _id: EXPERIMENT_ID,
      project_id: PROJECT_ID,
      project_slug: PROJECT_SLUG,
      evidence_bundle_id: "example-evidence-bundle",
      evidence_hash: "example-evidence-hash",
      config: {
        operation: "ingest",
        model_a: MODEL_A,
        model_b: MODEL_B,
        evaluator_model: "provider/model-judge",
        repeat_count: 1,
        evaluation_suite_id: "live-entity",
        evaluation_suite_version: 1,
        prompt_hash: "example-prompt-hash",
        evaluator_prompt_contract: {
          version: "tome-grounded-evaluator-v1",
          system_prompt: "You are a strict evidence auditor.",
          request_template: "<candidate_pages>{candidate_pages}</candidate_pages>",
          editable: false,
        },
        tool_contract_version: "example-tool-contract",
        rubric_policy: globalOffPolicy.rubrics,
      },
      status: "evaluating",
      trials: [
        { trial: 1, candidate: "a", run_identity: "run-a", artifact_id: "artifact-a", status: "succeeded", model: MODEL_A },
        { trial: 1, candidate: "b", run_identity: "run-b", artifact_id: "artifact-b", status: "succeeded", model: MODEL_B },
      ],
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "tome-admin@example.test",
    };
    const artifacts = [
      {
        _id: "artifact-a",
        experiment_id: EXPERIMENT_ID,
        project_id: PROJECT_ID,
        trial: 1,
        candidate: "a",
        blind_label: "candidate-x",
        model: MODEL_A,
        run_identity: "run-a",
        evidence_bundle_id: "example-evidence-bundle",
        pages: [
          { path: "activity.md", markdown: "Alpha" },
          { path: "foo.md", markdown: "Alpha foo" },
        ],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        _id: "artifact-b",
        experiment_id: EXPERIMENT_ID,
        project_id: PROJECT_ID,
        trial: 1,
        candidate: "b",
        blind_label: "candidate-y",
        model: MODEL_B,
        run_identity: "run-b",
        evidence_bundle_id: "example-evidence-bundle",
        pages: [
          { path: "activity.md", markdown: "Beta" },
          { path: "foo.md", markdown: "Beta foo" },
        ],
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [project] } });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "GET") {
        await fulfillJson(route, { data: [experiment] });
        return true;
      }
      if (path === `/api/tome/admin/experiments/${EXPERIMENT_ID}` && method === "GET") {
        await fulfillJson(route, {
          data: {
            experiment,
            artifacts,
            evaluations: [{
              artifact_id: "artifact-a",
              status: "passed",
              rubrics: [],
              claims: [],
              blocking_findings: [],
            }],
            aggregates: [],
            warnings: [],
          },
        });
        return true;
      }
      if (path === "/api/tome/admin/quality-policies" && method === "GET") {
        await fulfillJson(route, { data: [globalOffPolicy] });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: {
        email: "tome-admin@example.test",
        name: "Example TOME Admin",
        role: "admin",
        canViewAdmin: true,
      },
      handlers: [handler],
    });
    await page.goto("/projects/admin?tab=experiments", {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(`${PROJECT_SLUG} · ingest`, { exact: true }).click();

    const progress = page.getByRole("progressbar", {
      name: "Model evaluation progress",
      exact: true,
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "3");
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    await expect(page.getByText("75%", { exact: true })).toBeVisible();
    await expect(page.getByText("Evaluating candidate output", { exact: true })).toBeVisible();
    await expect(page.getByText(`Candidate model: ${MODEL_B}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Judge model: provider/model-judge", { exact: true })).toBeVisible();
    await expect(page.getByText("Pages in this output (2): activity.md, foo.md", { exact: true }))
      .toBeVisible();

    const promptToggle = page.getByRole("button", { name: "Evaluator prompt", exact: true });
    await expect(promptToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("You are a strict evidence auditor.", { exact: true }))
      .toHaveCount(0);
    await promptToggle.click();
    await expect(promptToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("You are a strict evidence auditor.", { exact: true }))
      .toBeVisible();
    await expect(page.getByText("<candidate_pages>{candidate_pages}</candidate_pages>", {
      exact: true,
    })).toBeVisible();
    await expect(page.getByText(
      "Editing is intentionally disabled to preserve blinded comparisons and reproducible results.",
      { exact: true },
    )).toBeVisible();
  });

  test("shows model ids and preserves the selected file across refreshes", async ({ page }) => {
    let experimentStatus = "evaluating";
    let detailRequests = 0;
    let stopRequests = 0;
    const experiment = {
      _id: EXPERIMENT_ID,
      project_id: PROJECT_ID,
      project_slug: PROJECT_SLUG,
      evidence_bundle_id: "example-evidence-bundle",
      evidence_hash: "example-evidence-hash",
      config: {
        operation: "ingest",
        model_a: MODEL_A,
        model_b: MODEL_B,
        evaluator_model: "provider/model-judge",
        repeat_count: 1,
        evaluation_suite_id: "live-entity",
        evaluation_suite_version: 1,
        prompt_hash: "example-prompt-hash",
        tool_contract_version: "example-tool-contract",
        rubric_policy: globalOffPolicy.rubrics,
      },
      status: experimentStatus,
      trials: [],
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "tome-admin@example.test",
    };
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [project] } });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "GET") {
        await fulfillJson(route, { data: [{ ...experiment, status: experimentStatus }] });
        return true;
      }
      if (path === `/api/tome/admin/experiments/${EXPERIMENT_ID}/stop` && method === "POST") {
        stopRequests += 1;
        experimentStatus = "stopped_by_user";
        await fulfillJson(route, { data: { _id: EXPERIMENT_ID, status: experimentStatus } });
        return true;
      }
      if (path === `/api/tome/admin/experiments/${EXPERIMENT_ID}` && method === "GET") {
        detailRequests += 1;
        await fulfillJson(route, {
          data: {
            experiment: { ...experiment, status: experimentStatus },
            artifacts: [
              { _id: "artifact-a", trial: 1, candidate: "a", blind_label: "candidate-x", model: MODEL_A, pages: [{ path: "activity.md", markdown: "Alpha" }, { path: "foo.md", markdown: "Alpha foo" }] },
              { _id: "artifact-b", trial: 1, candidate: "b", blind_label: "candidate-y", model: MODEL_B, pages: [{ path: "activity.md", markdown: "Beta" }, { path: "foo.md", markdown: "Beta foo" }] },
            ],
            evaluations: [
              { artifact_id: "artifact-a", status: "passed", rubrics: [], claims: [
                { id: "a-activity", page: "activity.md", section: null, exact_text: "Alpha", start_offset: 0, end_offset: 5, classification: "supported", reason: "Supported", confidence: 1, abstained: false, citations: ["https://example.test/source"], evidence: [{ evidence_item_id: "source", canonical_uri: "https://example.test/source", content_hash: "hash" }] },
                { id: "a-foo", page: "foo.md", section: null, exact_text: "Alpha foo", start_offset: 0, end_offset: 9, classification: "contradicted", reason: "Contradicted", confidence: 1, abstained: false, citations: ["https://example.test/source"], evidence: [{ evidence_item_id: "source", canonical_uri: "https://example.test/source", content_hash: "hash" }] },
              ] },
              { artifact_id: "artifact-b", status: "failed", rubrics: [], claims: [
                { id: "b-activity", page: "activity.md", section: null, exact_text: "Beta", start_offset: 0, end_offset: 4, classification: "partially_supported", reason: "Partial", confidence: 1, abstained: false, citations: ["https://example.test/source"], evidence: [{ evidence_item_id: "source", canonical_uri: "https://example.test/source", content_hash: "hash" }] },
                { id: "b-foo", page: "foo.md", section: null, exact_text: "Beta foo", start_offset: 0, end_offset: 8, classification: "supported", reason: "Supported", confidence: 1, abstained: false, citations: ["https://example.test/source"], evidence: [{ evidence_item_id: "source", canonical_uri: "https://example.test/source", content_hash: "hash" }] },
              ] },
            ],
            aggregates: [
              { candidate: "a", wins: 1, ties: 0, losses: 0, pass_rate: 1, mean_score: 1, median_score: 1, variance: 0, generation_cost_usd: 1, evaluation_cost_usd: 1, cost_per_supported_claim: 1, median_generation_latency_ms: 1, median_evaluation_latency_ms: 1 },
              { candidate: "b", wins: 0, ties: 0, losses: 1, pass_rate: 0, mean_score: 0, median_score: 0, variance: 0, generation_cost_usd: 1, evaluation_cost_usd: 1, cost_per_supported_claim: 1, median_generation_latency_ms: 1, median_evaluation_latency_ms: 1 },
            ],
            warnings: [],
          },
        });
        return true;
      }
      if (path === "/api/tome/admin/quality-policies" && method === "GET") {
        await fulfillJson(route, { data: [globalOffPolicy] });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: {
        email: "tome-admin@example.test",
        name: "Example TOME Admin",
        role: "admin",
        canViewAdmin: true,
      },
      handlers: [handler],
    });
    await page.goto("/projects/admin?tab=experiments", {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(`${PROJECT_SLUG} · ingest`, { exact: true }).click();

    expect(await page.getByText(MODEL_A, { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.getByText(MODEL_B, { exact: true }).count()).toBeGreaterThan(0);
    await expect(page.getByText("candidate-x", { exact: true })).toHaveCount(0);
    await expect(page.getByText("candidate-y", { exact: true })).toHaveCount(0);

    const pageSelect = page.getByRole("combobox", {
      name: "Evaluation page",
      exact: true,
    });
    await pageSelect.selectOption("foo.md");
    await expect(page.getByRole("heading", { name: "Selected file · foo.md", exact: true }))
      .toBeVisible();
    await expect(page.getByText("Contradicted 1", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Supported 1", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Alpha foo", { exact: true })).toBeVisible();
    await expect(page.getByText("Beta foo", { exact: true })).toBeVisible();
    await expect(page.locator('svg[role="img"][aria-label^="Rubric radar"]')).toBeVisible();
    const reportSafetyHelp = page.getByRole("button", {
      name: "About Hallucination safety",
      exact: true,
    });
    await reportSafetyHelp.hover();
    await expect(page.getByText(
      "Inverts unsupported, contradicted, unverifiable, critical, and fabricated finding rates so higher is safer.",
      { exact: true },
    )).toBeVisible();

    const detailRequestsBeforeRefresh = detailRequests;
    await expect.poll(() => detailRequests, { timeout: 7_000 })
      .toBeGreaterThan(detailRequestsBeforeRefresh);
    await expect(pageSelect).toHaveValue("foo.md");
    await expect(page.getByRole("heading", { name: "Selected file · foo.md", exact: true }))
      .toBeVisible();

    await page.getByRole("button", { name: "Stop evaluation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop evaluation", exact: true }))
      .toHaveCount(0);
    await expect(page.getByText("Stopped By User", { exact: true })).toBeVisible();
    expect(stopRequests).toBe(1);
  });

  test("explains evaluator failures and disables invalid comparisons", async ({ page }) => {
    const experiment = {
      _id: EXPERIMENT_ID,
      project_id: PROJECT_ID,
      project_slug: PROJECT_SLUG,
      evidence_bundle_id: "example-evidence-bundle",
      evidence_hash: "example-evidence-hash",
      config: {
        operation: "ingest",
        model_a: MODEL_A,
        model_b: MODEL_B,
        evaluator_model: "provider/model-judge",
        repeat_count: 1,
        evaluation_suite_id: "live-entity",
        evaluation_suite_version: 1,
        prompt_hash: "example-prompt-hash",
        tool_contract_version: "example-tool-contract",
        rubric_policy: globalOffPolicy.rubrics,
      },
      status: "completed",
      trials: [],
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "tome-admin@example.test",
    };
    const artifacts = [
      { _id: "artifact-a", trial: 1, candidate: "a", blind_label: "candidate-x", model: MODEL_A, pages: [{ path: "overview.md", markdown: "Alpha" }] },
      { _id: "artifact-b", trial: 1, candidate: "b", blind_label: "candidate-y", model: MODEL_B, pages: [{ path: "overview.md", markdown: "Beta" }] },
    ];
    const evaluations = artifacts.map((artifact) => ({
      _id: `evaluation-${artifact._id}`,
      artifact_id: artifact._id,
      blind_label: artifact.blind_label,
      status: "error",
      error: `Judge request failed for ${artifact.model}`,
      blocking_findings: [`Judge request failed for ${artifact.model}`],
      rubrics: [],
      claims: [],
    }));
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [project] } });
        return true;
      }
      if (path === "/api/tome/admin/experiments" && method === "GET") {
        await fulfillJson(route, { data: [experiment] });
        return true;
      }
      if (path === `/api/tome/admin/experiments/${EXPERIMENT_ID}` && method === "GET") {
        await fulfillJson(route, {
          data: {
            experiment,
            artifacts,
            evaluations,
            aggregates: ["a", "b"].map((candidate) => ({
              candidate,
              wins: 0,
              ties: 0,
              losses: 0,
              pass_rate: null,
              mean_score: null,
              median_score: null,
              variance: null,
              generation_cost_usd: 1,
              evaluation_cost_usd: 0,
              cost_per_supported_claim: null,
              median_generation_latency_ms: 10,
              median_evaluation_latency_ms: null,
            })),
            warnings: [],
          },
        });
        return true;
      }
      if (path === "/api/tome/admin/quality-policies" && method === "GET") {
        await fulfillJson(route, { data: [globalOffPolicy] });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: {
        email: "tome-admin@example.test",
        name: "Example TOME Admin",
        role: "admin",
        canViewAdmin: true,
      },
      handlers: [handler],
    });
    await page.goto("/projects/admin?tab=experiments", { waitUntil: "domcontentloaded" });
    await page.getByText(`${PROJECT_SLUG} · ingest`, { exact: true }).click();

    await expect(page.getByText("Evaluator failed for 2 candidate outputs", { exact: true }))
      .toBeVisible();
    await expect(page.getByText(
      "Radar unavailable because the evaluator failed for this trial. Review the error above and rerun the evaluation.",
      { exact: true },
    )).toBeVisible();
    await expect(page.locator('svg[role="img"][aria-label^="Rubric radar"]')).toHaveCount(0);
    await expect(page.getByText("Mean — · median — · variance —", { exact: true }))
      .toHaveCount(2);
    await expect(page.getByText("W/T/L 0/0/0 · pass —", { exact: true })).toHaveCount(2);
    const winnerButtons = page.getByRole("button", {
      name: "Select winner for draft review",
      exact: true,
    });
    await expect(winnerButtons).toHaveCount(2);
    for (const button of await winnerButtons.all()) {
      await expect(button).toBeDisabled();
    }
  });

  test("keeps normal draft approval unchanged when the quality policy is Off", async ({
    page,
  }) => {
    let approvalPayload: unknown = null;
    let evaluationRequests = 0;
    const handler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === `/api/tome/projects/${PROJECT_SLUG}/pages` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            slug: PROJECT_SLUG,
            tree: [{
              path: "overview.md",
              title: "Overview",
              kind: "dynamic",
              children: [],
            }],
            pages: {
              "overview.md": [
                "---",
                "title: Overview",
                "kind: dynamic",
                "---",
                "",
                "# Updated overview",
              ].join("\n"),
            },
            canEdit: true,
            canManageSteward: false,
          },
        });
        return true;
      }
      if (path === `/api/projects/${PROJECT_SLUG}` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            project,
            permissions: {
              can_read: true,
              can_edit: true,
              can_manage_steward: false,
            },
          },
        });
        return true;
      }
      if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
        await fulfillJson(route, { success: true, data: { projects: [] } });
        return true;
      }
      if (path === `/api/tome/projects/${PROJECT_SLUG}/edges` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: { outgoing: [], incoming: [], titles: {} },
        });
        return true;
      }
      if (path === `/api/tome/projects/${PROJECT_SLUG}/ingests` && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            runs: [{
              id: RUN_ID,
              status: "awaiting_review",
              report_id: "example-report-id",
            }],
          },
        });
        return true;
      }
      if (
        path === `/api/tome/projects/${PROJECT_SLUG}/ingests/${RUN_ID}` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          success: true,
          data: {
            id: RUN_ID,
            status: "awaiting_review",
            report_id: "example-report-id",
            quality_policy: {
              mode: "off",
              version: 0,
              scope: "global",
              scope_id: null,
              require_human_review: true,
              allow_steward_override: true,
            },
            quality_evaluation: null,
            log: "Draft ready for review.",
          },
        });
        return true;
      }
      if (
        path === `/api/tome/projects/${PROJECT_SLUG}/ingests/${RUN_ID}/review` &&
        method === "GET"
      ) {
        await fulfillJson(route, {
          success: true,
          data: {
            pages: [{
              path: "overview.md",
              oldBody: "# Previous overview",
              newBody: "# Updated overview",
              isNewPage: false,
            }],
          },
        });
        return true;
      }
      if (
        path === `/api/tome/projects/${PROJECT_SLUG}/ingests/${RUN_ID}/approve` &&
        method === "POST"
      ) {
        approvalPayload = await postJson(route);
        await fulfillJson(route, { success: true, data: { ok: true } });
        return true;
      }
      if (
        path.startsWith("/api/tome/admin/experiments") ||
        path.startsWith("/api/tome/admin/quality-policies")
      ) {
        evaluationRequests += 1;
        await fulfillJson(route, { error: "Unexpected evaluation request" }, 500);
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [handler],
    });

    await page.goto(`/projects/${PROJECT_SLUG}/tome/ingest/${RUN_ID}/review`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Draft review", { exact: true })).toBeVisible();
    await expect(page.getByText("Grounded quality", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/policy · version/)).toHaveCount(0);
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeEnabled();

    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname ===
        `/api/tome/projects/${PROJECT_SLUG}/ingests/${RUN_ID}/approve`,
    );
    await approve.click();
    expect((await response).status()).toBe(200);
    expect(approvalPayload).toEqual({});
    expect(evaluationRequests).toBe(0);
  });
});
