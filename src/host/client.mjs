const DEFAULT_HOST = "http://127.0.0.1:4174";

export class HostClientError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "HostClientError";
    this.code = code;
    this.status = status;
  }
}

export function createHostClient(base = DEFAULT_HOST) {
  const origin = String(base).replace(/\/+$/, "");

  const request = async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new HostClientError(
        payload?.error ?? "http_error",
        payload?.message ?? `reference host returned HTTP ${response.status}`,
        response.status,
      );
    }
    return payload;
  };

  const list = ({ query = "", kind = "all", sort = "updated" } = {}) => {
    const params = new URLSearchParams();
    if (query) params.set("text", query);
    if (kind !== "all") params.set("kind", kind);
    if (sort) params.set("sort", sort);
    const suffix = params.toString();
    return request("GET", `/api/works${suffix ? `?${suffix}` : ""}`);
  };

  const get = (id) => request("GET", `/api/works/${encodeURIComponent(id)}`);
  const health = () => request("GET", "/health");
  const audit = () => request("GET", "/api/audit");

  const create = ({ kind, title, content, tags = [], actor, key }) =>
    request("POST", "/api/works", {
      kind,
      title,
      content,
      tags,
      actor,
      idempotencyKey: key,
    });

  const patch = (id, { ifRevision, operations, actor, key }) =>
    request("PATCH", `/api/works/${encodeURIComponent(id)}`, {
      ifRevision,
      operations,
      actor,
      idempotencyKey: key,
    });

  const trash = (id, { ifRevision, actor, key }) =>
    request("DELETE", `/api/works/${encodeURIComponent(id)}`, {
      ifRevision,
      actor,
      idempotencyKey: key,
    });

  const restore = (id, { ifRevision, actor, key }) =>
    request("POST", `/api/works/${encodeURIComponent(id)}/restore`, {
      ifRevision,
      actor,
      idempotencyKey: key,
    });

  const requestReview = (id, { revision, actor }) =>
    request("POST", `/api/works/${encodeURIComponent(id)}/request-review`, { revision, actor });

  const review = (id, { revision, decision, note, actor }) =>
    request("POST", `/api/works/${encodeURIComponent(id)}/review`, {
      revision,
      decision,
      note,
      actor,
    });

  const exportContent = (id, { revision, format, actor }) =>
    request("POST", `/api/works/${encodeURIComponent(id)}/export`, { revision, format, actor });

  return {
    list,
    get,
    health,
    audit,
    create,
    patch,
    trash,
    restore,
    requestReview,
    review,
    export: exportContent,
  };
}
