> Status: the installed `app/` bundle uses the Cadence screen host
> (`works.*` under `screen-records.v1`). This document is the transport-agnostic
> domain model and the reference host contract. The installed child never
> supplies `actor`, `on_behalf_of`, install, context or session; the host derives
> them. The localhost reference host is development evidence, not the shipped path.

# Host content contract v0

Status: **proposed, transport-agnostic**. This is the app-facing contract the
Cadence host must implement for Works. It is not a host integration claim and it
does not define the master/chat/CLI tool-call command.

The reference implementation lives in `src/contract/host.mjs`; the localhost
service and CLI are in `src/host/` and `scripts/works.mjs`.

## Actors and scopes

Every call carries an `actor` (user or agent) and optionally an `on_behalf_of`
principal. The host resolves scopes; the fixture accepts actor strings and checks
the one rule it can enforce locally: **an author cannot approve their own
revision**.

| Scope | May |
|---|---|
| author | query/read, create, patch, trash/restore, request review |
| reviewer | query/read, review pending content they did not author |
| operator | purge, permission and retention changes (outside this contract) |

The host records the actor, on-behalf-of and action in the audit trail.

## Read

```text
query({ text?, kind?, review?, export?, tag?, owner?, sort? })
get({ id })
```

- `query` returns compact summaries: `id, kind, title, revision,
  reviewedRevision, reviewState, reviewStatus, exportState, updated, updatedAt,
  owner, tags, snippet`.
- `get` returns the kind payload (`slides` for deck, `blocks` for doc,
  `columns`/`rows` for sheet) plus the summary and the review/export fields.
- Deleted content is absent from `query` and `get` until restored.
- `review` filters: `draft`, `edited`, `reviewed`, `pending`,
  `changes_requested`.
- `export` filters: `ready`, `blocked`.
- The fixture reuses the read-only `createContentReader` projection and applies
  the host review/export gate on top.

## Write operations

All mutations carry `actor`. `create`, `patch`, `trash` and `restore` also carry
an `idempotencyKey`. `patch`, `trash` and `restore` require `ifRevision` equal to
the current revision.

```text
create({ kind, title, content, tags?, actor, idempotencyKey })
patch({ id, ifRevision, operations, actor, idempotencyKey })
trash({ id, ifRevision, actor, idempotencyKey })
restore({ id, ifRevision, actor, idempotencyKey })
request_review({ id, revision, actor })
review({ id, revision, decision, note?, actor })
export({ id, revision, format?, actor })
```

- `create` allocates the id and revision 1, sets `reviewedRevision = 0` and
  `reviewStatus = "none"`.
- `patch` operations v0: `{type: "set_title", title}` and
  `{type: "set_content", content}`. The content object is the whole kind payload;
  this is an editor seam, not the final block/slide/cell operation set. A patch
  creates revision `n + 1`, records the actor as the revision author, preserves
  `reviewedRevision`, resets `reviewStatus` to `"none"` and clears any pending
  review request.
- `trash` and `restore` set the soft-delete flag; they do not create a revision.
  Trashed content is not readable or exportable. Purge is operator-only and is
  not in this contract.
- `request_review` pins the current revision as pending. Only the current
  revision can be reviewed.
- `review` accepts `approve` or `changes`. Only a pending current revision can be
  reviewed, and the actor must not be the revision author. `approve` sets
  `reviewedRevision = revision` and `reviewStatus = "approved"`. `changes` sets
  `reviewStatus = "changes_requested"` and does not approve the revision.
- `export` is a receipt operation, not a mutation. It succeeds only when the
  content is not trashed, the requested revision is current,
  `reviewedRevision == revision`, and `reviewStatus == "approved"`. It returns
  `{ id, revision, format, digest }`.

## Review/export gate

The gate is enforced by the host, not the app:

1. A revision with `reviewStatus = "none"` or `"changes_requested"` cannot export.
2. A pending review request does not approve anything.
3. An edit after approval keeps `reviewedRevision` but makes it stale; export is
   blocked.
4. Exporting an older approved revision is refused when a newer revision is
   current.
5. A reviewer cannot approve their own revision even if they hold a reviewer
   role.

The read-only app can display these states; it has no action that changes them.

## Revision, CAS and idempotency

- Content revisions are immutable records; the item points at the current one.
- A stale `ifRevision` is a `conflict`; nothing is written.
- A mutation replay with the same actor, idempotency key and payload returns the
  original result.
- Reusing the same actor/key with a different payload is a `conflict`.
- The fixture stores revisions in memory only; the real host owns durable
  revision and idempotency records.

## Errors

`HostError.code` is one of:

| Code | Meaning |
|---|---|
| `not_found` | Unknown or trashed content |
| `conflict` | Stale revision or idempotency payload mismatch |
| `forbidden` | Scope, actor or self-approval violation |
| `invalid` | Missing field, unsupported kind/op/decision or invalid payload |
| `needs_review` | Export requested for a revision that is not current and approved |

Transports map these codes; the contract does not mandate HTTP statuses.

## Audit

The host records at least `{ at, actor, on_behalf_of?, action, id, revision }` for
every mutation and export. The fixture exposes `audit()` for tests. Agent-authored
content keeps the actor and on-behalf-of identity for the review surface.

## Reference host and boundaries

`src/contract/host.mjs` is the in-memory reference host. `src/host/server.mjs`
exposes the same operations on localhost (default `127.0.0.1:4174`), seeds the
content fixtures, and persists snapshots to ignored `.data/works.json`.
`scripts/works.mjs` is a JSON CLI over that service.

This reference host is development tooling:

- no auth, real data, production persistence or Cadence host integration;
- not imported by `src/screens/` or `dev/`;
- no create/edit/delete/review/export controls are added to the read-only app;
- the master/chat/CLI agent tool-call command and write UI remain deferred.

It proves the contract end to end for the CLI and gives the next host/UI/agent
slices one surface to call. It is not the production Cadence host.
