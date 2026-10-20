import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const fail = (message) => {
  console.error(`scaffold check: ${message}`);
  process.exit(1);
};

const required = [
  "README.md",
  "AGENTS.md",
  "app/app.md",
  "design/mockup/index.html",
  "design/mockup/canvas.css",
  "design/mockup/canvas.js",
  "design/mockup/tokens.css",
  "design/mockup/kit.css",
  "docs/content-model.md",
  "docs/agent-contract.md",
  "docs/repository-layout.md",
];

for (const relative of required) {
  if (!existsSync(join(root, relative))) fail(`missing ${relative}`);
}

const manifest = readFileSync(join(root, "app/app.md"), "utf8");
const frontmatter = manifest.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatter) fail("app/app.md has no frontmatter");

const fields = frontmatter[1];
if (!/^app:\s*works\s*$/m.test(fields)) fail("app/app.md app is not works");
if (!/^title:\s*Works\s*$/m.test(fields)) fail("app/app.md title is not Works");
if (!/^version:\s*'0\.1\.0'\s*$/m.test(fields)) fail("app/app.md version is not 0.1.0");

const html = readFileSync(join(root, "design/mockup/index.html"), "utf8");
for (const asset of ["tokens.css", "kit.css", "canvas.css", "canvas.js"]) {
  if (!html.includes(asset)) fail(`design/mockup/index.html does not reference ${asset}`);
}

for (const forbidden of ["preview.simplebuild.site", "/var/www/preview"]) {
  if (html.includes(forbidden)) fail(`design/mockup/index.html contains ${forbidden}`);
}

const syntax = spawnSync(process.execPath, ["--check", join(root, "design/mockup/canvas.js")], {
  stdio: "inherit",
});
if (syntax.status !== 0) fail("design/mockup/canvas.js failed node --check");

console.log("scaffold ok");
