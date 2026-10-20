#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const options = {
  host: { type: "string" },
  actor: { type: "string" },
  key: { type: "string" },
  "if-revision": { type: "string" },
  revision: { type: "string" },
  kind: { type: "string" },
  title: { type: "string" },
  content: { type: "string" },
  operations: { type: "string" },
  decision: { type: "string" },
  note: { type: "string" },
  format: { type: "string" },
  text: { type: "string" },
  review: { type: "string" },
  export: { type: "string" },
  tag: { type: "string" },
  owner: { type: "string" },
  sort: { type: "string" },
  help: { type: "boolean" },
};

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options,
    strict: true,
  });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const { values, positionals } = parsed;
const [command, id] = positionals;
const base = (values.host ?? process.env.WORKS_HOST ?? "http://127.0.0.1:4174").replace(/\/+$/, "");
const actor = values.actor ?? process.env.WORKS_ACTOR;
const key = values.key;

const usage = `works <command> [options]

  list|query   [--kind] [--text] [--review] [--export] [--tag] [--owner] [--sort]
  show <id>
  create       --kind <doc|deck|sheet> --title <title> --content <json> --actor <who> --key <idempotency>
  patch <id>   --if-revision <n> --operations <json> --actor <who> --key <idempotency>
  trash <id>   --if-revision <n> --actor <who> --key <idempotency>
  restore <id> --if-revision <n> --actor <who> --key <idempotency>
  request-review <id> --revision <n> --actor <who>
  review <id>  --revision <n> --decision <approve|changes> [--note] --actor <who>
  export <id>  --revision <n> [--format html|pdf] --actor <who>
  audit

  --host <url> (default WORKS_HOST or http://127.0.0.1:4174)`;

const parseJsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));
const integer = (value, label) => {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
};

const request = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: "invalid_response" }));
  if (!response.ok) {
    const error = new Error(payload.message ?? `HTTP ${response.status}`);
    error.code = payload.error;
    throw error;
  }
  return payload;
};

const mutation = (method, path, body) => {
  if (!actor) throw new Error("--actor is required");
  if (!key) throw new Error("--key is required");
  return request(method, path, { ...body, actor, idempotencyKey: key });
};

const run = async () => {
  if (!command || command === "help" || values.help) {
    console.log(usage);
    return;
  }

  if (command === "list" || command === "query") {
    const params = new URLSearchParams();
    for (const [option, parameter] of [
      ["text", "text"],
      ["kind", "kind"],
      ["review", "review"],
      ["export", "export"],
      ["tag", "tag"],
      ["owner", "owner"],
      ["sort", "sort"],
    ]) {
      if (values[option] !== undefined) params.set(parameter, values[option]);
    }
    const query = params.toString();
    return request("GET", `/api/works${query ? `?${query}` : ""}`);
  }

  if (command === "show") {
    if (!id) throw new Error("show requires an id");
    return request("GET", `/api/works/${encodeURIComponent(id)}`);
  }

  if (command === "audit") return request("GET", "/api/audit");

  if (command === "create") {
    if (!values.kind || !values.title || !values.content) {
      throw new Error("create requires --kind, --title and --content");
    }
    const content = await parseJsonFile(values.content);
    return mutation("POST", "/api/works", {
      kind: values.kind,
      title: values.title,
      content,
      tags: values.tag ? [values.tag] : [],
    });
  }

  if (command === "patch") {
    if (!id || !values.operations) throw new Error("patch requires an id and --operations");
    const operations = await parseJsonFile(values.operations);
    return mutation("PATCH", `/api/works/${encodeURIComponent(id)}`, {
      ifRevision: integer(values["if-revision"], "--if-revision"),
      operations,
    });
  }

  if (command === "trash") {
    if (!id) throw new Error("trash requires an id");
    return mutation("DELETE", `/api/works/${encodeURIComponent(id)}`, {
      ifRevision: integer(values["if-revision"], "--if-revision"),
    });
  }

  if (command === "restore") {
    if (!id) throw new Error("restore requires an id");
    return mutation("POST", `/api/works/${encodeURIComponent(id)}/restore`, {
      ifRevision: integer(values["if-revision"], "--if-revision"),
    });
  }

  if (command === "request-review") {
    if (!id) throw new Error("request-review requires an id");
    if (!actor) throw new Error("--actor is required");
    return request("POST", `/api/works/${encodeURIComponent(id)}/request-review`, {
      revision: integer(values.revision, "--revision"),
      actor,
    });
  }

  if (command === "review") {
    if (!id) throw new Error("review requires an id");
    if (!actor) throw new Error("--actor is required");
    if (!values.decision) throw new Error("review requires --decision");
    return request("POST", `/api/works/${encodeURIComponent(id)}/review`, {
      revision: integer(values.revision, "--revision"),
      decision: values.decision,
      note: values.note,
      actor,
    });
  }

  if (command === "export") {
    if (!id) throw new Error("export requires an id");
    if (!actor) throw new Error("--actor is required");
    return request("POST", `/api/works/${encodeURIComponent(id)}/export`, {
      revision: integer(values.revision, "--revision"),
      format: values.format ?? "html",
      actor,
    });
  }

  console.error(`unknown command: ${command}\n\n${usage}`);
  process.exit(2);
};

try {
  const result = await run();
  if (result === undefined) {
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(0));
} catch (error) {
  console.error(`${error.code ?? "error"}: ${error.message}`);
  process.exit(1);
}
