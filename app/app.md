---
app: works
title: Works
version: '0.8.0'
summary: Create and edit revisioned docs, decks and sheets in a hosted workspace.
needs:
  connections: []
  capabilities: {}
  requires:
    contracts:
      app-screens: [1]
      screen-records: [1]
      screen-startup: [1]
      app-storage: [1]
listing:
  tagline: Revisioned docs, decks and sheets for your workspace
  icon: assets/works.svg
  category: operations
  tags:
    - documents
  publisher:
    name: Cadence
  about: Works keeps revisioned docs, decks and sheets in a hosted workspace. Create and edit rich docs with tables, formula-driven spreadsheets, and multi-slide decks; import and export PDF, DOCX, XLSX, PPTX, Markdown, CSV, and HTML; restore trashed items or earlier revisions; and submit deliverables straight to Documents.
  can:
    - Browse and read docs, decks and sheets as a board member
    - Create, edit, trash, restore and inspect revision history as a board owner
    - Import and export PDF, DOCX, XLSX, PPTX, Markdown, CSV, and HTML deliverables
    - Submit finalized PDF or Office deliverables to the hosted Documents approval lifecycle
  screenshots: []
  setup: []
  data:
    stores:
      - Works docs, decks and sheets owned by the host, scoped to the installation's context.
    personal: true
---
# Works

Works stores revisioned docs, decks and sheets in the hosted workspace. The
screen at `screens/works/` reads and edits through the `screen-records.v1`
host operations only. This release does not support review or export.

The `document-draft` workflow produces local draft text. It does not mutate
Works or approve content.

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
