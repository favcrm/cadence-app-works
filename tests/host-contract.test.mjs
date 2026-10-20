import { readFileSync } from "node:fs";

import test from "node:test";
import assert from "node:assert/strict";

import { createFixtureHost, HostError } from "../src/contract/host.mjs";

const expectError = (fn, code) => {
  assert.throws(fn, (error) => error instanceof HostError && error.code === code);
};

const newDoc = {
  blocks: [
    { type: "h2", text: "Retention addendum" },
    { type: "p", text: "Keep the review trail visible in the export." },
  ],
};

test("creates a draft with a host id and no export path", () => {
  const host = createFixtureHost();
  const created = host.create({
    kind: "doc",
    title: "Retention addendum",
    content: newDoc,
    tags: ["q3"],
    actor: "author-1",
    idempotencyKey: "create-retention",
  });

  assert.equal(created.id, "retention-addendum");
  assert.equal(created.revision, 1);
  assert.equal(created.reviewedRevision, 0);
  assert.equal(created.reviewState, "draft");
  assert.equal(created.reviewStatus, "none");
  assert.equal(created.exportState, "blocked");
  assert.equal(created.author, "author-1");

  assert.equal(host.get({ id: created.id }).title, "Retention addendum");
  assert.ok(host.query({ text: "retention" }).some((row) => row.id === created.id));
  expectError(() => host.export({ id: created.id, revision: 1 }), "needs_review");
});

test("idempotent create replays the original result and rejects a different payload", () => {
  const host = createFixtureHost();
  const input = {
    kind: "doc",
    title: "Retention addendum",
    content: newDoc,
    tags: [],
    actor: "author-1",
    idempotencyKey: "create-1",
  };

  const first = host.create(input);
  const second = host.create(input);
  assert.equal(second.id, first.id);
  assert.equal(host.query({}).length, 11);

  expectError(
    () => host.create({ ...input, title: "Different title" }),
    "conflict",
  );
});

test("patch creates a new revision and leaves review/export blocked", () => {
  const host = createFixtureHost();
  const patched = host.patch({
    id: "q3-planning",
    ifRevision: 5,
    operations: [{ type: "set_title", title: "Q3 planning v2" }],
    actor: "mira",
    idempotencyKey: "patch-title",
  });

  assert.equal(patched.revision, 6);
  assert.equal(patched.reviewedRevision, 4);
  assert.equal(patched.reviewState, "edited");
  assert.equal(patched.reviewStatus, "none");
  assert.equal(patched.exportState, "blocked");
  assert.equal(patched.author, "mira");

  const replay = host.patch({
    id: "q3-planning",
    ifRevision: 5,
    operations: [{ type: "set_title", title: "Q3 planning v2" }],
    actor: "mira",
    idempotencyKey: "patch-title",
  });
  assert.equal(replay.revision, 6);

  expectError(
    () =>
      host.patch({
        id: "q3-planning",
        ifRevision: 5,
        operations: [{ type: "set_title", title: "Uneven replay" }],
        actor: "mira",
        idempotencyKey: "patch-title",
      }),
    "conflict",
  );
});

test("stale CAS refuses patch and trash without changing content", () => {
  const host = createFixtureHost();
  expectError(
    () =>
      host.patch({
        id: "q3-planning",
        ifRevision: 4,
        operations: [{ type: "set_title", title: "Stale" }],
        actor: "you",
        idempotencyKey: "stale-patch",
      }),
    "conflict",
  );
  expectError(
    () =>
      host.trash({
        id: "q3-planning",
        ifRevision: 4,
        actor: "you",
        idempotencyKey: "stale-trash",
      }),
    "conflict",
  );

  const item = host.get({ id: "q3-planning" });
  assert.equal(item.title, "Q3 planning");
  assert.equal(item.revision, 5);
});

test("author cannot approve their own revision; an independent reviewer can", () => {
  const host = createFixtureHost();
  const pending = host.request_review({ id: "q3-planning", revision: 5, actor: "you" });
  assert.equal(pending.reviewStatus, "pending");
  assert.equal(pending.exportState, "blocked");

  expectError(
    () => host.review({ id: "q3-planning", revision: 5, decision: "approve", actor: "you" }),
    "forbidden",
  );

  const approved = host.review({
    id: "q3-planning",
    revision: 5,
    decision: "approve",
    actor: "mira",
    note: "Reviewed against Q2.",
  });
  assert.equal(approved.reviewedRevision, 5);
  assert.equal(approved.reviewStatus, "approved");
  assert.equal(approved.reviewState, "reviewed");
  assert.equal(approved.exportState, "ready");

  const receipt = host.export({ id: "q3-planning", revision: 5, format: "pdf", actor: "mira" });
  assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/);

  const edited = host.patch({
    id: "q3-planning",
    ifRevision: 5,
    operations: [{ type: "set_title", title: "Q3 planning after approval" }],
    actor: "you",
    idempotencyKey: "post-approval-edit",
  });
  assert.equal(edited.revision, 6);
  assert.equal(edited.exportState, "blocked");
  expectError(() => host.export({ id: "q3-planning", revision: 6 }), "needs_review");
  expectError(() => host.export({ id: "q3-planning", revision: 5 }), "needs_review");
});

test("changes requested keeps the revision unapproved", () => {
  const host = createFixtureHost();
  host.request_review({ id: "q3-notes", revision: 3, actor: "you" });
  const reviewed = host.review({
    id: "q3-notes",
    revision: 3,
    decision: "changes",
    actor: "mira",
    note: "Cite the chart label.",
  });

  assert.equal(reviewed.reviewStatus, "changes_requested");
  assert.equal(reviewed.reviewedRevision, 2);
  assert.equal(reviewed.exportState, "blocked");
  expectError(() => host.export({ id: "q3-notes", revision: 3 }), "needs_review");
});

test("pending review is queryable and does not approve export", () => {
  const host = createFixtureHost();
  host.request_review({ id: "q3-planning", revision: 5, actor: "you" });

  const pending = host.query({ review: "pending" });
  assert.deepEqual(pending.map((row) => row.id), ["q3-planning"]);
  assert.equal(pending[0].exportState, "blocked");

  const ready = host.query({ export: "ready" }).map((row) => row.id);
  assert.ok(!ready.includes("q3-planning"));
  assert.ok(ready.includes("customer-review"));
});

test("query filters kind, text, tags, owner and export state", () => {
  const host = createFixtureHost();
  assert.equal(host.query({ kind: "deck" }).length, 4);
  assert.equal(host.query({ tag: "q3" }).length, 4);
  assert.deepEqual(
    host.query({ owner: "Jon" }).map((row) => row.id).sort(),
    ["decision-log", "q3-budget"],
  );
  assert.ok(host.query({ text: "retention" }).some((row) => row.id === "q3-planning"));
  assert.ok(host.query({ text: "retention" }).some((row) => row.id === "q3-notes"));
  assert.equal(host.query({ export: "ready" }).every((row) => row.exportState === "ready"), true);
});

test("soft delete hides content and restore brings it back", () => {
  const host = createFixtureHost();
  const trashed = host.trash({
    id: "launch-readout",
    ifRevision: 1,
    actor: "you",
    idempotencyKey: "trash-launch",
  });
  assert.equal(trashed.deleted, true);

  expectError(() => host.get({ id: "launch-readout" }), "not_found");
  assert.ok(!host.query({}).some((row) => row.id === "launch-readout"));

  const restored = host.restore({
    id: "launch-readout",
    ifRevision: 1,
    actor: "you",
    idempotencyKey: "restore-launch",
  });
  assert.equal(restored.id, "launch-readout");
  assert.equal(host.get({ id: "launch-readout" }).reviewState, "draft");
  assert.ok(host.query({}).some((row) => row.id === "launch-readout"));
});

test("review and export reject stale revisions", () => {
  const host = createFixtureHost();
  host.request_review({ id: "q3-planning", revision: 5, actor: "you" });
  expectError(
    () => host.review({ id: "q3-planning", revision: 4, decision: "approve", actor: "mira" }),
    "conflict",
  );
  expectError(
    () => host.export({ id: "q3-planning", revision: 4 }),
    "needs_review",
  );
});

test("audit records mutations and export identity", () => {
  const host = createFixtureHost();
  host.create({
    kind: "doc",
    title: "Audit note",
    content: newDoc,
    actor: "author-1",
    idempotencyKey: "audit-create",
  });
  host.request_review({ id: "q3-planning", revision: 5, actor: "you" });
  host.review({ id: "q3-planning", revision: 5, decision: "approve", actor: "mira" });
  host.export({ id: "q3-planning", revision: 5, actor: "mira" });
  host.trash({
    id: "launch-readout",
    ifRevision: 1,
    actor: "you",
    idempotencyKey: "audit-trash",
  });

  const audit = host.audit();
  assert.ok(audit.some((event) => event.action === "create" && event.actor === "author-1"));
  assert.ok(audit.some((event) => event.action === "review_approve" && event.actor === "mira"));
  assert.ok(audit.some((event) => event.action === "export" && event.id === "q3-planning"));
  assert.ok(audit.some((event) => event.action === "trash" && event.id === "launch-readout"));
});

test("the fixture host is not wired into the read-only app", () => {
  const screen = readFileSync(new URL("../src/screens/works.mjs", import.meta.url), "utf8");
  const dev = readFileSync(new URL("../dev/dev.mjs", import.meta.url), "utf8");
  assert.ok(!screen.includes("contract/host"));
  assert.ok(!dev.includes("contract/host"));
});
