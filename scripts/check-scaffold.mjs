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
  "src/content/fixtures.mjs",
  "src/content/reader.mjs",
  "src/contract/host.mjs",
  "src/host/server.mjs",
  "src/host/client.mjs",
  "scripts/works.mjs",
  "src/screens/works.mjs",
  "src/screens/works-write.mjs",
  "src/screens/works.css",
  "dev/index.html",
  "dev/dev.mjs",
  "dev/write.html",
  "dev/write.mjs",
  "dev/write.css",
  "tests/content.test.mjs",
  "tests/host-contract.test.mjs",
  "tests/host-service.test.mjs",
  "docs/content-model.md",
  "docs/host-contract.md",
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

for (const relative of ["design/mockup/index.html", "dev/index.html", "dev/write.html"]) {
  const html = readFileSync(join(root, relative), "utf8");
  for (const asset of ["tokens.css", "kit.css", "canvas.css", "canvas.js"]) {
    if (relative.startsWith("design/") && !html.includes(asset)) {
      fail(`${relative} does not reference ${asset}`);
    }
  }
  for (const forbidden of ["preview.simplebuild.site", "/var/www/preview"]) {
    if (html.includes(forbidden)) fail(`${relative} contains ${forbidden}`);
  }
}

for (const relative of [
  "src/content/reader.mjs",
  "src/content/fixtures.mjs",
  "src/contract/host.mjs",
  "src/screens/works.mjs",
  "dev/dev.mjs",
]) {
  const source = readFileSync(join(root, relative), "utf8");
  if (/\bfetch\s*\(|XMLHttpRequest/.test(source)) fail(`${relative} makes a network call`);
}

for (const relative of ["src/screens/works.mjs", "dev/dev.mjs"]) {
  const source = readFileSync(join(root, relative), "utf8");
  if (/contract\/host|host\/client|host\/server/.test(source)) {
    fail(`${relative} imports a host`);
  }
}

for (const relative of [
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
]) {
  const syntax = spawnSync(process.execPath, ["--check", join(root, relative)], {
    stdio: "inherit",
  });
  if (syntax.status !== 0) fail(`${relative} failed node --check`);
}

console.log("scaffold ok");