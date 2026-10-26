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

## Managed app storage and the host seam (WRK-10)

Status: the package contract and its offline validation are implemented; the
hosted v2 runtime does not implement this seam yet. The canonical native rules
are `src/store/app_works.rs` and `src/daemon/app_works_rpc.rs` in the Cadence
native repository (feature base 6bf main plus grammar commit 819). Reuse those
rules; do not build a second Works domain engine or turn the reference host
into a production adapter. For the installed `works.*` path this section
supersedes the actor-in-arguments shape above: only the development reference
host accepts an explicit actor; the installed screen never sends one.

### App-owned table

`app/app-storage.json` declares `app-storage/v1`, `record_kind: "document"`
and `default_table: null`, with no `record_search_columns` and no
`record_write_schema`. `app/storage/001-documents.json` is the ordered
migration and its raw-byte digest is pinned in the descriptor. The declared
table is exactly:

| Column | Type | Constraint |
|---|---|---|
| `kind` | text | not null; `doc`, `deck` or `sheet` |
| `title` | text | not null; at most 240 characters |
| `tags` | json | not null; default `[]`; at most 20 unique strings of 1–60 characters |
| `blocks` | json | nullable |
| `slides` | json | nullable |
| `columns` | json | nullable |
| `rows` | json | nullable |

The host owns `id`, `context_id`, `revision`, `created_at` and `updated_at` on
this table. `documents_kind` indexes `kind`. `record_bytes` is 262144 (the host
ceiling), because the native content grammar already bounds one kind payload to
65536 bytes and JSON escaping grows the stored row. The payload columns carry no
`json_schema` on purpose: the host's bounded JSON Schema value caps (256 array
items, 4096 nodes) are narrower than the native grammar, and adoption must not
reject content the native host accepted.

The package deliberately declares no generic record bridge: `default_table` is
`null`, and `record_search_columns` and `record_write_schema` are omitted. A
trusted host adapter resolves the explicit logical `documents` handle
(`appStorage.table(installId, "documents")`) and the nine `works.*` operations
are the only interface. The host's generic record resolver already refuses a
null default table (`apps/api/src/tenant-board/app-records.ts:386`), so no
`records.list`/`show`/`create`/`update` can reach `documents`. A generic read
would be a second projection that could bypass the host's trashed/revision/review
filters; a generic write would bypass the immutable revision, audit, CAS and
review invalidation that a Works mutation requires. Do not add a default table
or a write schema to make the screen work.

**Reconstruct content, not the row.** A flattened `documents` row is storage,
not the native content value. Before hashing, comparing or exporting material,
build the kind's closed content object and omit every other payload column:

- `doc` → `{ "blocks": <blocks> }`
- `deck` → `{ "slides": <slides> }`
- `sheet` → `{ "columns": <columns>, "rows": <rows> }`

Never include `null` keys for the irrelevant columns. The content digest is
computed over `{kind, title, content}` with that reconstructed object and must
equal the immutable revision's stored digest; including null payload members or
the host base columns changes the digest and breaks adoption/export.

### Host authority (never app columns)

The host needs its own installation-scoped state, keyed by
`(install_id, context_id, id)`. These are host tables, not `app-storage`
members:

- **Items/lifecycle:** `owner`, current `revision`, `reviewed_revision`,
  `review_status` (`none`, `pending`, `approved`, `changes_requested`),
  `pending_revision`, `trashed`. The current material stays in `documents`.
- **Immutable revisions:** `(id, revision, kind, title, content_json,
  content_digest, author, at)`. `content_json` keeps the historical payload even
  though `documents` holds only the current one.
- **Audit:** `(at, actor, on_behalf_of, action, id, revision)`.
- **Idempotency:** `(context_id, actor, key, op, payload_digest, result_json,
  at)`; the stored `result_json` is the replay result.

Proposed hosted names are `tenant_works_items`, `tenant_works_revisions`,
`tenant_works_audit` and `tenant_works_idempotency` with an `install_id`
column; the names are host-owned, the columns and keys are not optional.
`owner`, `reviewed_revision`, `review_status`, `pending_revision`, `trashed`,
`content_digest` and export state must never be copied into `documents`, and no
app-supplied field may set them.

### Operation contract

Every call proves the mount and context from the host proof; a screen never
sends `install_id`, `context_id`, `actor`, `reviewer` or `on_behalf_of`, and an
unknown or identity-shaped argument is `invalid`.

| Operation | Arguments | Host work |
|---|---|---|
| `works.query` | `text?`, `kind?`, `review?`, `export?`, `tag?`, `owner?`, `sort?` | Read `documents` plus authority; exclude trashed; return compact rows `id, kind, title, revision, reviewedRevision, reviewState, reviewStatus, exportState, updated, updatedAt, owner, tags, snippet`. Text search covers title, tags and the kind payload. |
| `works.get` | `id` | Return the detail: the compact fields plus `blocks`/`slides`/`columns`+`rows`, `author`, `contentDigest`, `reviewRequestedRevision` and `exportReason`. A trashed or unknown id is `not_found`. |
| `works.create` | `kind`, `title`, `content`, `tags?`, `idempotency_key` | Validate the kind grammar and bounds; derive the actor; allocate the slug id (lowercase, at most 48 characters, suffixed `-2`, `-3`, … on collision and refused once the suffix passes 1000); insert `documents` at revision 1, the item row, the revision-1 snapshot/digest, the audit row and the idempotency result in one transaction. |
| `works.patch` | `id`, `if_revision`, `operations`, `idempotency_key` | Accept only `{type:"set_title",title}` and `{type:"set_content",content}`, applied in order with the final title/content revalidated. A stale `if_revision` is `conflict`. Write the new material at `n+1`, append the immutable revision and audit, keep `reviewed_revision` but set `review_status` to `none` and clear `pending_revision`, so the previous approval becomes stale and export blocks. |
| `works.trash` / `works.restore` | `id`, `if_revision`, `idempotency_key` | CAS on `if_revision`; flip the host `trashed` flag without changing the revision; audit and idempotency only. Trash returns `{id, revision, trashed: true}`; restore returns the detail. A trashed item is absent from query/get and cannot export. |
| `works.request_review` | `id`, `revision` | Only the current, non-trashed revision; set `review_status = pending` and `pending_revision = revision`; audit. |
| `works.review` | host-confirmed slot | The host, not the app, draws the approve/changes confirmation and supplies the decision and optional note (at most 2000 characters). Require the current pending revision, derive the reviewer from the verified session, and require two verified distinct humans: the revision author and reviewer must differ, and neither may be the bare `operator` fallback. `approve` sets `reviewed_revision = revision` and `review_status = approved`; `changes` sets `changes_requested` and approves nothing. Audit the decision. |
| `works.export` | host-confirmed slot | The host draws the format choice (non-empty, at most 40 characters). Require a non-trashed item, `revision == current`, `review_status == approved` and `reviewed_revision == revision`; return `{id, revision, format, digest}` using the immutable revision's content digest, and append the export audit row. A wrong or stale revision is `needs_review`. |

The app never supplies an export digest, an approval, a reviewer identity or a
review state. The screen's `records.slot` call is the request; the host supplies
the confirmation card, decision and format.

### Host confirmation slots (native protocol)

The installed screen already speaks the native two-step slot protocol; do not
add a direct `works.review`/`works.export` call through `records.call` and do not
invent a second card design. The native board UI
(`ui/src/features/workspace-apps/screen/screenServices.ts`) implements it as:

1. `POST /api/app-screen-services/slot-prepare {operation, args}` returns
   `{confirmation_token, card: {operation, facts}}`.
2. For `works.review`/`works.export`, the reopened card shows only host-derived
   facts: `title`, `kind`, `revision`, `author`, `contentDigest`, plus the
   review decision choices (`approve`, `changes`) or the export format choices
   the host offers (`html`, `markdown` in the native UI).
3. `POST /api/app-screen-services/slot-confirm {confirmation_token,
   confirmation: {confirmed: true, choice}}` re-proves the mount, revision and
   actor, applies exactly one decision/export, and consumes the token. The
   native UI treats the token as one-use (no automatic retry) and expires the
   card after 60 seconds.

The host must recompute the card facts from the current store at prepare time
and re-check them at confirm time; facts never come from the app frame. A
changed title, kind, revision, author or digest between the two calls refuses
the confirmation instead of acting on a stale card. The export receipt's
`digest` is the content digest shown on the card.

### Digest semantics (native, do not approximate)

The native store publishes two different digests:

- **Content digest** covers `{kind, title, content}` only. `content` is the
  kind's reconstructed object from the flattened row (`{blocks}`, `{slides}` or
  `{columns, rows}`), with no null irrelevant payload members. It is the
  immutable revision digest, the card's `contentDigest`, and the export receipt
  digest. Tags are deliberately excluded so re-tagging does not rewrite
  review/export material.
- **Payload digest** covers `{kind, title, content, tags}`. It is only the
  idempotency payload fingerprint; two mutations that differ only in tags must
  not replay as the same request.

Adoption must recompute both from the imported fields and compare each with its
stored native value. A migration that changes only tags leaves the content
digest and review/export authority intact but does change the payload digest
for future idempotency comparisons.


### Actor and scope derivation

The native rule is the reference: a verified board human becomes
`human:<company>:<sub>`; a native operator call without a verified human is
`operator`, and that fallback may neither approve nor be approved. Context and
install come from the mount proof. The hosted v2 runtime currently derives an
actor only for the owner role on the generic record path
(`apps/api/src/tenant-board/workspace.ts`, `callAppRecords`), and its screen
service scope is only `{installId, contextId}`. A Works review therefore needs a
host primitive that resolves a verified reviewer identity, not a
client-supplied id and not an invented membership or role.

### Adoption

Adoption is host-owned and atomic. For each native Works item and its current
revision:

| Native source | Destination |
|---|---|
| `app_works_items.id`, `context_id`, `revision` | `documents.id`, `context_id`, `revision` |
| `app_works_items.kind`, `title`, `tags` | `documents.kind`, `title`, `tags` |
| current revision `content_json` `blocks`/`slides`/`columns`/`rows` | the matching `documents` payload column; others `null` |
| `app_works_items.updated` | `documents.updated_at` |
| earliest `app_works_revisions.at` (or `updated` when no revision exists) | `documents.created_at` |
| `owner`, `reviewed_revision`, `review_status`, `pending_revision`, `trashed` | host items table |
| every `app_works_revisions` row (`revision`, `kind`, `title`, `content_json`, `content_digest`, `author`, `at`) | host revisions table |
| `app_works_audit` rows | host audit table |
| `app_works_idempotency` rows | host idempotency table with the recomputed payload digest |

1. Copy `kind`, `title` and `tags` into `documents`; split `content` into the
   kind's payload columns and leave the other payload columns `null`.
2. Preserve the record id, context id, revision number, created/updated
   timestamps, owner, `reviewed_revision`, `review_status`, `pending_revision`
   and `trashed` in the host tables.
3. Copy every native immutable revision, including its `content_json`, author
   and timestamp. Recompute the canonical content digest from
   `{kind,title,content}` where `content` is rebuilt from the flattened columns
   for that kind (only `blocks`, `slides` or `columns`+`rows`, no null members)
   and require it to equal the stored native digest. A mismatch refuses
   adoption: never rewrite a digest that a review or export receipt referenced.
4. Copy audit and idempotency rows. Recompute each idempotency payload digest
   from `{kind,title,content,tags}` and keep its stored result. A replayed key
   must resolve to the same stored result or refuse as a conflict; it must
   never re-execute a mutation.
5. Keep an approved current revision approved only while the material digest is
   unchanged. Any normalization that changes material clears the approval as in
   the migration rule below and records why.

The kernel's current `adoptLegacy` is not Works-compatible as-is: its source
allowlist is the four CRM tables and `APP_STORAGE_LEGACY_RECORD_KIND` is the
global string `"customer"`; `rebuildLegacy` also requires the adopted logical
tables and columns to match the package schema and the record kind to match the
plan. Do not add Works tables to the CRM allowlist as a shortcut. Main needs
either a per-adoption record kind plus a content-shape bridge, or a Works-owned
host import that applies the schema and writes the rows, authority, history,
audit and idempotency records in one transaction.

### A material migration invalidates stale export authority

App-storage `apply` is idempotent for an identical plan, refuses an edited prior
checksum and refuses an undeclared downgrade. A new migration that adds or
backfills a column on `documents` (anything other than `create_index`) can
change stored material. For every document, the host recomputes the **content
digest** from the stored `kind`, `title` and payload columns (tags excluded,
exactly as the published revision digest) and compares it with the current
revision's `content_digest`:

- equal digest: the approval and export references stay valid;
- different digest: set `review_status = none`, `reviewed_revision = 0` and
  `pending_revision = null`, append an audit row naming the migration version
  and checksum, and treat prior export receipts as stale. Export refuses with
  `needs_review` until a distinct reviewer approves the current revision.

Do not create a new Works revision for a migration, do not rewrite the
immutable revision's digest, and do not mark anything approved or exported. The
same rule applies when an adoption normalization changes material. The v1
`create_table` on an empty namespace has no prior rows and therefore nothing to
invalidate; the import validates digests before writing authority.

### Failure, retry and isolation

Each Works mutation and each schema apply runs in one tenant transaction: a
refusal (stale revision, schema mismatch, review gate, audit/journal bound)
leaves rows, revisions, audit and idempotency untouched. A replay with the same
actor and key returns the stored result; reusing the key with another payload is
`conflict`. Trash/restore never rewinds a revision. Every app-storage namespace
is per install, and the Works host tables are scoped by `install_id` and
`context_id`; a Works failure must not touch the board or another app.

### Host prerequisites blocking runtime acceptance

1. **Works dispatch.** `apps/api/src/tenant-board/screens.ts` admits the nine
   `works.*` mount verbs, but `screen-services.ts` has no Works case and falls
   through to `unsupported_verb`. A Works backend (or a dedicated call path)
   must resolve the app-storage `documents` table, e.g. via
   `appStorage.table(installId, "documents")` and the tenant SQL executor, as
   `TenantMarketing` does at `apps/api/src/tenant-board/marketing.ts:360`.
2. **Host-confirmed slots.** `works.review` and `works.export` are slot calls;
   the hosted runtime has no slot executor for the native
   `slot-prepare`/`slot-confirm` protocol that draws the decision or format card,
   re-proves the revision and returns the host result. Do not accept the
   decision, format or digest from the screen frame, and do not expose a direct
   `works.review`/`works.export` path through `records.call`.
3. **Verified reviewer identity.** Hosted v2 resolves an actor only for the
   owner role (`callAppRecords`) and exposes no distinct-human reviewer
   primitive. Port the native `verified_owner_human` →
   `human:<company>:<sub>` rule and the two-distinct-humans fence; do not invent
   reviewer memberships, roles or a client-supplied reviewer.
4. **Review/export authority storage.** Hosted v2 has no Works review/export
   tables or gate; its campaign `approval` field is explicitly always empty.
   The item, revision, audit and idempotency tables above must exist before the
   operations can be implemented honestly.
5. **Works adoption.** As above: the legacy adoption allowlist, fixed record
   kind and shape rebuild are CRM-shaped and must not be stretched to cover
   Works.
6. **No trusted Works implementation reaches the DO.** The canonical store is
   Rust `impl RecordStore` over `rusqlite` (`src/store/app_works.rs`:
   `write_tx`, `now`, per-install record file); it has no WASM/FFI export or
   portable operation artifact. Hosted v2's only wasm bridge
   (`apps/api/src/hosted-cadence/wasm-rules.ts`, `core.wasm`) exposes exactly
   `app.manifest.preflight`, `issue.validate` and `issue.readiness`; it has no
   Works op and no SQL handle. Reusing the trusted native rules therefore
   requires either a new TypeScript `TenantWorks` port over
   `ReadModelSql` + the explicit `documents` handle + the host authority
   tables, or a new approved host primitive/domain interpreter. A descriptor-only
   package cannot execute, so runtime integration stays blocked on the AOS
   durable-kernel decision; do not claim the schema change completes the
   feature.
7. **No fallback.** The dev reference host, fixtures and `dev/` pages remain
   development evidence. Do not wire them, a JSON store or a generic
   records-only CRUD path to satisfy `works.*`.

Until those land, the package is an offline-validated schema declaration: it
does not claim install, migration execution, adoption or runtime acceptance.



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
