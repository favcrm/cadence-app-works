import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { contentFixtures } from "../content/fixtures.mjs";
import { createFixtureHost, HostError } from "../contract/host.mjs";

const STATUS = {
  invalid: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  needs_review: 409,
};

const send = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HostError("invalid", "invalid JSON body");
  }
};

const queryValue = (url, key) => {
  const value = url.searchParams.get(key);
  return value === null ? undefined : value;
};

export async function createReferenceHost({
  dataFile = process.env.WORKS_DATA ?? resolve(process.cwd(), ".data/works.json"),
  port = Number(process.env.WORKS_PORT ?? 4174),
  bind = process.env.WORKS_BIND ?? "127.0.0.1",
} = {}) {
  const host = createFixtureHost({ fixtures: contentFixtures });

  if (dataFile) {
    try {
      const state = JSON.parse(await readFile(dataFile, "utf8"));
      host.loadState(state);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  let persistQueue = Promise.resolve();
  let persistSequence = 0;

  const persist = () => {
    if (!dataFile) return Promise.resolve();
    const run = persistQueue.then(async () => {
      await mkdir(dirname(dataFile), { recursive: true });
      const temporary = `${dataFile}.${process.pid}.${persistSequence++}.tmp`;
      await writeFile(temporary, `${JSON.stringify(host.snapshot(), null, 2)}\n`);
      await rename(temporary, dataFile);
    });
    persistQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const mutate = async (work) => {
    const result = await work();
    await persist();
    return result;
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${bind}`);
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "OPTIONS") {
        send(res, 204, {});
        return;
      }

      if (url.pathname === "/health" && method === "GET") {
        send(res, 200, { ok: true, host: "reference" });
        return;
      }

      if (url.pathname === "/api/audit" && method === "GET") {
        send(res, 200, host.audit());
        return;
      }

      if (parts[0] !== "api" || parts[1] !== "works") {
        send(res, 404, { error: "not_found", message: "route not found" });
        return;
      }

      if (parts.length === 2) {
        if (method === "GET") {
          send(
            res,
            200,
            host.query({
              text: queryValue(url, "text") ?? "",
              kind: queryValue(url, "kind") ?? "all",
              review: queryValue(url, "review"),
              export: queryValue(url, "export"),
              tag: queryValue(url, "tag"),
              owner: queryValue(url, "owner"),
              sort: queryValue(url, "sort") ?? "updated",
            }),
          );
          return;
        }
        if (method === "POST") {
          const body = await readJsonBody(req);
          const result = await mutate(() =>
            host.create({
              kind: body.kind,
              title: body.title,
              content: body.content,
              tags: body.tags ?? [],
              actor: body.actor,
              idempotencyKey: body.idempotencyKey,
            }),
          );
          send(res, 201, result);
          return;
        }
        send(res, 405, { error: "method_not_allowed" });
        return;
      }

      const id = decodeURIComponent(parts[2] ?? "");

      if (parts.length === 3) {
        if (method === "GET") {
          send(res, 200, host.get({ id }));
          return;
        }
        if (method === "PATCH") {
          const body = await readJsonBody(req);
          const result = await mutate(() =>
            host.patch({
              id,
              ifRevision: body.ifRevision,
              operations: body.operations,
              actor: body.actor,
              idempotencyKey: body.idempotencyKey,
            }),
          );
          send(res, 200, result);
          return;
        }
        if (method === "DELETE") {
          const body = await readJsonBody(req);
          const result = await mutate(() =>
            host.trash({
              id,
              ifRevision: body.ifRevision,
              actor: body.actor,
              idempotencyKey: body.idempotencyKey,
            }),
          );
          send(res, 200, result);
          return;
        }
        send(res, 405, { error: "method_not_allowed" });
        return;
      }

      if (parts.length === 4 && method === "POST") {
        const body = await readJsonBody(req);
        if (parts[3] === "restore") {
          const result = await mutate(() =>
            host.restore({
              id,
              ifRevision: body.ifRevision,
              actor: body.actor,
              idempotencyKey: body.idempotencyKey,
            }),
          );
          send(res, 200, result);
          return;
        }
        if (parts[3] === "request-review") {
          const result = await mutate(() =>
            host.request_review({ id, revision: body.revision, actor: body.actor }),
          );
          send(res, 200, result);
          return;
        }
        if (parts[3] === "review") {
          const result = await mutate(() =>
            host.review({
              id,
              revision: body.revision,
              decision: body.decision,
              note: body.note,
              actor: body.actor,
            }),
          );
          send(res, 200, result);
          return;
        }
        if (parts[3] === "export") {
          const result = await mutate(() =>
            host.export({
              id,
              revision: body.revision,
              format: body.format,
              actor: body.actor,
            }),
          );
          send(res, 200, result);
          return;
        }
      }

      send(res, 404, { error: "not_found", message: "route not found" });
    } catch (error) {
      if (error instanceof HostError) {
        send(res, STATUS[error.code] ?? 400, {
          error: error.code,
          message: error.message,
        });
        return;
      }
      send(res, 500, {
        error: "internal",
        message: error instanceof Error ? error.message : "unexpected error",
      });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off("error", onError);
      rejectListen(error);
    };
    server.once("error", onError);
    server.listen(port, bind, () => {
      server.off("error", onError);
      resolveListen();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${bind}:${actualPort}`;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
      server.closeAllConnections?.();
    });
    await persistQueue;
  };

  return { server, host, url, port: actualPort, dataFile, close };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const instance = await createReferenceHost();
  console.log(`works reference host listening on ${instance.url}`);
  console.log(`state: ${instance.dataFile}`);
  const stop = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
