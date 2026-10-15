// Generates src/ui.js from public/index.html.
//
// Vercel does not trace readFileSync paths into the function bundle, so the page
// has to ship as a JavaScript string. public/index.html stays the editable
// source; run this after changing it. A test asserts the two stay in sync.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function renderModule(html) {
  const escaped = html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `// GENERATED FILE - do not edit.
// Source: public/index.html. Regenerate with: npm run build:ui
export const INDEX_HTML = \`${escaped}\`;
`;
}

export function sourceHtml() {
  return readFileSync(join(root, "public", "index.html"), "utf8");
}

export function currentModule() {
  return readFileSync(join(root, "src", "ui.js"), "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, "src", "ui.js"), renderModule(sourceHtml()));
  console.log("src/ui.js regenerated from public/index.html");
}
