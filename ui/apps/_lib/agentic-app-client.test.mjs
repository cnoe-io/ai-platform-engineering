import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  agenticAppConversationClientSource,
  renderAgenticAppConversationClient,
} from "./conversation-client.mjs";
import { renderStaticDashboardExample } from "./static-dashboard-examples.mjs";
import { renderMicrofrontendClient } from "./microfrontend-client.mjs";

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("creates an authorized conversation before invoking an agent", async () => {
  const calls = [];
  const context = vm.createContext({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/chat/conversations") {
        return jsonResponse(201, { success: true, data: { conversation: { _id: "conversation-example" } } });
      }
      return jsonResponse(200, { success: true, content: "Example result" });
    },
  });
  vm.runInContext(agenticAppConversationClientSource, context);

  const result = await vm.runInContext(`invokeAgenticApp({
    agentId: "agent-example",
    appId: "example-dashboard",
    title: "Example dashboard",
    message: "Build the dashboard",
    clientContext: { dashboardKind: "overview" },
  })`, context);

  assert.equal(result.content, "Example result");
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/chat/conversations",
    "/api/v1/chat/invoke",
  ]);
  const creationBody = JSON.parse(calls[0].options.body);
  assert.equal(creationBody.client_type, "webui");
  assert.equal(creationBody.agent_id, "agent-example");
  const invokeBody = JSON.parse(calls[1].options.body);
  assert.equal(invokeBody.conversation_id, "conversation-example");
  assert.equal(invokeBody.client_context.appId, "example-dashboard");
});

test("does not invoke the agent when conversation creation is denied", async () => {
  const calls = [];
  const context = vm.createContext({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(403, { success: false, error: "Access denied", code: "agent#can_use" });
    },
  });
  vm.runInContext(agenticAppConversationClientSource, context);

  await assert.rejects(
    vm.runInContext(`invokeAgenticApp({
      agentId: "agent-example",
      appId: "example-dashboard",
      title: "Example dashboard",
      message: "Build the dashboard",
    })`, context),
    /Access denied \[agent#can_use\]/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/chat/conversations");
});

test("renders the shared browser helper as an inline script", () => {
  const html = renderAgenticAppConversationClient();
  assert.match(html, /^<script>/);
  assert.match(html, /createAgenticAppConversation/);
  assert.match(html, /<\/script>$/);
});

test("renders a same-origin versioned microfrontend client", () => {
  const html = renderMicrofrontendClient("example-app");
  assert.match(html, /caipe\.microfrontend\.initialize\.v1/);
  assert.match(html, /event\.origin !== window\.location\.origin/);
  assert.match(html, /"example-app"/);
  assert.match(html, /--app-font-scale/);
  assert.match(html, /caipe:microfrontend-initialize/);
});

test("applies host density and text-scale preferences before notifying the app", () => {
  const callbacks = new Map();
  const styleValues = new Map();
  const classValues = new Map();
  const readyMessages = [];
  const parent = {
    postMessage(message, origin) {
      readyMessages.push({ message, origin });
    },
  };
  const window = {
    location: { origin: "https://example.test" },
    parent,
    addEventListener(type, callback) {
      callbacks.set(type, callback);
    },
    dispatchEvent(event) {
      callbacks.get(event.type)?.(event);
    },
  };
  const context = vm.createContext({
    window,
    document: {
      documentElement: {
        dataset: {},
        style: { setProperty: (key, value) => styleValues.set(key, value) },
      },
      body: {
        classList: { toggle: (key, value) => classValues.set(key, value) },
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
  });
  const source = renderMicrofrontendClient("example-app")
    .replace(/^<script>/, "")
    .replace(/<\/script>$/, "");
  vm.runInContext(source, context);

  callbacks.get("message")({
    origin: "https://example.test",
    source: parent,
    data: {
      type: "caipe.microfrontend.initialize.v1",
      version: "1.0",
      appId: "example-app",
      context: {
        surface: "hosted",
        theme: "dark",
        preferences: { density: "comfortable", textScale: "large" },
      },
    },
  });

  assert.equal(classValues.get("compact"), false);
  assert.equal(styleValues.get("--app-font-scale"), "1.12");
  assert.deepEqual(JSON.parse(JSON.stringify(readyMessages)), [
    {
      message: {
        type: "caipe.microfrontend.ready.v1",
        version: "1.0",
        appId: "example-app",
      },
      origin: "https://example.test",
    },
  ]);
});

for (const kind of ["finops", "weather", "litellm", "oss-repo-management"]) {
  test(`renders a clearly labeled, network-free ${kind} static example`, () => {
    const html = renderStaticDashboardExample(kind);
    assert.match(html, /STATIC EXAMPLE · SAMPLE DATA · NO LIVE CONNECTION/);
    assert.match(html, /Fixture source:/);
    assert.match(html, /CAS authorization path/);
    assert.match(html, /agentic_app:/);
    assert.match(html, /AgentGateway enforced/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /fetch\(/i);
    assert.doesNotMatch(html, /https?:\/\//i);
  });
}
