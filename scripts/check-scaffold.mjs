import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative as relativePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validateAppStoragePackage, validateWorksStorage } from "./app-storage.mjs";

// Offline package validation for the installable `works` bundle, plus syntax
// checks for the dev-only reference tools. This does not replace
// `cadence app check app`, which is the host's authoritative validator.

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, "app");

const fail = (message) => {
  console.error(`package check: ${message}`);
  process.exit(1);
};

const read = (relative) => readFileSync(join(root, relative), "utf8");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

// 1. Bundle shape: every shipped file must exist and the layout must be the
//    one the host installs.
const bundleFiles = walk(bundle).map((full) => relativePath(root, full).split(sep).join("/"));
const requiredBundle = [
  "app/app.md",
  "app/workflows/document-draft.md",
  "app/views/app-views-v1.json",
  "app/screens/works/screens.json",
  "app/screens/works/client.js",
  "app/screens/works/app.css",
  "app/assets/works.svg",
  "app/app-storage.json",
  "app/storage/001-documents.json",
];
for (const relative of requiredBundle) {
  if (!bundleFiles.includes(relative)) fail(`bundle is missing ${relative}`);
}

// 2. Manifest: a real installable app, not a placeholder.
const manifest = read("app/app.md");
const frontmatter = manifest.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatter) fail("app/app.md has no frontmatter");
const fields = frontmatter[1];
if (!/^app:\s*works\s*$/m.test(fields)) fail("app/app.md app is not works");
if (!/^title:\s*Works\s*$/m.test(fields)) fail("app/app.md title is not Works");
if (!/^version:\s*'\d+\.\d+\.\d+'\s*$/m.test(fields)) fail("app/app.md version is not semver");
for (const requirement of [
  "app-screens: [1]",
  "screen-records: [1]",
  "app-views: [1]",
  "app-storage: [1]",
]) {
  if (!fields.includes(requirement)) fail(`app/app.md does not require ${requirement}`);
}

// 3. Workflow: must declare the same workflow the bundle ships.
const workflow = read("app/workflows/document-draft.md");
if (!/^---\r?\n[\s\S]*?\r?\n---/.test(workflow)) fail("document-draft.md has no frontmatter");
if (!/^## Draft text: \{\{title\}\}$/m.test(workflow)) fail("document-draft.md has no draft step");
if (!/^## Review draft text: \{\{title\}\}$/m.test(workflow)) fail("document-draft.md has no review step");
if (/works\.(create|patch|trash|restore|request_review|review|export)/.test(workflow)) {
  fail("document-draft.md names a Works mutation");
}

// 4. Views: JSON, contract app-views/v1, field ids are safe identifiers.
const views = JSON.parse(read("app/views/app-views-v1.json"));
if (views.contract !== "app-views/v1") fail("views contract is not app-views/v1");
if (views.app !== "works") fail("views app is not works");
const safeId = /^[a-z][a-z0-9-]*$/;
for (const view of views.views) {
  for (const field of view.fields) {
    if (!safeId.test(field.id)) fail(`view field id ${field.id} is not a safe identifier`);
  }
}

// 5. Screen: declares only host operations and matching asset digests.
const screens = JSON.parse(read("app/screens/works/screens.json"));
if (screens.contract !== "app-screens/v2") fail("screens contract is not app-screens/v2");
if (screens.host_contract !== "screen-records.v1") fail("screens host_contract is not screen-records.v1");
const operations = [
  "works.query",
  "works.get",
  "works.create",
  "works.patch",
  "works.trash",
  "works.restore",
  "works.request_review",
  "works.review",
  "works.export",
];
if (JSON.stringify([...screens.operations].sort()) !== JSON.stringify([...operations].sort())) {
  fail("screens operations are not the nine works operations");
}
if (JSON.stringify(screens.may) !== JSON.stringify(["records.call", "records.slot"])) {
  fail("screens may is not records.call and records.slot");
}
for (const asset of screens.assets) {
  const bytes = readFileSync(join(bundle, "screens/works", asset.name));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (asset.sha256 !== digest) fail(`${asset.name} sha256 does not match its bytes`);
  if (asset.size !== bytes.length) fail(`${asset.name} size does not match its bytes`);
}

// 5b. Package-owned storage: descriptor, raw-byte migration checksums and the
//     Works content boundary. The host's app-storage validator remains the
//     authority for keyword admission and execution.
const storage = validateAppStoragePackage(bundle);
if (storage.descriptor?.app !== screens.app) {
  fail("app-storage app does not match the screen app");
}
for (const error of [...storage.errors, ...validateWorksStorage(storage)]) {
  fail(`app-storage: ${error}`);
}

// 6. Shipped bytes: no localhost, reference host, fixture or actor picker.
const forbiddenInBundle = [
  /localhost|127\.0\.0\.1/,
  /reference host|fixture|\.data\//i,
  /\bactor\b/i,
  /src\/host|dev\/write|works-write/,
];
for (const relative of bundleFiles) {
  if (!/\.(md|json|js|css|svg)$/.test(relative)) continue;
  const text = readFileSync(join(root, relative), "utf8");
  for (const pattern of forbiddenInBundle) {
    if (pattern.test(text)) fail(`${relative} contains forbidden ${pattern}`);
  }
}

// 7. Dev-only tools: still syntactically valid and not imported by the bundle.
const devTools = [
  "design/mockup/canvas.js",
  "src/content/fixtures.mjs",
  "src/content/reader.mjs",
  "src/contract/host.mjs",
  "src/host/server.mjs",
  "src/host/client.mjs",
  "scripts/works.mjs",
  "src/screens/works.mjs",
  "src/screens/works-write.mjs",
  "dev/dev.mjs",
  "dev/write.mjs",
];
for (const relative of devTools) {
  if (!existsSync(join(root, relative))) fail(`missing ${relative}`);
  const syntax = spawnSync(process.execPath, ["--check", join(root, relative)], {
    stdio: "inherit",
  });
  if (syntax.status !== 0) fail(`${relative} failed node --check`);
}

console.log("package ok");
