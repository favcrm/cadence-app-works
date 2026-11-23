import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const dir = join(root, "app/screens/works");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const decl = JSON.parse(readFileSync(join(dir, "screens.json"), "utf8"));

test("built screen assets match the declared sha256 and size", () => {
  assert.equal(decl.contract, "app-screens/v2");
  assert.equal(decl.app, "works");
  assert.deepEqual(decl.startup, ["runtime.js", "client.js"]);
  assert.deepEqual(
    readdirSync(dir).sort(),
    ["client.js", "runtime.js", "screens.json", "works.css"],
  );
  let total = 0;
  for (const asset of decl.assets) {
    const bytes = readFileSync(join(dir, asset.name));
    assert.equal(bytes.length, asset.size, asset.name);
    assert.equal(sha(bytes), asset.sha256, asset.name);
    total += bytes.length;
  }
  assert.ok(total <= 2 * 1024 * 1024);
});

test("the nine works operations keep their names and call/slot split", () => {
  assert.deepEqual(decl.operations, [
    "works.query", "works.get", "works.create", "works.patch", "works.trash",
    "works.restore", "works.request_review", "works.review", "works.export",
  ]);
  assert.deepEqual(decl.may, ["records.call", "records.slot"]);
  assert.equal(decl.host_contract, "screen-records.v1");
  const ops = readFileSync(join(root, "src/screen/bridge/operations.ts"), "utf8");
  const slots = ops.slice(ops.indexOf("export const SLOT_FIELDS"), ops.indexOf("export const WRITES"));
  assert.deepEqual([...slots.matchAll(/"(works\.[a-z_]+)":/g)].map((m) => m[1]), ["works.review", "works.export"]);
});

test("canvas route params are declared as a view with a required p.id", () => {
  const view = decl.views.find((v) => v.id === "document");
  assert.deepEqual(view.params, { id: { type: "string", required: true } });
  assert.ok(decl.navigation.sections.some((s) => s.id === view.section));
});

test("the client bundle negotiates the six ready capabilities", () => {
  const client = readFileSync(join(dir, "client.js"), "utf8");
  for (const accept of [
    "screen.v2", "screen-records.v1", "screen-locale.v1",
    "screen-surfaces.v1", "screen-canvas.v1", "screen-route-params.v1",
  ]) {
    assert.ok(client.includes(accept), accept);
  }
});

test("app-chat contexts cover the list, doc, sheet and deck views", () => {
  const chat = JSON.parse(readFileSync(join(root, "app/app-chat.json"), "utf8"));
  assert.equal(chat.contract, "app-chat/v1");
  assert.deepEqual(chat.contexts.map((c) => c.id), decl.navigation.sections.map((s) => s.id));
  for (const context of chat.contexts) {
    assert.ok(context.prompts.length >= 1 && context.prompts.length <= 3, context.id);
    assert.ok(context.i18n["zh-TW"].prompts.length === context.prompts.length, context.id);
    assert.ok(context.record.prompts.length >= 1, context.id);
  }
});
