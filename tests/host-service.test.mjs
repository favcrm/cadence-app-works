import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
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

const callChunked = (base, path, body, splitAt) =>
  new Promise((resolve, reject) => {
    const target = new URL(path, base);
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let payload = null;
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = null;
          }
          resolve({ status: response.statusCode, payload });
        });
      },
    );
    request.on("error", reject);
    request.write(body.subarray(0, splitAt));
    setTimeout(() => {
      request.write(body.subarray(splitAt));
      request.end();
    }, 10);
  });

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

    const audit = await call(first.url, "GET", "/api/audit");
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

    const audit = await runCli(["audit"], env);
    assert.equal(audit.status, 0, audit.stderr);
    assert.ok(Array.isArray(JSON.parse(audit.stdout)));
  } finally {
    if (host) await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent mutations all persist across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "works-concurrent-"));
  const dataFile = join(directory, "works.json");
  let host;
  let restarted;

  try {
    host = await createReferenceHost({ dataFile, port: 0 });
    const creates = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        call(host.url, "POST", "/api/works", {
          kind: "doc",
          title: `Concurrent ${index}`,
          content: { blocks: [{ type: "p", text: `Body ${index}` }] },
          tags: [],
          actor: "author-1",
          idempotencyKey: `concurrent-${index}`,
        }),
      ),
    );
    assert.deepEqual(creates.map(({ status }) => status), Array(16).fill(201));
    const ids = creates.map(({ payload }) => payload.id);
    await host.close();
    host = null;

    restarted = await createReferenceHost({ dataFile, port: 0 });
    for (const id of ids) {
      const found = await call(restarted.url, "GET", `/api/works/${id}`);
      assert.equal(found.status, 200, id);
    }
  } finally {
    if (host) await host.close();
    if (restarted) await restarted.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("multibyte JSON split across chunks is preserved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "works-unicode-"));
  const dataFile = join(directory, "works.json");
  let host;

  try {
    host = await createReferenceHost({ dataFile, port: 0 });
    const body = Buffer.from(
      JSON.stringify({
        kind: "doc",
        title: "Café 漢",
        content: { blocks: [{ type: "p", text: "保留评论记录" }] },
        tags: [],
        actor: "author-1",
        idempotencyKey: "unicode-1",
      }),
    );
    const marker = Buffer.from("漢");
    const markerAt = body.indexOf(marker);
    assert.ok(markerAt > 0);

    const response = await callChunked(host.url, "/api/works", body, markerAt + 1);
    assert.equal(response.status, 201);
    assert.equal(response.payload.title, "Café 漢");
    assert.equal(response.payload.blocks[0].text, "保留评论记录");
  } finally {
    if (host) await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("content id audit is not shadowed by the audit route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "works-audit-"));
  const dataFile = join(directory, "works.json");
  let host;

  try {
    host = await createReferenceHost({ dataFile, port: 0 });
    const created = await call(host.url, "POST", "/api/works", {
      kind: "doc",
      title: "Audit",
      content: { blocks: [{ type: "p", text: "Audit content" }] },
      tags: [],
      actor: "author-1",
      idempotencyKey: "audit-content",
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.id, "audit");

    const content = await call(host.url, "GET", "/api/works/audit");
    assert.equal(content.status, 200);
    assert.equal(content.payload.id, "audit");

    const audit = await call(host.url, "GET", "/api/audit");
    assert.equal(audit.status, 200);
    assert.ok(Array.isArray(audit.payload));
    assert.ok(audit.payload.some((event) => event.action === "create"));
  } finally {
    if (host) await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
