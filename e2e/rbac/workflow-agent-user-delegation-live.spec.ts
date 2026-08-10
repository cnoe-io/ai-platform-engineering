import { expect, test, type Page } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { installTestSession } from "./_helpers";
import {
  fetchWorkflowServiceToken,
  workflowServiceAuthEnvOrSkip,
} from "./_workflow-service-auth";

async function createPrivateWorkflow(page: Page, agentId: string) {
  return page.evaluate(
    async ({ agentId: stepAgentId }) => {
      const res = await fetch("/api/workflow-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: `delegation-e2e-${Date.now()}`,
          description: "Run-as-user delegation live fixture",
          visibility: "private",
          steps: [
            {
              type: "step",
              display_text: "Probe",
              agent_id: stepAgentId,
              prompt: "Return delegation fixture ok.",
              on_error: "abort",
              retry: null,
              config_override: null,
            },
          ],
        }),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
    { agentId },
  );
}

async function deleteWorkflow(page: Page, workflowId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await fetch(`/api/workflow-configs?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
  }, workflowId);
}

test.describe("live workflow run-as-user delegation", () => {
  const stepAgentId = process.env.WORKFLOW_AGENT_DELEGATION_TEST_AGENT_ID?.trim() || "agent-sre-agent";

  test("service account cannot start a team-scoped workflow (403 task#use)", async ({ request }) => {
    const env = workflowServiceAuthEnvOrSkip();
    const teamWorkflowId =
      process.env.WORKFLOW_AGENT_DELEGATION_TEST_TEAM_ID?.trim() || "wf-1781237966581-o4neazw9x";
    const token = await fetchWorkflowServiceToken(request, env);

    const response = await request.post(`${env.baseUrl}/api/workflow-runs`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      data: {
        workflow_config_id: teamWorkflowId,
        trigger_info: {
          triggered_by: "agent",
          context: { agent_id: "agent-sre-agent", source: "workflow-user-delegation-live-e2e" },
        },
      },
    });

    const body = await response.json().catch(() => ({}));
    if (response.status() === 404) {
      test.skip(
        true,
        `Team workflow ${teamWorkflowId} not found; set WORKFLOW_AGENT_DELEGATION_TEST_TEAM_ID.`,
      );
      return;
    }

    expect(response.status(), JSON.stringify(body)).toBe(403);
    expect(body).toMatchObject({ code: expect.stringMatching(/task#use|FORBIDDEN/i) });
  });

  test("browser session owner can start a private workflow they created", async ({ page, request }) => {
    const rbacEnv = rbacEnvOrSkip({ requireUserSub: true });
    const serviceEnv = workflowServiceAuthEnvOrSkip();

    if (!process.env.NEXTAUTH_SECRET) {
      test.skip(true, "NEXTAUTH_SECRET is required to mint a live session cookie for this test.");
      return;
    }

    await installTestSession(page, rbacEnv, {
      email: rbacEnv.user.email,
      subject: rbacEnv.user.sub!,
      role: "admin",
    });
    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const created = await createPrivateWorkflow(page, stepAgentId);
    if (created.status === 401) {
      test.skip(
        true,
        "Session cookie was rejected (401). Ensure NEXTAUTH_SECRET matches the running CAIPE UI stack.",
      );
      return;
    }
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const payload = created.body as { id?: string; _id?: string; data?: { id?: string; _id?: string } };
    const workflowId = payload.data?.id ?? payload.data?._id ?? payload.id ?? payload._id;
    expect(workflowId, JSON.stringify(created.body)).toEqual(expect.any(String));

    let runId: string | undefined;
    try {
      const sessionStart = await page.evaluate(async (wfId) => {
        const res = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            workflow_config_id: wfId,
            trigger_info: {
              triggered_by: "webui",
              context: { source: "workflow-user-delegation-live-e2e" },
            },
          }),
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
      }, workflowId!);

      expect(sessionStart.status, JSON.stringify(sessionStart.body)).toBe(201);
      expect(sessionStart.body).toMatchObject({
        run_id: expect.stringMatching(/^wfrun-/),
        status: "running",
      });
      runId = (sessionStart.body as { run_id?: string }).run_id;
    } finally {
      if (runId) {
        const serviceToken = await fetchWorkflowServiceToken(request, serviceEnv);
        await request.delete(`${serviceEnv.baseUrl}/api/workflow-runs?id=${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${serviceToken}` },
        });
      }
      await deleteWorkflow(page, workflowId!);
    }
  });

  test("service account cannot start the same private workflow (403 task#use)", async ({
    page,
    request,
  }) => {
    const rbacEnv = rbacEnvOrSkip({ requireUserSub: true });
    const serviceEnv = workflowServiceAuthEnvOrSkip();

    if (!process.env.NEXTAUTH_SECRET) {
      test.skip(true, "NEXTAUTH_SECRET is required to mint a live session cookie for this test.");
      return;
    }

    await installTestSession(page, rbacEnv, {
      email: rbacEnv.user.email,
      subject: rbacEnv.user.sub!,
      role: "admin",
    });
    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const created = await createPrivateWorkflow(page, stepAgentId);
    if (created.status === 401) {
      test.skip(
        true,
        "Session cookie was rejected (401). Ensure NEXTAUTH_SECRET matches the running CAIPE UI stack.",
      );
      return;
    }
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const payload = created.body as { id?: string; _id?: string; data?: { id?: string; _id?: string } };
    const workflowId = payload.data?.id ?? payload.data?._id ?? payload.id ?? payload._id;
    expect(workflowId, JSON.stringify(created.body)).toEqual(expect.any(String));

    try {
      const token = await fetchWorkflowServiceToken(request, serviceEnv);
      const response = await request.post(`${serviceEnv.baseUrl}/api/workflow-runs`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: {
          workflow_config_id: workflowId,
          trigger_info: {
            triggered_by: "agent",
            context: { source: "workflow-user-delegation-live-e2e" },
          },
        },
      });
      const body = await response.json().catch(() => ({}));
      expect(response.status(), JSON.stringify(body)).toBe(403);
      expect(body).toMatchObject({ code: expect.stringMatching(/task#use|FORBIDDEN/i) });
    } finally {
      await deleteWorkflow(page, workflowId!);
    }
  });

  test("service account can still start global workflow when no user bearer is present", async ({
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
          context: { source: "workflow-user-delegation-live-e2e-fallback" },
        },
      },
    });

    const body = (await response.json().catch(() => ({}))) as { run_id?: string; status?: string };
    if (response.status() === 404) {
      test.skip(true, `Global workflow ${env.globalWorkflowId} not found in this stack.`);
      return;
    }

    expect(response.status(), JSON.stringify(body)).toBe(201);
    expect(body.run_id).toEqual(expect.stringMatching(/^wfrun-/));

    if (body.run_id) {
      await request.delete(`${env.baseUrl}/api/workflow-runs?id=${encodeURIComponent(body.run_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });
});
