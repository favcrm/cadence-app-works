---
app: works
title: Works
version: '0.3.0'
summary: 'Docs, decks and sheets with review and export gates. Create, edit and review on the host; export receipts only for approved revisions.'
needs:
  connections: []
  capabilities: {}
  views:
    contract: app-views/v1
  requires:
    contracts:
      app-screens: [1]
      screen-records: [1]
      screen-startup: [1]
      app-views: [1]
      app-storage: [1]
listing:
  tagline: Docs, decks and sheets with review and export gates
  icon: assets/works.svg
  category: operations
  tags:
    - documents
    - review
  publisher:
    name: Cadence
  about: Works keeps docs, decks and sheets as revisioned host content. An author edits and requests review; an independent reviewer approves or requests changes; an export receipt is recorded only for the approved current revision. The screen reads and writes Works through the host. The app does not approve its own content.
  can:
    - Create, read, edit and trash docs, decks and sheets
    - Request review of a revision and record the reviewer's decision
    - Record an export receipt for an approved current revision
  screenshots: []
  setup: []
  data:
    stores:
      - Works docs, decks and sheets owned by the host, scoped to the installation's context.
    personal: true
---
# Works

Works is the host-owned content store for docs, decks and sheets. The screen
at `screens/works/` reads and edits Works through the `screen-records.v1` host
operations only. Review and export are host-confirmed decisions: the reviewer
picks approve or changes in a host-drawn confirmation, and an export receipt is
recorded by the host for the approved current revision.

The app does not approve its own content, choose a reviewer, or mark anything
exported. A workflow `document-draft` produces a local text draft; it does not
mutate Works and makes no content-approval claim.

## App-owned storage (0.3.0, AOS-384)

This package owns its logical content schema. `app-storage.json` declares
`app-storage/v1` at `schema_version` 1 with one ordered migration under
`storage/`; the migration's `sha256` is the exact raw-byte digest of that file.
A host refuses the package if the migration is missing or its bytes differ from
the declared hash, and `needs.requires.contracts` must list `app-storage: [1]`
for the descriptor to install at all. `record_kind` is `document`.

The descriptor declares `default_table: null`, no `record_search_columns` and no
`record_write_schema`. There is no generic record list/show/create/update bridge
for Works: the generic read path would bypass the host's trash, revision and
review projection, and a generic write would bypass revision, review and export
authority. A trusted host adapter resolves the explicit logical `documents`
handle, and the nine `works.*` operations are the only interface.

The `documents` table holds only the material the screen reads and writes:
`kind` (`doc`, `deck`, `sheet`), `title`, `tags` and the kind payload columns
`blocks` (doc), `slides` (deck) and `columns`/`rows` (sheet). The host owns the
reserved `id`, `context_id`, `revision`, `created_at` and `updated_at` columns,
plus every owner/author, review, approval, export, trash and history record.
Those authority fields are not app columns, are absent from `app-storage.json`,
and cannot be written through the package.

A flattened row is storage, not the content value: the host reconstructs the
native content object for the kind (`{blocks}`, `{slides}` or `{columns, rows}`)
and omits the other payload columns entirely. Null irrelevant fields must not
enter that object, because the content digest is computed over the native
`{kind,title,content}` value and must match the stored revision digest.

Native Cadence has no app-storage execution runtime and refuses the
syntactically valid `app-storage: [1]` requirement. On the hosted AgenticOS
board (AOS-399) the host serves `works.query`, `works.get`, `works.create`,
`works.patch`, `works.trash` and `works.restore` over this table and keeps the
owner, revisions, review state and trash flag in its own tables; only a board
owner writes. `works.request_review`, `works.review` and `works.export` answer
`review_unavailable` until that host has a verified second-reviewer authority
and the host-drawn review/export confirmation. The offline check in
`scripts/check-scaffold.mjs` proves member shape, checksums and the content
boundary only.
