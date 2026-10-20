# Repository layout

Status: WRK-1 scaffold, WRK-2 read-only surface, WRK-3 contract, WRK-4 reference
host/CLI, WRK-5 dev write surface. No Cadence host integration, installable app
or release.

```text
cadence-app-works/
  README.md
  AGENTS.md
  app/
    app.md                 # manifest placeholder; not installable
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
    check-scaffold.mjs
    works.mjs              # content CLI over the reference host
  tests/
    content.test.mjs       # reader, gate and defensive-copy tests
    host-contract.test.mjs # host contract conformance
    host-service.test.mjs  # HTTP persistence and CLI smoke
  docs/
    host-contract.md       # transport-agnostic content contract v0
    content-model.md       # proposed content/revision/review/export/query model
    agent-contract.md      # proposed master/chat/CLI contract; tool calls deferred
    repository-layout.md
  .data/                   # ignored reference-host state (fixture data only)
  .github/workflows/ci.yml
  package.json
```

## Boundaries

The Cadence host owns the production shell, navigation, chat, authorization,
scoped storage, credential custody, approvals, review/export enforcement, agent
tool execution and the CLI. This repository owns content-domain definitions and
screens only behind a verified production host contract.

The reference host in `src/host/server.mjs` is local development tooling:
localhost only, no auth, fixture data, JSON state under ignored `.data/`, and no
Cadence host integration. The content CLI and dev write page are clients for that
reference host, not the master/chat/agent tool-call command.

`app/app.md` is a placeholder. It declares no workflows, screens, actions,
capabilities or provider connections and is not installable. The design mockup is
evidence, not an app bundle; its `tokens.css`, `kit.css` and page layout are not
shipped app CSS.

`dev/index.html` and `dev/dev.mjs` are the read-only fixture harness. `dev/write.html`,
`dev/write.mjs` and `src/screens/works-write.mjs` are the dev write page. The
write page calls only the local reference host; it is not an installed screen.
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

## Checks

```sh
node scripts/check-scaffold.mjs
node --test --test-force-exit tests/*.test.mjs
```

CI runs both. The force exit closes undici keep-alive sockets after the tests'
servers are closed. The scaffold check verifies required files, the `works`
manifest identity/version, the mockup entry, source syntax, no signed preview URL
and no host imports or network calls in the read-only path. It does not prove
Cadence host compatibility or production behaviour.

## Workflow

Work on a task branch. Check for existing work before opening a duplicate PR.
Report exact revisions, real check exit codes and unimplemented interfaces.
Independent review and pinned host-contract evidence precede releases.

WRK-1 covers the scaffold; WRK-2 the read-only surface; WRK-3 the contract; WRK-4
the reference host and CLI; WRK-5 the dev write surface. Cadence host
implementation, production write UI and agent/CLI tool calls are follow-ups.
