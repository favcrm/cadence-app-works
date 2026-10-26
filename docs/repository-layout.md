> Status: `app/` is the installable bundle; `src/`, `dev/`, `scripts/` and the
> reference host are development tooling and are not installed.

# Repository layout

Status: WRK-1 scaffold, WRK-2 read-only surface, WRK-3 contract, WRK-4 reference
host/CLI, WRK-5 dev write surface, WRK-6 installable bundle, WRK-7/8 version
publish, WRK-9/10 host theme and WRK-10 app-owned storage schema. The package
declares `app-storage/v1`; the runtime Works host seam is not implemented.

```text
cadence-app-works/
  README.md
  AGENTS.md
  app/
    app.md                 # manifest: 0.3.0, requires app-storage[1]
    app-storage.json       # app-storage/v1 descriptor and migration checksums
    storage/
      001-documents.json   # create documents + documents_kind index
    workflows/
      document-draft.md    # local text draft; never mutates Works
    screens/works/         # app-screens/v2, screen-records.v1, nine works.*
      screens.json
      client.js
      app.css
    views/
      app-views-v1.json    # data-only list/detail field descriptions
    assets/
      works.svg
  design/mockup/           # reviewed static reference; not shipped source
  dev/                     # fixture harness and dev write page
    index.html
    dev.mjs
    write.html
    write.mjs
    write.css
  src/
    content/
      fixtures.mjs         # 10 docs/sheets/decks; dev evidence
      reader.mjs           # read-only list/search/filter/get; review/export state
    contract/
      host.mjs             # reference in-memory host contract
    host/
      server.mjs           # localhost HTTP service; JSON persistence
      client.mjs           # browser client for the reference host
    screens/
      works.mjs            # dependency-free read surface; opt-in actions
      works-write.mjs      # dev write/review/export actions and dialogs
      works.css            # layout classes over the host token/kit contract
  scripts/
    app-storage.mjs        # offline app-storage descriptor/migration/model check
    check-scaffold.mjs     # bundle, manifest, screen, storage and dev syntax check
    works.mjs              # content CLI over the reference host
  tests/
    app-storage.test.mjs   # descriptor, checksum, migration and model boundaries
    content.test.mjs       # reader, gate and defensive-copy tests
    host-contract.test.mjs # host contract conformance
    host-service.test.mjs  # HTTP persistence and CLI smoke
    publish.test.mjs       # version publish gate
  docs/
    host-contract.md       # content contract and the unported Works host seam
    content-model.md       # installed grammar, app-owned schema, adoption
    agent-contract.md      # proposed master/chat/CLI contract; tool calls deferred
    repository-layout.md
  .data/                   # ignored reference-host state (fixture data only)
  .github/workflows/ci.yml
  .github/workflows/publish.yml
  .github/scripts/publish.mjs
  package.json
```

## Boundaries

The Cadence host owns the production shell, navigation, chat, authorization,
scoped storage, credential custody, approvals, review/export enforcement, agent
tool execution and the CLI. This repository owns the Works content-domain
definitions, the app-owned logical schema and the screen only behind a verified
runtime host contract.

The reference host in `src/host/server.mjs` is local development tooling:
localhost only, no auth, fixture data, JSON state under ignored `.data/`, and no
Cadence host integration. The content CLI and dev write page are clients for that
reference host, not the master/chat/agent tool-call command, and neither is a
fallback for the managed app-storage namespace.

`app/` is the installable bundle. `app/app.md` requires `app-screens[1]`,
`screen-records[1]`, `app-views[1]` and `app-storage[1]` and ships the
`document-draft` workflow, the nine-operation Works screen, data-only views and
the app-owned `documents` schema. Native Cadence has no app-storage execution
runtime and refuses the requirement; hosted v2 admits the `works.*` names but
has no Works backend, slot executor or verified reviewer authority. The design
mockup is evidence, not an app bundle; its `tokens.css`, `kit.css` and page
layout are not shipped app CSS.

`dev/index.html` and `dev/dev.mjs` are the read-only fixture harness. `dev/write.html`,
`dev/write.mjs` and `src/screens/works-write.mjs` are the dev write page. The
write page calls only a loopback reference host and refuses a non-loopback
`host` override before any request; it is not an installed screen. It edits the
title only, preserving existing content, and uses the host's `changes` decision
value.
IBM Plex is loaded from Google Fonts for design fidelity.

## Read path

`src/content/reader.mjs` returns summaries and defensive copies. It exposes
`list` and `get` only; there is no create, edit, delete, review, approve or export
method. `list` supports text search, kind filter and updated/name sort. `get`
returns the full content plus computed `reviewState`, `exportState` and
`exportReason`.

`src/screens/works.mjs` mounts a Documents list and deck/doc/sheet detail. With
no `actions` option it is read-only and host-free. With the explicit write
`actions` option it renders the same detail plus action buttons; only the dev
write page passes that option. It does not import the reference host.

`src/screens/works-write.mjs` imports `src/host/client.mjs`, keeps a synchronous
cache refreshed from the host, and handles create/edit, request review/review,
export, trash/restore, stale conflicts and explicit actor/reviewer inputs. The
write page is development tooling.

## Host contract and reference service

`src/contract/host.mjs` is the in-memory reference implementation of
`docs/host-contract.md`: create/patch, review request/decision, export, soft
delete/restore, revision CAS, idempotency, query and audit.

`src/host/server.mjs` exposes the same operations over localhost HTTP and
persists snapshots of the reference host to `.data/works.json`. It seeds the
content fixtures on first start. There is no auth and no production persistence.

`src/host/client.mjs` maps the HTTP routes for the browser write page.
`scripts/works.mjs` is a JSON CLI for list/query/show/create/patch/trash/restore/
request-review/review/export/audit. Writes take `--actor` and `--key`;
patch/trash/restore take `--if-revision`.

## App-owned storage

`app/app-storage.json` declares `app-storage/v1` at `schema_version` 1 with one
migration, `storage/001-documents.json`, whose raw-byte `sha256` is pinned in the
descriptor. The `documents` table holds only `kind`, `title`, `tags`, `blocks`,
`slides`, `columns` and `rows`; the host reserves `id`, `context_id`, `revision`,
`created_at` and `updated_at`, and review/export/owner/history state stays in
host tables. The exact contract, digest split, adoption mapping and
material-change invalidation rule are in `docs/content-model.md` and
`docs/host-contract.md`.

`scripts/app-storage.mjs` checks descriptor shape, contiguous versions,
raw-byte migration checksums, operation grammar, base/authority column refusal,
bounds, default/search columns and the Works content boundary. It is offline
package validation only; the host's app-storage validator owns execution.

## Checks

```sh
npm run check   # check-scaffold.mjs then node --test tests/*.test.mjs
```

CI runs both. The force exit closes undici keep-alive sockets after the tests'
servers are closed. The scaffold check verifies required files, manifest
identity/version, the `app-storage` members and checksums, the nine `works.*`
screen operations, the content boundary, shipped-byte exclusions and dev source
syntax. It does not prove host compatibility or production behaviour.
`cadence app check app` is the host's authoritative validator; a native host
older than `app-storage` refuses the new members, so that check is expected to
fail until a host with the AOS-384 grammar is the target.

## Workflow

Work on a task branch. Check for existing work before opening a duplicate PR.
Report exact revisions, real check exit codes and unimplemented interfaces.
Independent review and pinned host-contract evidence precede releases.

WRK-1 covers the scaffold; WRK-2 the read-only surface; WRK-3 the contract; WRK-4
the reference host and CLI; WRK-5 the dev write surface; WRK-6 the installed
bundle; WRK-7/8 version publishing; WRK-9/10 host theming; WRK-10 the app-owned
storage schema. The runtime Works host seam, production write UI and agent/CLI
tool calls remain follow-ups.
