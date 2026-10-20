import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import test from "node:test";
import assert from "node:assert/strict";

import { createReferenceHost } from "../src/host/server.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const runCli = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/works.mjs", ...args], { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

const call = async (base, method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
};

test("reference host serves the contract and persists across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "works-host-"));
  const dataFile = join(directory, "works.json");
  let first;
  let second;

  try {
    first = await createReferenceHost({ dataFile, port: 0 });
    assert.equal((await call(first.url, "GET", "/health")).status, 200);

    const decks = await call(first.url, "GET", "/api/works?kind=deck");
    assert.equal(decks.status, 200);
    assert.equal(decks.payload.length, 4);

    const seeded = await call(first.url, "GET", "/api/works/q3-planning");
    assert.equal(seeded.status, 200);
    assert.equal(seeded.payload.title, "Q3 planning");

    const created = await call(first.url, "POST", "/api/works", {
      kind: "doc",
      title: "Retention addendum",
      content: {
        blocks: [
          { type: "h2", text: "Retention addendum" },
          { type: "p", text: "Keep the review trail visible." },
        ],
      },
      tags: [],
      actor: "author-1",
      idempotencyKey: "create-1",
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.id, "retention-addendum");
    assert.equal(created.payload.revision, 1);
    assert.equal(created.payload.exportState, "blocked");

    const id = created.payload.id;
    const patched = await call(first.url, "PATCH", `/api/works/${id}`, {
      ifRevision: 1,
      operations: [{ type: "set_title", title: "Retention addendum v2" }],
      actor: "author-1",
      idempotencyKey: "patch-1",
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.payload.revision, 2);

    const stale = await call(first.url, "PATCH", `/api/works/${id}`, {
      ifRevision: 1,
      operations: [{ type: "set_title", title: "Stale" }],
      actor: "author-1",
      idempotencyKey: "stale-patch",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.error, "conflict");

    const requested = await call(first.url, "POST", `/api/works/${id}/request-review`, {
      revision: 2,
      actor: "author-1",
    });
    assert.equal(requested.status, 200);
    assert.equal(requested.payload.reviewStatus, "pending");

    const self = await call(first.url, "POST", `/api/works/${id}/review`, {
      revision: 2,
      decision: "approve",
      actor: "author-1",
    });
    assert.equal(self.status, 403);
    assert.equal(self.payload.error, "forbidden");

    const approved = await call(first.url, "POST", `/api/works/${id}/review`, {
      revision: 2,
      decision: "approve",
      actor: "reviewer-1",
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.exportState, "ready");

    const receipt = await call(first.url, "POST", `/api/works/${id}/export`, {
      revision: 2,
      format: "pdf",
      actor: "reviewer-1",
    });
    assert.equal(receipt.status, 200);
    assert.match(receipt.payload.digest, /^sha256:[a-f0-9]{64}$/);

    const trashed = await call(first.url, "DELETE", `/api/works/${id}`, {
      ifRevision: 2,
      actor: "author-1",
      idempotencyKey: "trash-1",
    });
    assert.equal(trashed.status, 200);
    assert.equal((await call(first.url, "GET", `/api/works/${id}`)).status, 404);

    const restored = await call(first.url, "POST", `/api/works/${id}/restore`, {
      ifRevision: 2,
      actor: "author-1",
      idempotencyKey: "restore-1",
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.payload.id, id);

    const audit = await call(first.url, "GET", "/api/works/audit");
    assert.ok(audit.payload.some((event) => event.action === "review_approve"));
    assert.ok(audit.payload.some((event) => event.action === "export"));

    await first.close();
    first = null;

    second = await createReferenceHost({ dataFile, port: 0 });
    const persisted = await call(second.url, "GET", `/api/works/${id}`);
    assert.equal(persisted.status, 200);
    assert.equal(persisted.payload.title, "Retention addendum v2");
    assert.equal(persisted.payload.revision, 2);
    assert.equal(persisted.payload.exportState, "ready");
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("works CLI reads the reference host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "works-cli-"));
  const dataFile = join(directory, "works.json");
  let host;

  try {
    host = await createReferenceHost({ dataFile, port: 0 });
    const env = { ...process.env, WORKS_HOST: host.url };

    const list = await runCli(["list", "--kind", "deck"], env);
    assert.equal(list.status, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).length, 4);

    const show = await runCli(["show", "q3-planning"], env);
    assert.equal(show.status, 0, show.stderr);
    assert.equal(JSON.parse(show.stdout).title, "Q3 planning");
  } finally {
    if (host) await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
