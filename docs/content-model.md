> Status: the installed bundle owns its logical content schema through
> `app/app-storage.json` and `app/storage/001-documents.json`; the host executes
> it. The actor/on-behalf-of, revision, review and export fields below are host
> authority: they are never child-supplied and never app columns. The reference
> host is development evidence.

# Content model

Status: WRK-1 to WRK-5 established the design and the reference host. WRK-6
made `app/` the installable bundle and WRK-10 gave that bundle its app-owned
logical storage schema (`app/app-storage.json`, `app/storage/001-documents.json`)
with the installed content grammar documented below. The hosted v2 runtime does
not yet execute the Works domain operations or host authority; the reference
host and fixtures remain development evidence, not production. Names are
illustrative until a verified runtime host contract exists.

## Kinds

- **doc** — ordered blocks: heading, paragraph, callout, table, image.
- **deck** — ordered slides; each slide has a layout, blocks and speaker notes.
- **sheet** — tabs of rows, columns and cells; values, formulas and formatting.
- **collection** — an ordered set of content references, e.g. a board packet.
- **tag** and **link** — retrieval and relationship metadata.

All content has a stable id, kind, title, workspace, owner, created/updated
timestamps, tags, optional collection and audit history.

## Installed content grammar and app-owned storage (WRK-10)

The installed screen and the native host support three kinds only — `doc`,
`deck` and `sheet`. `collection`, `tag`/`link` records and the table/image block
shapes above are not part of the installed content grammar.

The content object is closed and kind-specific:

- `doc` — `blocks`: a non-empty array of `{type, text}` with `type` one of
  `h2`, `p`, `callout`, and an optional non-empty `label` on `callout`.
- `deck` — `slides`: a non-empty array of `{title, body, notes?}`.
- `sheet` — non-empty string `columns`, and `rows` arrays whose length matches
  the columns; cells are strings or numbers.

The host validates the object before a write, including the 65536-byte content
bound, title (240 bytes, trimmed, non-empty), at most 20 tags of at most 60
bytes, and unknown kinds/fields/blocks. This is the canonical grammar in
`src/store/app_works.rs`; the app does not redefine it.

`app/app-storage.json` declares `app-storage/v1` at `schema_version` 1 with one
ordered migration, `app/storage/001-documents.json`; the descriptor holds that
file's raw-byte `sha256`. `needs.requires.contracts` includes
`app-storage: [1]`. One logical table carries the material the screen reads and
writes:

| Column | Type | Bound |
|---|---|---|
| `kind` | text, not null | `doc`, `deck` or `sheet` |
| `title` | text, not null | 240 characters |
| `tags` | json, not null, default `[]` | at most 20 unique non-empty strings of at most 60 characters |
| `blocks` | json, nullable | doc only |
| `slides` | json, nullable | deck only |
| `columns` | json, nullable | sheet only |
| `rows` | json, nullable | sheet only |

The host allocates `id`, `context_id`, `revision`, `created_at` and
`updated_at`; the package does not declare them. Exactly the kind's payload
columns are non-null. `documents_kind` is a non-unique index on `kind`, and
`record_bytes` is the host ceiling (262144) because the native grammar already
bounds a kind payload to 65536 bytes while JSON escaping can grow the stored
row.

The payload columns intentionally carry no `json_schema`: the host's bounded
JSON Schema value limits (256 array items, 4096 nodes) are narrower than the
native Works grammar, so a deck or sheet the native host accepted must not be
rejected at adoption. `record_kind` is `document` and `default_table` is
`documents`. `record_write_schema` is `false` and `record_search_columns` is
`["title", "tags"]`: the generic record bridge cannot write Works content, and
the nine `works.*` host operations are the only write path.

### Adoption and material change

Existing native Works ids, revisions, authors, audit rows, idempotency records
and review/export references survive adoption:

- `documents.id`, `context_id`, `revision`, `created_at` and `updated_at` keep
  the native item values; `kind`, `title`, `tags` and the current revision's
  payload map onto the columns above.
- Each native immutable revision keeps its revision number, author, timestamp,
  kind, title and content snapshot in a host-owned history table. The content
  digest is recomputed from the same canonical `{kind,title,content}` value
  (tags excluded) and must equal the stored native digest; a mismatch refuses
  adoption instead of silently rewriting a review or export reference. The
  separate idempotency payload digest covers `{kind,title,content,tags}`.
- `owner`, `reviewed_revision`, `review_status`, `pending_revision` and
  `trashed` remain host authority and never become `documents` columns.
- An approved current revision stays approved after adoption only while its
  material digest is unchanged. A package migration that changes material
  (`add_column` or `backfill`; anything except `create_index`) makes the host
  recompute every document digest. A changed digest clears the approval
  (`review_status = none`, `reviewed_revision = 0`, `pending_revision = null`),
  appends an audit row, and leaves older export receipts stale. Export then
  refuses with `needs_review` until a distinct reviewer approves the current
  revision. A migration never creates a Works revision and never approves
  content.

## Revisions

- Edits create **immutable revisions**; the document points at the current one.
- A revision records the author actor, on-behalf-of principal, parent revision,
  timestamp and change summary.
- Writes carry `if_revision` (optimistic concurrency) and an idempotency key.
  A stale write fails and must re-read; it never overwrites.
- Cross-content work is a **change set**: plan, dry-run diff, apply, one review
  bundle, one export bundle.

## Review and export gate

- `reviewed_revision` pins the last approved revision.
- States: `none`, `pending`, `approved`, `changes_requested`.
- Approval is a separate authority. The author of a revision cannot approve it.
  An agent may review other authors' content only when it is an independent,
  delegated reviewer.
- Any edit after approval makes `reviewed_revision != current`; export is
  blocked. The UI shows the reviewed and current revision and the changes.
- Export succeeds only for `reviewed_revision == current`; it records format,
  revision, actor, timestamp and watermark/notes options.
- **Delete is soft**: trash, restore, audit. Purge and permission changes are
  operator-only.

## Typed operations

```text
create(kind, title, template?, collection?, tags?)
patch(id, if_revision, operations[])
  doc.block.replace/insert/delete/move
  deck.slide.insert/delete/move/patch; deck.notes.set
  sheet.cell.set; sheet.range.set; sheet.formula.set
move(id, collection|position)
link(from, to, kind); tag(id, tags)
trash(id, if_revision); restore(id, if_revision)
request_review(id, revision, reviewers)
review(id, revision, decision, note)     # separate authority
export(id, revision, format)
batch(change_set, dry_run)               # cross-content
```

No raw text replacement and no direct database access. A caller reads the
outline/range first and patches typed targets, so a model cannot silently rewrite
unrelated content.

## Query

```text
kind:deck review:pending export:blocked tag:q3 updated:>7d text:"retention"
```

- Filters: kind, state, review, export, tag, owner, updated, linked-to, has,
  text; sort; limit; stable cursor; facets.
- Results return `id, kind, title, rev, review, export, owner, tags, snippet,
  links, updated`, not whole documents.
- Natural language becomes a structured query for chat/master agents; the CLI
  uses the same grammar.
- Sheets add typed range/table reads; answers cite the cell or range. No raw SQL
  against the content store.
- Retrieval is permission-filtered and workspace-scoped. The model never receives
  the whole workspace.

## Deferred

Runtime implementation, the host content contract, authentication/permissions,
agent tool execution, the CLI command, semantic search, collaboration and
retention policy are outside this scaffold.
