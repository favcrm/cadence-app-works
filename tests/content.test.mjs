import test from "node:test";
import assert from "node:assert/strict";

import { contentFixtures } from "../src/content/fixtures.mjs";
import {
  ContentNotFoundError,
  ContentValidationError,
  createContentReader,
} from "../src/content/reader.mjs";

const reader = createContentReader(contentFixtures);

test("lists all fixtures newest first", () => {
  const rows = reader.list();
  assert.equal(rows.length, 10);
  assert.equal(rows[0].id, "q3-planning");
  assert.equal(rows[0].reviewState, "edited");
  assert.equal(rows[0].exportState, "blocked");
  assert.equal(rows[1].id, "q3-notes");
  assert.equal(rows.at(-1).id, "assumptions");
});

test("filters by kind and sorts by name", () => {
  assert.equal(reader.list({ kind: "deck" }).length, 4);
  assert.equal(reader.list({ kind: "doc" }).length, 3);
  assert.equal(reader.list({ kind: "sheet" }).length, 3);
  assert.equal(reader.list({ kind: "all" }).length, 10);
  assert.equal(reader.list({ sort: "name" })[0].id, "assumptions");
});

test("searches title, tags and content case-insensitively", () => {
  const retention = reader.list({ query: "RETENTION" }).map((row) => row.id);
  assert.ok(retention.includes("q3-planning"));
  assert.ok(retention.includes("q3-notes"));

  const budget = reader.list({ query: "budget" }).map((row) => row.id);
  assert.deepEqual(budget, ["q3-budget"]);

  assert.equal(reader.list({ query: "nothing-matches-this" }).length, 0);
});

test("returns summaries without content bodies", () => {
  const deck = reader.list({ kind: "deck" })[0];
  assert.equal(deck.id, "q3-planning");
  assert.equal("slides" in deck, false);
  assert.match(deck.snippet, /slides/);
});

test("edited content is blocked from export", () => {
  const item = reader.get("q3-planning");
  assert.equal(item.kind, "deck");
  assert.equal(item.revision, 5);
  assert.equal(item.reviewedRevision, 4);
  assert.equal(item.reviewState, "edited");
  assert.equal(item.exportState, "blocked");
  assert.match(item.exportReason, /current revision/);
  assert.equal(item.slides.length, 6);
  assert.equal(item.changes.length, 2);
});

test("reviewed content is export ready", () => {
  const item = reader.get("customer-review");
  assert.equal(item.revision, 2);
  assert.equal(item.reviewedRevision, 2);
  assert.equal(item.reviewState, "reviewed");
  assert.equal(item.exportState, "ready");
  assert.match(item.exportReason, /ready/);
});

test("draft content is blocked until a first review", () => {
  const item = reader.get("launch-readout");
  assert.equal(item.reviewedRevision, 0);
  assert.equal(item.reviewState, "draft");
  assert.equal(item.exportState, "blocked");
  assert.match(item.exportReason, /first review/);
});

test("unknown content id is a typed not-found error", () => {
  assert.throws(() => reader.get("not-a-document"), ContentNotFoundError);
});

test("reader returns defensive copies and exposes only reads", () => {
  const summary = reader.list({ kind: "deck" })[0];
  summary.title = "mutated";
  summary.tags.push("mutated");

  const freshSummary = reader.list({ kind: "deck" })[0];
  assert.equal(freshSummary.title, "Q3 planning");
  assert.deepEqual(freshSummary.tags, ["q3", "planning"]);

  const detail = reader.get("q3-planning");
  detail.title = "mutated";
  detail.slides[0].title = "mutated";
  detail.slides.push({ title: "extra", body: "extra" });

  const freshDetail = reader.get("q3-planning");
  assert.equal(freshDetail.title, "Q3 planning");
  assert.equal(freshDetail.slides[0].title, "What we ship, what we cut.");
  assert.equal(freshDetail.slides.length, 6);

  assert.deepEqual(Object.keys(reader).sort(), ["get", "list"]);
});

test("rejects malformed and duplicate fixtures", () => {
  assert.throws(
    () => createContentReader([{ ...contentFixtures[0], id: "Not A Slug" }]),
    ContentValidationError,
  );
  assert.throws(
    () => createContentReader([contentFixtures[0], contentFixtures[0]]),
    ContentValidationError,
  );
});
