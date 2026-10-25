import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("../.github/scripts/publish.mjs", import.meta.url);
const DIGEST = "sha256:" + "a".repeat(64);

const check = {
  ok: true,
  name: "works",
  title: "Works",
  version: "0.2.2",
  summary: "Docs, decks and sheets with review and export gates.",
  digest: DIGEST,
  listing: {
    tagline: "Docs, decks and sheets with review and export gates",
    category: "operations",
  },
};

function fixture(installCheck) {
  const root = mkdtempSync(join(tmpdir(), "cadence-publish-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "app.md"), "---\napp: works\n---\n");
  writeFileSync(join(root, "check.json"), JSON.stringify(check));
  writeFileSync(join(root, "install-check.json"), JSON.stringify(installCheck));
  return root;
}

function publish(root, extra = {}) {
  return spawnSync(process.execPath, [SCRIPT.pathname], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DRY_RUN: "1",
      APP_CHECK_JSON: join(root, "check.json"),
      APP_INSTALL_CHECK_JSON: join(root, "install-check.json"),
      ...extra,
    },
  });
}

test("publish builds the entry from app check and the manifest listing", () => {
  const root = fixture({ compatibility: { compatible: true }, digest: DIGEST });
  const result = publish(root);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entry.id, "works");
  assert.equal(output.entry.version, "0.2.2");
  assert.equal(output.entry.listing.tagline, check.listing.tagline);
  assert.equal(output.entry.artifact.sha256.length, 64);
});

test("publish refuses an install-check that did not pass", () => {
  const root = fixture({ error: "app-assistant.json: unknown action" });
  const result = publish(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /install-check refused/);
});

test("publish refuses an install-check for different bytes", () => {
  const root = fixture({
    compatibility: { compatible: true },
    digest: "sha256:" + "b".repeat(64),
  });
  const result = publish(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /digest does not match/);
});
