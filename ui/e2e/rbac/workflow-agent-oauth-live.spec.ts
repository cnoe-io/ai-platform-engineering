import { expect, test } from "@playwright/test";

import {
  fetchWorkflowServiceToken,
  workflowServiceAuthEnvOrSkip,
} from "./_workflow-service-auth";

test.describe("live workflow agent service auth", () => {
  test("rejects unauthenticated POST /api/workflow-runs with NOT_SIGNED_IN", async ({
    request,
  }) => {
    const env = workflowServiceAuthEnvOrSkip();

    const response = await request.post(`${env.baseUrl}/api/workflow-runs`, {
      headers: { "Content-Type": "application/json" },
      data: {
        workflow_config_id: env.globalWorkflowId,
        trigger_info: { triggered_by: "agent" },
      },
    });

    expect(response.status(), await response.text()).toBe(401);
    const body = (await response.json()) as { code?: string; reason?: string };
    expect(body).toMatchObject({
      code: "NOT_SIGNED_IN",
      reason: "not_signed_in",
    });
  });

  test("accepts client-credentials Bearer for global workflow start (dynamic-agents OAuth path)", async ({
    request,
  }) => {
    const env = workflowServiceAuthEnvOrSkip();
    const token = await fetchWorkflowServiceToken(request, env);

    const response = await request.post(`${env.baseUrl}/api/workflow-runs`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        workflow_config_id: env.globalWorkflowId,
        trigger_info: {
          triggered_by: "agent",
          context: { agent_id: "agent-sre-agent", source: "workflow-agent-oauth-live-e2e" },
        },
      },
    });

    const body = (await response.json().catch(() => ({}))) as {
      run_id?: string;
      status?: string;
      code?: string;
    };

    if (response.status() === 404) {
      test.skip(
        true,
        `Global workflow ${env.globalWorkflowId} not found in this stack; set WORKFLOW_AGENT_OAUTH_TEST_GLOBAL_ID.`,
      );
      return;
    }

    expect(response.status(), JSON.stringify(body)).toBe(201);
    expect(body.run_id).toEqual(expect.stringMatching(/^wfrun-/));
    expect(body.status).toBe("running");

    if (body.run_id) {
      await request.delete(`${env.baseUrl}/api/workflow-runs?id=${encodeURIComponent(body.run_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("returns 403 for service account starting a non-visible private workflow", async ({
    request,
  }) => {
    const env = workflowServiceAuthEnvOrSkip();
    const token = await fetchWorkflowServiceToken(request, env);

    const response = await request.post(`${env.baseUrl}/api/workflow-runs`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        workflow_config_id: "wf-private-user-owned-fixture",
        trigger_info: { triggered_by: "agent" },
      },
    });

    const body = await response.json().catch(() => ({}));
    expect([403, 404], JSON.stringify(body)).toContain(response.status());
    if (response.status() === 403) {
      expect(body).toMatchObject({ code: expect.stringMatching(/task#use|FORBIDDEN/i) });
    }
  });
});
