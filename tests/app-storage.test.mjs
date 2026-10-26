import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  APP_STORAGE_LIMITS,
  validateAppStoragePackage,
  validateWorksStorage,
} from "../scripts/app-storage.mjs";

const bundle = new URL("../app/", import.meta.url).pathname;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "works-storage-"));
  cpSync(bundle, root, { recursive: true });
  return root;
}

function rewriteMigration(root, mutate) {
  const path = join(root, "storage/001-documents.json");
  const migration = readJson(path);
  mutate(migration);
  writeJson(path, migration);
  const descriptorPath = join(root, "app-storage.json");
  const descriptor = readJson(descriptorPath);
  descriptor.migrations[0].sha256 = sha256(readFileSync(path));
  writeJson(descriptorPath, descriptor);
}

function rewriteDescriptor(root, mutate) {
  const path = join(root, "app-storage.json");
  const descriptor = readJson(path);
  mutate(descriptor);
  writeJson(path, descriptor);
}

test("the shipped package passes package integrity and the Works model", () => {
  const model = validateAppStoragePackage(bundle);
  assert.deepEqual(model.errors, []);
  assert.deepEqual(validateWorksStorage(model), []);
});

test("the manifest requires app-storage and keeps the nine works operations", () => {
  const manifest = readFileSync(join(bundle, "app.md"), "utf8");
  assert.match(manifest, /app-storage: \[1\]/);
  const screens = readJson(join(bundle, "screens/works/screens.json"));
  assert.deepEqual([...screens.operations].sort(), [
    "works.create",
    "works.export",
    "works.get",
    "works.patch",
    "works.query",
    "works.request_review",
    "works.restore",
    "works.review",
    "works.trash",
  ]);
  assert.equal(screens.operations.some((operation) => operation.startsWith("records.")), false);
});

test("the descriptor holds only the Works content record kind and table", () => {
  const descriptor = readJson(join(bundle, "app-storage.json"));
  assert.equal(descriptor.contract, "app-storage/v1");
  assert.equal(descriptor.app, "works");
  assert.equal(descriptor.record_kind, "document");
  assert.equal(descriptor.default_table, "documents");
  assert.equal(descriptor.record_write_schema, false);
  assert.deepEqual(descriptor.record_search_columns, ["title", "tags"]);
});

test("a migration whose bytes differ from its declared digest is refused", () => {
  const root = fixture();
  try {
    const path = join(root, "storage/001-documents.json");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    const model = validateAppStoragePackage(root);
    assert.ok(model.errors.some((error) => /sha256 does not match/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or undeclared storage member is refused", () => {
  const missing = fixture();
  try {
    rmSync(join(missing, "storage/001-documents.json"));
    assert.ok(
      validateAppStoragePackage(missing).errors.some((error) => /missing from the bundle/.test(error)),
    );
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  const extra = fixture();
  try {
    writeFileSync(join(extra, "storage/002-not-declared.json"), "{}\n");
    assert.ok(
      validateAppStoragePackage(extra).errors.some((error) => /not a declared migration/.test(error)),
    );
  } finally {
    rmSync(extra, { recursive: true, force: true });
  }
});

test("migrations must be contiguous from 1 through schema_version", () => {
  const root = fixture();
  try {
    rewriteDescriptor(root, (descriptor) => {
      descriptor.schema_version = 2;
    });
    const model = validateAppStoragePackage(root);
    assert.ok(
      model.errors.some((error) =>
        /must list every version 1\.\.schema_version/.test(error),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("host identity, revision and review/export columns cannot be declared", () => {
  const root = fixture();
  try {
    rewriteMigration(root, (migration) => {
      migration.operations[0].columns.push({
        name: "reviewed_revision",
        type: "integer",
        nullable: false,
        default: 0,
      });
      migration.operations[0].columns.push({ name: "owner", type: "text", nullable: false });
      migration.operations[0].columns.push({ name: "revision", type: "integer", nullable: false });
    });
    const model = validateAppStoragePackage(root);
    assert.ok(model.errors.some((error) => /host review\/export authority/.test(error)));
    assert.ok(model.errors.some((error) => /host-reserved/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an additive column must be nullable or carry a default", () => {
  const root = fixture();
  try {
    rewriteMigration(root, (migration) => {
      migration.operations.push({
        op: "add_column",
        table: "documents",
        column: { name: "subtitle", type: "text", nullable: false },
      });
    });
    assert.ok(
      validateAppStoragePackage(root).errors.some((error) =>
        /non-null column without a default/.test(error),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an index or backfill cannot name an undeclared column", () => {
  const root = fixture();
  try {
    rewriteMigration(root, (migration) => {
      migration.operations.push({
        op: "create_index",
        table: "documents",
        name: "documents_missing",
        columns: ["missing"],
        unique: false,
      });
      migration.operations.push({
        op: "backfill",
        table: "documents",
        column: "missing",
        value: 1,
        only_null: true,
      });
    });
    const errors = validateAppStoragePackage(root).errors;
    assert.ok(errors.some((error) => /indexes an undeclared column/.test(error)));
    assert.ok(errors.some((error) => /not a declared column/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Works model pins the content columns, limits and single index", () => {
  const root = fixture();
  try {
    rewriteMigration(root, (migration) => {
      const table = migration.operations[0];
      table.columns = table.columns.filter((column) => column.name !== "slides");
      const kind = table.columns.find((column) => column.name === "kind");
      kind.enum = ["doc", "sheet"];
      const title = table.columns.find((column) => column.name === "title");
      title.max_length = 400;
      table.columns.push({ name: "owner", type: "text", nullable: false, default: "host" });
    });
    const model = validateAppStoragePackage(root);
    const errors = validateWorksStorage(model);
    assert.ok(errors.some((error) => /documents\.slides/.test(error)));
    assert.ok(errors.some((error) => /documents\.kind/.test(error)));
    assert.ok(errors.some((error) => /documents\.title/.test(error)));
    assert.ok(errors.some((error) => /unexpected column "owner"/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Works model refuses authority in the descriptor and other tables", () => {
  const root = fixture();
  try {
    rewriteDescriptor(root, (descriptor) => {
      descriptor.record_write_schema = true;
      descriptor.record_search_columns = ["title", "reviewed_revision"];
    });
    rewriteMigration(root, (migration) => {
      migration.operations.push({
        op: "create_table",
        table: "reviews",
        columns: [{ name: "state", type: "text", nullable: false }],
      });
    });
    const model = validateAppStoragePackage(root);
    const errors = [...model.errors, ...validateWorksStorage(model)];
    assert.ok(errors.some((error) => /record_write_schema must refuse/.test(error)));
    assert.ok(errors.some((error) => /record_search_columns names undeclared/.test(error)));
    assert.ok(errors.some((error) => /non-content table "reviews"/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the declared content bounds mirror the native Works limits", () => {
  assert.equal(APP_STORAGE_LIMITS.titleCharacters, 240);
  assert.equal(APP_STORAGE_LIMITS.tags, 20);
  assert.equal(APP_STORAGE_LIMITS.tagCharacters, 60);
  assert.equal(APP_STORAGE_LIMITS.recordBytes, 262144);
  const migration = readJson(join(bundle, "storage/001-documents.json"));
  const table = migration.operations[0];
  assert.equal(table.record_bytes, APP_STORAGE_LIMITS.recordBytes);
  const tags = table.columns.find((column) => column.name === "tags");
  assert.equal(tags.json_schema.maxItems, APP_STORAGE_LIMITS.tags);
  assert.equal(tags.json_schema.items.maxLength, APP_STORAGE_LIMITS.tagCharacters);
});
