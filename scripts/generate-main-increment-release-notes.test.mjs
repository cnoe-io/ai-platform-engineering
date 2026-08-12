import assert from "node:assert/strict";
import test from "node:test";

import { classifySubject, renderMarkdown } from "./generate-main-increment-release-notes.mjs";

test("classifies conventional commits and removes the PR suffix", () => {
  assert.deepEqual(classifySubject("feat(tome): add quick ingest (#399)"), {
    category: "features",
    pullRequest: "399",
    scope: "tome",
    text: "add quick ingest",
  });
  assert.deepEqual(classifySubject("fix: preserve access"), {
    category: "fixes",
    pullRequest: null,
    scope: null,
    text: "preserve access",
  });
});

test("renders increment sections and mirror links", () => {
  const body = renderMarkdown({
    repository: "example/repository",
    currentTag: "caipe-ui-0.5.63-ui-main-bbbbbbbbb",
    previousTag: "caipe-ui-0.5.63-ui-main-aaaaaaaaa",
    previousVersion: "0.5.63-ui-main-aaaaaaaaa",
    changes: [
      {
        category: "features",
        pullRequest: "42",
        scope: "projects",
        sha: "bbbbbbbbb11111111",
        text: "add project import",
      },
    ],
  });

  assert.match(body, /## What's New/);
  assert.match(body, /example\/repository\/pull\/42/);
  assert.match(body, /compare\/caipe-ui-0\.5\.63-ui-main-aaaaaaaaa\.\.\.caipe-ui-0\.5\.63-ui-main-bbbbbbbbb/);
});
