const examples = {
  finops: {
    readScope: "finops:read",
    invokeScope: "finops:agent:invoke",
    eyebrow: "FINOPS · STATIC EXAMPLE",
    title: "Cloud Cost Overview",
    summary: "A compact operating view for spend, movement, and the next optimization decision.",
    metrics: [
      ["Spend", "$128.4k", "Example 30-day period"],
      ["Forecast", "$134.2k", "4.5% above current run rate"],
      ["Top service", "Compute", "41% of example spend"],
      ["Anomalies", "2", "Sample signals to review"],
    ],
    trendTitle: "Weekly spend",
    trend: [["Week 1", 72], ["Week 2", 78], ["Week 3", 69], ["Week 4", 84]],
    actions: [
      ["Review", "Compute increased in the latest sample week."],
      ["Optimize", "Validate idle development capacity before resizing."],
      ["Guardrail", "Confirm savings do not reduce availability targets."],
    ],
    rows: [["Compute", "$52.6k", "+8%"], ["Database", "$31.8k", "+2%"], ["Storage", "$18.4k", "-3%"]],
    columns: ["Service", "Spend", "Change"],
  },
  weather: {
    readScope: "weather:read",
    invokeScope: "weather:agent",
    eyebrow: "WEATHER · STATIC EXAMPLE",
    title: "Example City Forecast",
    summary: "A decision-first forecast showing current conditions, the daily window, and material risks.",
    metrics: [
      ["Now", "72°F", "Feels like 72°F"],
      ["Rain", "20%", "Example daily probability"],
      ["Wind", "9 mph", "Light breeze"],
      ["Air quality", "Good", "Sample AQI: 34"],
    ],
    trendTitle: "Next 12 hours",
    trend: [["8 AM", 46], ["11 AM", 64], ["2 PM", 82], ["5 PM", 70], ["8 PM", 52]],
    actions: [
      ["Best window", "Late morning through mid-afternoon."],
      ["Watch", "A sample shower signal appears after 6 PM."],
      ["Decision", "Outdoor work is low risk in this fixture."],
    ],
    rows: [["Today", "75° / 58°", "20%"], ["Tomorrow", "71° / 56°", "35%"], ["Day 3", "68° / 54°", "15%"]],
    columns: ["Day", "High / low", "Rain"],
  },
  litellm: {
    readScope: "litellm:read",
    invokeScope: "litellm:agent:invoke",
    eyebrow: "LITELLM · STATIC EXAMPLE",
    title: "LLM Operations Overview",
    summary: "A sample operating view for inference spend, token volume, request traffic, and model mix.",
    metrics: [
      ["Spend", "$18.7k", "Example 30-day period"],
      ["Tokens", "2.4B", "Sample input and output volume"],
      ["Requests", "842k", "Example completed requests"],
      ["Cost / request", "$0.022", "Example blended unit cost"],
    ],
    trendTitle: "Model spend mix",
    trend: [["Model A", 82], ["Model B", 61], ["Model C", 36], ["Model D", 18]],
    actions: [
      ["Investigate", "Review the highest-cost model and user combinations."],
      ["Optimize", "Test smaller models for high-volume, low-complexity traffic."],
      ["Guardrail", "Protect quality and latency targets while changing routes."],
    ],
    rows: [["Model A", "$8.4k", "1.1B"], ["Model B", "$5.9k", "760M"], ["Model C", "$3.1k", "410M"]],
    columns: ["Model", "Spend", "Tokens"],
  },
  "oss-repo-management": {
    readScope: "oss-repo-management:read",
    invokeScope: "oss-repo-management:agent:invoke",
    eyebrow: "OSS REPO REPORT CARD · STATIC EXAMPLE",
    title: "example-org/example-repo",
    summary: "A sample OSS health report spanning adoption, engagement, delivery, contributors, and security posture.",
    metrics: [
      ["Stars", "2.4k", "+8% sample trend"],
      ["Contributors", "126", "18 active in 12 weeks"],
      ["PRs / week", "14", "12-week sample average"],
      ["OpenSSF", "8.1", "Sample security posture"],
    ],
    trendTitle: "Weekly repository activity",
    trend: [["Commits", 78], ["Pull requests", 62], ["Issue engagement", 51], ["New stars", 36]],
    actions: [
      ["Review", "Assign the three oldest pull requests."],
      ["Triage", "Confirm owners for eight untriaged issues."],
      ["Release", "Resolve the example blocker before cutting a release."],
    ],
    rows: [["PR review", "3", "High"], ["Issue triage", "8", "Medium"], ["Stale cleanup", "7", "Low"]],
    columns: ["Queue", "Items", "Priority"],
  },
};

export function renderStaticDashboardExample(kind, authorization = null) {
  const example = examples[kind];
  if (!example) throw new Error(`Unknown static dashboard example: ${kind}`);
  const hasLiveAuthorization = authorization !== null;
  const auth = authorization || {
    mode: "Example contract",
    appResource: `agentic_app:${kind}`,
    launchAction: "use",
    launchDecision: "NOT EVALUATED",
    decisionReference: "static-render",
    tokenAudience: `agentic-app:${kind}`,
    readScope: example.readScope,
    readScopeGranted: false,
    invokeScope: example.invokeScope,
    invokeScopeGranted: false,
  };
  const resolvedInvokeScope = auth.invokeScope || example.invokeScope;
  const maxTrend = Math.max(...example.trend.map(([, value]) => value), 1);
  const metricCards = example.metrics.map(([label, value, detail]) => `
    <article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
  const bars = example.trend.map(([label, value]) => `
    <div class="bar-row"><span>${escapeHtml(label)}</span><div class="track"><i style="width:${Math.round((value / maxTrend) * 100)}%"></i></div><b>${escapeHtml(String(value))}</b></div>`).join("");
  const actions = example.actions.map(([label, text]) => `
    <li><span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p></li>`).join("");
  const tableHead = example.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const tableRows = example.rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(example.title)} · Static dashboard example</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #07111f; color: #e5eef9; }
      * { box-sizing: border-box; }
      body { margin: 0; background: radial-gradient(circle at 10% 0, rgba(56,189,248,.15), transparent 32rem), #07111f; }
      main { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
      header, section { border: 1px solid #24364b; border-radius: 18px; background: rgba(10,24,41,.9); }
      header { padding: 24px; }
      .fixture { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: #3b2f08; color: #fde68a; font-size: 12px; font-weight: 800; letter-spacing: .08em; }
      .eyebrow { margin: 18px 0 4px; color: #7dd3fc; font-size: 12px; font-weight: 800; letter-spacing: .1em; }
      h1 { margin: 0; font-size: clamp(28px, 5vw, 48px); }
      header p { max-width: 720px; color: #a9bad0; line-height: 1.6; }
      .authz { margin: 14px 0; }
      .authz-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
      .authz-step { padding: 14px; border: 1px solid #29415a; border-radius: 14px; background: #091a2c; }
      .authz-step span { display: block; color: #7dd3fc; font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
      .authz-step strong { display: block; margin: 7px 0 4px; color: #ecfeff; font-size: 14px; }
      .authz-step small { color: #91a5bd; line-height: 1.45; }
      .allow { color: #6ee7b7; }
      code { color: #bae6fd; overflow-wrap: anywhere; }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 14px 0; }
      .metric { padding: 16px; border: 1px solid #24364b; border-radius: 16px; background: #0b1b2e; }
      .metric span, .metric small { display: block; color: #91a5bd; }
      .metric strong { display: block; margin: 8px 0 4px; font-size: 28px; }
      .grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 14px; }
      section { padding: 20px; }
      h2 { margin: 0 0 16px; font-size: 18px; }
      .bar-row { display: grid; grid-template-columns: 70px 1fr 34px; gap: 10px; align-items: center; margin: 12px 0; color: #b9c9da; }
      .track { height: 10px; overflow: hidden; border-radius: 999px; background: #14283f; }
      .track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #38bdf8, #34d399); }
      ul { margin: 0; padding: 0; list-style: none; }
      li { padding: 12px 0; border-top: 1px solid #24364b; }
      li:first-child { border-top: 0; }
      li span { color: #7dd3fc; font-size: 12px; font-weight: 800; text-transform: uppercase; }
      li p { margin: 4px 0 0; color: #c4d2e2; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; }
      th, td { padding: 11px 10px; border-bottom: 1px solid #24364b; text-align: left; }
      th { color: #91a5bd; font-size: 12px; text-transform: uppercase; }
      footer { margin-top: 14px; color: #91a5bd; font-size: 12px; }
      @media (max-width: 760px) { .metrics, .authz-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .grid { grid-template-columns: 1fr; } }
      @media (max-width: 460px) { .metrics { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <span class="fixture">STATIC EXAMPLE · SAMPLE DATA · NO LIVE CONNECTION</span>
        <div class="eyebrow">${escapeHtml(example.eyebrow)}</div>
        <h1>${escapeHtml(example.title)}</h1>
        <p>${escapeHtml(example.summary)}</p>
      </header>
      <section class="authz" aria-labelledby="authorization-path-title">
        <h2 id="authorization-path-title">CAS authorization path</h2>
        <div class="authz-grid">
          <article class="authz-step">
            <span>1 · App launch</span>
            <strong class="allow">${escapeHtml(auth.launchDecision)}</strong>
            <small><code>${escapeHtml(auth.appResource)}#${escapeHtml(auth.launchAction)}</code><br />Decision ${escapeHtml(auth.decisionReference)}</small>
          </article>
          <article class="authz-step">
            <span>2 · Runtime token</span>
            <strong class="allow">${auth.readScopeGranted ? "Verified" : escapeHtml(auth.mode)}</strong>
            <small>Audience <code>${escapeHtml(auth.tokenAudience)}</code><br />Scope <code>${escapeHtml(auth.readScope)}</code></small>
          </article>
          <article class="authz-step">
            <span>3 · Agent action</span>
            <strong>Separate decision</strong>
            <small>Requires <code>${escapeHtml(resolvedInvokeScope)}</code> and <code>agent:&lt;id&gt;#use</code>. Current read token: ${auth.invokeScopeGranted ? "invoke-capable" : "least-privilege read only"}.</small>
          </article>
          <article class="authz-step">
            <span>4 · MCP tool call</span>
            <strong>AgentGateway enforced</strong>
            <small>The selected agent must also hold the applicable <code>mcp_server#invoke</code> and <code>tool#call</code> grants.</small>
          </article>
        </div>
      </section>
      <div class="metrics">${metricCards}</div>
      <div class="grid">
        <section><h2>${escapeHtml(example.trendTitle)}</h2>${bars}</section>
        <section><h2>Recommended actions</h2><ul>${actions}</ul></section>
      </div>
      <section style="margin-top:14px"><h2>Supporting detail</h2><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></section>
      <footer>Fixture source: deterministic sample values embedded in the agentic-app runtime. ${hasLiveAuthorization ? "The CAS status above is request-specific and live; " : "The CAS panel above documents the example contract; "}dashboard values remain examples and must not be used for operational decisions.</footer>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}
