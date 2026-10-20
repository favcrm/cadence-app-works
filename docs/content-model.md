# Content model (proposed)

Status: design input for WRK-1. WRK-2 implements only a fixture-backed read
subset in `src/content/`: summaries, list/search/kind filter, get, defensive
copies and computed review/export state. Writes, review/approval, export
execution, the full query grammar and host integration remain proposed. Names are
illustrative until a verified Cadence host contract exists.

## Kinds

- **doc** — ordered blocks: heading, paragraph, callout, table, image.
- **deck** — ordered slides; each slide has a layout, blocks and speaker notes.
- **sheet** — tabs of rows, columns and cells; values, formulas and formatting.
- **collection** — an ordered set of content references, e.g. a board packet.
- **tag** and **link** — retrieval and relationship metadata.

All content has a stable id, kind, title, workspace, owner, created/updated
timestamps, tags, optional collection and audit history.

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
