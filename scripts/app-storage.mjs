import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Offline validation for a package-owned `app-storage/v1` descriptor and its
// flat `storage/<tag>.json` migrations. The host's app-storage validator owns
// keyword admission and execution; this check proves member shape, raw-byte
// integrity, the migration plan and the Works content boundary before a bundle
// is built or published.

export const APP_STORAGE_LIMITS = {
  descriptorBytes: 32 * 1024,
  migrationBytes: 64 * 1024,
  migrationTotalBytes: 256 * 1024,
  migrations: 128,
  tables: 64,
  columns: 64,
  indexes: 32,
  migrationOperations: 128,
  operations: 512,
  defaultTableBytes: 262144,
  recordBytes: 262144,
  jsonSchemaBytes: 8 * 1024,
  enumValues: 128,
  tags: 20,
  tagCharacters: 60,
  titleCharacters: 240,
};

export const APP_STORAGE_BASE_COLUMNS = ["id", "context_id", "revision", "created_at", "updated_at"];

// Host authority. None of these may be declared as app-owned columns: review,
// approval, export, identity and immutable-history state stay with the host.
export const APP_STORAGE_AUTHORITY_COLUMNS = [
  "owner",
  "author",
  "reviewed_by",
  "approved_by",
  "reviewed_revision",
  "review_status",
  "review_requested_revision",
  "pending_revision",
  "trashed",
  "deleted",
  "export_state",
  "export_digest",
  "export_receipt",
  "content_digest",
  "payload_digest",
];

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const APP = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RECORD_KIND = /^[a-z][a-z0-9_-]{0,31}$/;
const MIGRATION_PATH = /^storage\/[a-z0-9][a-z0-9-]{0,31}\.json$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORMATS = new Set(["email", "phone", "tag"]);
const COLUMN_TYPES = new Set(["text", "integer", "real", "boolean", "json"]);
const DESCRIPTOR_KEYS = new Set([
  "contract",
  "app",
  "record_kind",
  "schema_version",
  "compatible_schema_versions",
  "default_table",
  "record_write_schema",
  "record_search_columns",
  "migrations",
]);
const COLUMN_KEYS = new Set([
  "name",
  "type",
  "nullable",
  "default",
  "max_length",
  "enum",
  "format",
  "json_schema",
]);
const MIGRATION_KEYS = new Set(["version", "operations"]);
const OPERATION_KEYS = {
  create_table: new Set(["op", "table", "columns", "record_bytes"]),
  add_column: new Set(["op", "table", "column"]),
  create_index: new Set(["op", "table", "name", "columns", "unique"]),
  backfill: new Set(["op", "table", "column", "value", "only_null"]),
};

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isScalar = (value) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function codePointLength(value) {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

function unknownKeys(value, allowed, where, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${where} has unsupported key "${key}"`);
  }
}

function scalarMatches(column, value) {
  if (value === null) return column.nullable === true;
  switch (column.type) {
    case "text":
      if (typeof value !== "string") return false;
      if (column.max_length !== undefined && codePointLength(value) > column.max_length) return false;
      return true;
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "real":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "json":
      return isScalar(value) || typeof value === "object";
    default:
      return false;
  }
}

function validateColumn(column, where, errors) {
  if (!isRecord(column)) {
    errors.push(`${where} must be an object`);
    return null;
  }
  unknownKeys(column, COLUMN_KEYS, where, errors);
  if (typeof column.name !== "string" || !IDENTIFIER.test(column.name)) {
    errors.push(`${where}.name is not a bounded lowercase identifier`);
    return null;
  }
  if (APP_STORAGE_BASE_COLUMNS.includes(column.name)) {
    errors.push(`${where}.name "${column.name}" is host-reserved`);
  }
  if (APP_STORAGE_AUTHORITY_COLUMNS.includes(column.name)) {
    errors.push(`${where}.name "${column.name}" is host review/export authority`);
  }
  if (!COLUMN_TYPES.has(column.type)) {
    errors.push(`${where}.type is not a supported column type`);
    return null;
  }
  if (typeof column.nullable !== "boolean") errors.push(`${where}.nullable must be a boolean`);
  if (column.max_length !== undefined) {
    if (column.type !== "text") errors.push(`${where}.max_length requires a text column`);
    if (
      !Number.isInteger(column.max_length) ||
      column.max_length < 1 ||
      column.max_length > APP_STORAGE_LIMITS.recordBytes
    ) {
      errors.push(`${where}.max_length is outside its bound`);
    }
  }
  if (column.format !== undefined) {
    if (column.type !== "text") errors.push(`${where}.format requires a text column`);
    if (!FORMATS.has(column.format)) errors.push(`${where}.format is unsupported`);
  }
  if (column.enum !== undefined) {
    if (column.type === "json") errors.push(`${where}.enum requires a scalar column`);
    if (!Array.isArray(column.enum) || column.enum.length === 0) {
      errors.push(`${where}.enum must be a non-empty array`);
    } else if (column.enum.length > APP_STORAGE_LIMITS.enumValues) {
      errors.push(`${where}.enum exceeds its value bound`);
    } else if (column.enum.some((value) => !isScalar(value))) {
      errors.push(`${where}.enum values must be JSON scalars`);
    } else if (column.enum.some((value) => !scalarMatches(column, value))) {
      errors.push(`${where}.enum values must match the column type`);
    }
  }
  if (column.json_schema !== undefined) {
    if (typeof column.json_schema !== "boolean" && !isRecord(column.json_schema)) {
      errors.push(`${where}.json_schema must be a JSON Schema object or boolean`);
    } else if (byteLength(column.json_schema) > APP_STORAGE_LIMITS.jsonSchemaBytes) {
      errors.push(`${where}.json_schema exceeds its byte bound`);
    }
  }
  if (Object.hasOwn(column, "default")) {
    if (!scalarMatches(column, column.default)) {
      errors.push(`${where}.default does not satisfy the column type`);
    }
    if (column.enum !== undefined && !column.enum.some((value) => Object.is(value, column.default))) {
      errors.push(`${where}.default is not one of the enum values`);
    }
  }
  return { ...column };
}

function readStorageMembers(bundleDir) {
  const storageDir = join(bundleDir, "storage");
  if (!existsSync(storageDir)) return [];
  let members = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else members.push(relative(bundleDir, full).split(sep).join("/"));
    }
  };
  walk(storageDir);
  return members;
}

/**
 * Read and check the package-owned storage members from one bundle directory
 * (`app/`). Never throws for a bad package; returns the accumulated errors.
 */
export function validateAppStoragePackage(bundleDir) {
  const errors = [];
  const result = { errors, descriptor: null, migrations: [], tables: [] };
  const descriptorPath = join(bundleDir, "app-storage.json");
  if (!existsSync(descriptorPath)) {
    errors.push("app-storage.json is missing");
    return result;
  }
  const descriptorBytes = statSync(descriptorPath).size;
  if (descriptorBytes > APP_STORAGE_LIMITS.descriptorBytes) {
    errors.push("app-storage.json exceeds its byte bound");
  }
  let descriptor;
  try {
    descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  } catch {
    errors.push("app-storage.json is not valid JSON");
    return result;
  }
  if (!isRecord(descriptor)) {
    errors.push("app-storage.json must be an object");
    return result;
  }
  result.descriptor = descriptor;
  unknownKeys(descriptor, DESCRIPTOR_KEYS, "app-storage.json", errors);
  if (descriptor.contract !== "app-storage/v1") {
    errors.push("app-storage contract is not app-storage/v1");
  }
  if (typeof descriptor.app !== "string" || !APP.test(descriptor.app)) {
    errors.push("app-storage app is not a bounded app identity");
  }
  if (typeof descriptor.record_kind !== "string" || !RECORD_KIND.test(descriptor.record_kind)) {
    errors.push("app-storage record_kind is not a bounded record kind");
  }
  const schemaVersion = descriptor.schema_version;
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > APP_STORAGE_LIMITS.migrations
  ) {
    errors.push("app-storage schema_version is outside its bound");
  }
  const compatible = descriptor.compatible_schema_versions;
  if (!Array.isArray(compatible) || compatible.length === 0) {
    errors.push("app-storage compatible_schema_versions must be a non-empty array");
  } else {
    if (compatible.length > APP_STORAGE_LIMITS.migrations) {
      errors.push("app-storage compatible_schema_versions exceeds its bound");
    }
    if (
      compatible.some(
        (version) =>
          !Number.isInteger(version) || version < 1 || version > APP_STORAGE_LIMITS.migrations,
      )
    ) {
      errors.push("app-storage compatible_schema_versions contains an invalid version");
    }
    if (new Set(compatible).size !== compatible.length) {
      errors.push("app-storage compatible_schema_versions repeats a version");
    }
    if (!compatible.includes(schemaVersion)) {
      errors.push("app-storage compatible_schema_versions does not include schema_version");
    }
  }
  if (descriptor.default_table !== null && typeof descriptor.default_table !== "string") {
    errors.push("app-storage default_table must be a logical table name or null");
  }
  if (descriptor.record_write_schema !== undefined) {
    if (
      typeof descriptor.record_write_schema !== "boolean" &&
      !isRecord(descriptor.record_write_schema)
    ) {
      errors.push("app-storage record_write_schema must be a bounded JSON Schema or boolean");
    } else if (byteLength(descriptor.record_write_schema) > APP_STORAGE_LIMITS.jsonSchemaBytes) {
      errors.push("app-storage record_write_schema exceeds its byte bound");
    }
  }
  if (descriptor.record_search_columns !== undefined) {
    const columns = descriptor.record_search_columns;
    if (!Array.isArray(columns) || columns.length === 0) {
      errors.push("app-storage record_search_columns must be a non-empty array");
    } else {
      if (columns.length > APP_STORAGE_LIMITS.columns) {
        errors.push("app-storage record_search_columns exceeds its bound");
      }
      if (
        columns.some((name) => typeof name !== "string" || !IDENTIFIER.test(name)) ||
        new Set(columns).size !== columns.length
      ) {
        errors.push("app-storage record_search_columns must be distinct identifiers");
      }
    }
  }

  const migrations = descriptor.migrations;
  if (!Array.isArray(migrations) || migrations.length === 0) {
    errors.push("app-storage migrations must be a non-empty array");
    return result;
  }
  if (migrations.length !== schemaVersion) {
    errors.push("app-storage migrations must list every version 1..schema_version");
  }
  if (migrations.length > APP_STORAGE_LIMITS.migrations) {
    errors.push("app-storage migrations exceeds its bound");
  }
  const declaredPaths = new Set();
  let totalBytes = 0;
  migrations.forEach((entry, index) => {
    const where = `app-storage migrations[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    unknownKeys(entry, new Set(["version", "path", "sha256"]), where, errors);
    if (entry.version !== index + 1) {
      errors.push(`${where}.version must be ${index + 1}`);
    }
    if (typeof entry.path !== "string" || !MIGRATION_PATH.test(entry.path)) {
      errors.push(`${where}.path is not a flat storage/<tag>.json path`);
      return;
    }
    if (declaredPaths.has(entry.path)) {
      errors.push(`${where}.path repeats "${entry.path}"`);
      return;
    }
    declaredPaths.add(entry.path);
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      errors.push(`${where}.sha256 is not "sha256:<64 lowercase hex>"`);
    }
    const full = join(bundleDir, entry.path);
    const rel = relative(bundleDir, full).split(sep).join("/");
    if (rel !== entry.path) {
      errors.push(`${where}.path escapes the bundle`);
      return;
    }
    if (!existsSync(full)) {
      errors.push(`${where}.path is missing from the bundle`);
      return;
    }
    const bytes = readFileSync(full);
    const size = bytes.length;
    totalBytes += size;
    if (size > APP_STORAGE_LIMITS.migrationBytes) {
      errors.push(`${entry.path} exceeds its byte bound`);
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (entry.sha256 !== digest) {
      errors.push(`${entry.path} sha256 does not match its bytes`);
    }
    let migration;
    try {
      migration = JSON.parse(bytes.toString("utf8"));
    } catch {
      errors.push(`${entry.path} is not valid JSON`);
      return;
    }
    result.migrations.push({ entry, migration, path: entry.path });
  });
  if (totalBytes > APP_STORAGE_LIMITS.migrationTotalBytes) {
    errors.push("app-storage migrations exceed their total byte bound");
  }
  for (const member of readStorageMembers(bundleDir)) {
    if (!declaredPaths.has(member)) {
      errors.push(`storage/${member.replace(/^storage\//, "")} is not a declared migration`);
    }
  }

  // Replay the contiguous plan into one accumulated logical model.
  const tables = new Map();
  let operationCount = 0;
  for (const [index, record] of result.migrations.entries()) {
    const where = `app-storage migrations[${index}] (${record.path})`;
    const migration = record.migration;
    if (!isRecord(migration)) {
      errors.push(`${record.path} must be an object`);
      continue;
    }
    unknownKeys(migration, MIGRATION_KEYS, record.path, errors);
    if (migration.version !== index + 1) {
      errors.push(`${record.path} version must be ${index + 1}`);
    }
    if (!Array.isArray(migration.operations) || migration.operations.length === 0) {
      errors.push(`${record.path} operations must be a non-empty array`);
      continue;
    }
    if (migration.operations.length > APP_STORAGE_LIMITS.migrationOperations) {
      errors.push(`${record.path} operations exceed their per-migration bound`);
    }
    operationCount += migration.operations.length;
    if (operationCount > APP_STORAGE_LIMITS.operations) {
      errors.push("app-storage migrations exceed their total operation bound");
    }
    migration.operations.forEach((operation, operationIndex) => {
      replayOperation(tables, operation, `${where} operations[${operationIndex}]`, errors);
    });
  }
  result.tables = [...tables.values()];

  if (descriptor.default_table !== null && descriptor.default_table !== undefined) {
    if (typeof descriptor.default_table === "string" && !tables.has(descriptor.default_table)) {
      errors.push("app-storage default_table is not declared by the migration plan");
    }
  }
  if (Array.isArray(descriptor.record_search_columns)) {
    if (descriptor.default_table === null || descriptor.default_table === undefined) {
      errors.push("app-storage record_search_columns requires a default_table");
    } else {
      const table = tables.get(descriptor.default_table);
      for (const name of descriptor.record_search_columns) {
        const column = table?.columns.get(name);
        if (column === undefined) {
          errors.push(`app-storage record_search_columns names undeclared "${name}"`);
        } else if (column.type !== "text" && column.type !== "json") {
          errors.push(`app-storage record_search_columns "${name}" is not text or JSON`);
        }
      }
    }
  }
  return result;
}

function replayOperation(tables, operation, where, errors) {
  if (!isRecord(operation)) {
    errors.push(`${where} must be an object`);
    return;
  }
  const allowed = OPERATION_KEYS[operation.op];
  if (allowed === undefined) {
    errors.push(`${where}.op is not create_table, add_column, create_index or backfill`);
    return;
  }
  unknownKeys(operation, allowed, where, errors);
  if (typeof operation.table !== "string" || !IDENTIFIER.test(operation.table)) {
    errors.push(`${where}.table is not a bounded identifier`);
    return;
  }
  if (operation.op === "create_table") {
    if (tables.has(operation.table)) {
      errors.push(`${where} repeats table "${operation.table}"`);
      return;
    }
    if (tables.size >= APP_STORAGE_LIMITS.tables) {
      errors.push(`${where} exceeds the table bound`);
      return;
    }
    if (!Array.isArray(operation.columns) || operation.columns.length === 0) {
      errors.push(`${where}.columns must be a non-empty array`);
      return;
    }
    if (operation.columns.length > APP_STORAGE_LIMITS.columns) {
      errors.push(`${where}.columns exceeds the column bound`);
    }
    if (operation.record_bytes !== undefined) {
      if (
        !Number.isInteger(operation.record_bytes) ||
        operation.record_bytes < 1 ||
        operation.record_bytes > APP_STORAGE_LIMITS.recordBytes
      ) {
        errors.push(`${where}.record_bytes is outside its bound`);
      }
    }
    const columns = new Map();
    operation.columns.forEach((column, index) => {
      const parsed = validateColumn(column, `${where}.columns[${index}]`, errors);
      if (parsed === null) return;
      if (columns.has(parsed.name)) {
        errors.push(`${where} repeats column "${parsed.name}"`);
        return;
      }
      columns.set(parsed.name, parsed);
    });
    tables.set(operation.table, {
      name: operation.table,
      columns,
      indexes: new Map(),
      recordBytes: operation.record_bytes ?? 16 * 1024,
    });
    return;
  }
  const table = tables.get(operation.table);
  if (table === undefined) {
    errors.push(`${where} names undeclared table "${operation.table}"`);
    return;
  }
  if (operation.op === "add_column") {
    const parsed = validateColumn(operation.column, `${where}.column`, errors);
    if (parsed === null) return;
    if (table.columns.has(parsed.name)) {
      errors.push(`${where} repeats column "${parsed.name}"`);
    } else if (table.columns.size >= APP_STORAGE_LIMITS.columns) {
      errors.push(`${where} exceeds the column bound`);
    } else if (!parsed.nullable && !Object.hasOwn(parsed, "default")) {
      errors.push(`${where} adds a non-null column without a default`);
    } else {
      table.columns.set(parsed.name, parsed);
    }
    return;
  }
  if (operation.op === "create_index") {
    if (typeof operation.name !== "string" || !IDENTIFIER.test(operation.name)) {
      errors.push(`${where}.name is not a bounded identifier`);
      return;
    }
    if (table.indexes.has(operation.name)) {
      errors.push(`${where} repeats index "${operation.name}"`);
      return;
    }
    if (table.indexes.size >= APP_STORAGE_LIMITS.indexes) {
      errors.push(`${where} exceeds the index bound`);
    }
    if (!Array.isArray(operation.columns) || operation.columns.length === 0) {
      errors.push(`${where}.columns must be a non-empty array`);
      return;
    }
    if (
      operation.columns.length > APP_STORAGE_LIMITS.columns ||
      new Set(operation.columns).size !== operation.columns.length
    ) {
      errors.push(`${where}.columns must be distinct within the column bound`);
      return;
    }
    if (
      operation.columns.some(
        (name) =>
          typeof name !== "string" ||
          (!table.columns.has(name) && !APP_STORAGE_BASE_COLUMNS.includes(name)),
      )
    ) {
      errors.push(`${where} indexes an undeclared column`);
      return;
    }
    if (typeof operation.unique !== "boolean") {
      errors.push(`${where}.unique must be a boolean`);
      return;
    }
    table.indexes.set(operation.name, {
      name: operation.name,
      columns: [...operation.columns],
      unique: operation.unique,
    });
    return;
  }
  // backfill
  if (typeof operation.column !== "string" || !table.columns.has(operation.column)) {
    errors.push(`${where}.column is not a declared column`);
    return;
  }
  if (!isScalar(operation.value)) {
    errors.push(`${where}.value must be a JSON scalar`);
    return;
  }
  const column = table.columns.get(operation.column);
  if (!scalarMatches(column, operation.value)) {
    errors.push(`${where}.value does not satisfy the column`);
  }
  if (typeof operation.only_null !== "boolean") {
    errors.push(`${where}.only_null must be a boolean`);
  }
}

/**
 * The Works content boundary. The package owns exactly the material fields the
 * installed client reads and writes; actor, revision, review, export and
 * history columns are host authority and must never appear here.
 */
export function validateWorksStorage(model) {
  const errors = [];
  const { descriptor, tables } = model;
  if (descriptor === null) return ["app-storage descriptor is unavailable"];
  const documents = tables.find((table) => table.name === "documents");
  if (descriptor.app !== "works") errors.push("app-storage app is not works");
  if (descriptor.record_kind !== "document") {
    errors.push('app-storage record_kind is not "document"');
  }
  if (descriptor.default_table !== null) {
    errors.push(
      "app-storage default_table must be null; the trusted Works adapter uses the explicit documents handle",
    );
  }
  if (Object.hasOwn(descriptor, "record_write_schema")) {
    errors.push(
      "app-storage must not declare record_write_schema; there is no generic record write bridge",
    );
  }
  if (Object.hasOwn(descriptor, "record_search_columns")) {
    errors.push(
      "app-storage must not declare record_search_columns; there is no generic record read bridge",
    );
  }
  for (const table of tables) {
    if (table.name !== "documents") {
      errors.push(`app-storage declares non-content table "${table.name}"`);
    }
  }
  for (const migration of model.migrations) {
    const operations = Array.isArray(migration.migration?.operations)
      ? migration.migration.operations
      : [];
    for (const operation of operations) {
      if (!isRecord(operation)) continue;
      if (operation.table !== "documents") {
        errors.push(`${migration.path} targets non-content table "${operation.table}"`);
      }
    }
  }
  if (documents === undefined) return [...errors, "documents table is not declared"];

  const expected = [
    { name: "kind", type: "text", nullable: false, enum: ["doc", "deck", "sheet"] },
    { name: "title", type: "text", nullable: false, max_length: APP_STORAGE_LIMITS.titleCharacters },
    {
      name: "tags",
      type: "json",
      nullable: false,
      default: [],
      json_schema: {
        type: "array",
        maxItems: APP_STORAGE_LIMITS.tags,
        uniqueItems: true,
        items: {
          type: "string",
          minLength: 1,
          maxLength: APP_STORAGE_LIMITS.tagCharacters,
        },
      },
    },
    { name: "blocks", type: "json", nullable: true },
    { name: "slides", type: "json", nullable: true },
    { name: "columns", type: "json", nullable: true },
    { name: "rows", type: "json", nullable: true },
  ];
  if (documents.columns.size !== expected.length) {
    errors.push(`documents must declare exactly the ${expected.length} content columns`);
  }
  for (const column of expected) {
    const actual = documents.columns.get(column.name);
    if (actual === undefined) {
      errors.push(`documents.${column.name} is not declared`);
      continue;
    }
    for (const key of ["type", "nullable", "enum", "max_length", "default", "json_schema"]) {
      if (JSON.stringify(actual[key] ?? null) !== JSON.stringify(column[key] ?? null)) {
        errors.push(`documents.${column.name} ${key} does not match the Works content model`);
      }
    }
  }
  for (const name of documents.columns.keys()) {
    if (!expected.some((column) => column.name === name)) {
      errors.push(`documents declares unexpected column "${name}"`);
    }
  }
  if (documents.recordBytes !== APP_STORAGE_LIMITS.recordBytes) {
    errors.push(`documents record_bytes must be ${APP_STORAGE_LIMITS.recordBytes}`);
  }
  const indexes = [...documents.indexes.values()];
  if (
    indexes.length !== 1 ||
    indexes[0].name !== "documents_kind" ||
    indexes[0].unique !== false ||
    JSON.stringify(indexes[0].columns) !== JSON.stringify(["kind"])
  ) {
    errors.push("documents must declare only the non-unique documents_kind index on kind");
  }
  return errors;
}
