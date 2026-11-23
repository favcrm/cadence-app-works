import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const files = walk(join(root, "src/screen"));
const read = (file) => readFileSync(file, "utf8");
const code = files.filter((f) => /\.tsx?$/.test(f)).map(read).join("\n");
const css = files.filter((f) => f.endsWith(".css")).map(read).join("\n");

test("screen source uses screen-ui primitives only", () => {
  assert.equal(/crm-[a-z]/.test(code + css), false, "legacy .crm-* class");
  assert.equal(/<select\b/.test(code), false, "native <select>");
  assert.equal(/\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(code), false);
  assert.equal(/@import|url\(/.test(css), false, "vendored or remote host CSS");
});

test("page and toolbars paint no opaque background", () => {
  assert.match(css, /html,\s*body\s*\{\s*background:\s*transparent;/);
  for (const selector of [".app-outlet.works", ".works-toolbar"]) {
    const block = css.slice(css.indexOf(selector)).match(/\{[^}]*\}/)[0];
    assert.match(block, /background:\s*transparent/, selector);
  }
});

test("calls never carry actor or reviewer identity", () => {
  const operations = read(join(root, "src/screen/bridge/operations.ts"));
  const tables = operations.slice(operations.indexOf("export interface CallArgs"), operations.indexOf("export const WRITES"));
  const fields = tables.replace(/\/\/.*$/gm, "");
  assert.equal(/actor|reviewer|on_behalf|decision|format/i.test(fields), false);
});

test("canvas mode is read-only and route-param driven", () => {
  const screen = read(join(root, "src/screen/features/works/WorksScreen.tsx"));
  assert.match(screen, /const can = \(verb: string\) => !canvas && actions\.includes\(verb\)/);
  assert.match(screen, /route\.params\.id/);
  const channel = read(join(root, "src/screen/bridge/channel.ts"));
  for (const flag of ["canvas: true", "routeParams: true", "locale: true", "surfaces: true", "records: true"]) {
    assert.ok(channel.includes(flag), flag);
  }
  // Six ready capabilities is the host limit: nothing beyond these five opt-ins plus screen.v2.
  for (const extra of ["actions:", "media:", "presentation:", "audio:", "catalog:"]) {
    assert.equal(channel.includes(extra), false, extra);
  }
});

test("edits save through works.patch at the loaded revision", () => {
  const api = read(join(root, "src/screen/features/works/api.ts"));
  assert.match(api, /"works\.patch"[\s\S]*if_revision: base\.revision/);
  assert.match(api, /classify\(/);
  const detail = read(join(root, "src/screen/features/works/DetailView.tsx"));
  assert.match(detail, /failure\.kind === "stale"[\s\S]{0,200}setStale\(true\)/);
});
