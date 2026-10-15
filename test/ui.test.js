import { test } from "node:test";
import assert from "node:assert/strict";
import { renderModule, sourceHtml, currentModule } from "../scripts/build-ui.mjs";
import { INDEX_HTML } from "../src/ui.js";

test("src/ui.js is in sync with public/index.html", () => {
  assert.equal(
    currentModule(),
    renderModule(sourceHtml()),
    "public/index.html changed without regenerating; run: npm run build:ui",
  );
});

test("the page carries the controls the app depends on", () => {
  for (const id of ["token", "mic", "input", "send", "business", "briefBtn", "syncBtn", "approvals"]) {
    assert.ok(INDEX_HTML.includes(`id="${id}"`), `missing #${id}`);
  }
});

test("the page keeps its dark-mode and mobile guards", () => {
  assert.match(INDEX_HTML, /prefers-color-scheme: light/);
  assert.match(INDEX_HTML, /width=device-width/);
  assert.match(INDEX_HTML, /<title>Jarvis<\/title>/);
});
