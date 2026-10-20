# Repository layout

Status: WRK-1 scaffold, WRK-2 read-only surface, WRK-3 contract, WRK-4 localhost
reference host and CLI. No Cadence host integration, app writes or release.

```text
cadence-app-works/
  README.md
  AGENTS.md
  app/
    app.md                 # manifest placeholder; not installable
  design/mockup/           # reviewed static reference; not shipped source
  dev/                     # fixture harness; dev-only tokens/kit
    index.html
    dev.mjs
  src/
    content/
      fixtures.mjs         # 10 docs/sheets/decks; dev evidence
      reader.mjs           # read-only list/search/filter/get; review/export state
    contract/
      host.mjs             # reference in-memory host contract
    host/
      server.mjs           # localhost HTTP service; JSON persistence
    screens/
      works.mjs            # dependency-free read surface
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
Cadence host integration. The content CLI is a client for that reference host,
not the master/chat/agent tool-call command.

`app/app.md` is a placeholder. It declares no workflows, screens, actions,
capabilities or provider connections and is not installable. The design mockup is
evidence, not an app bundle; its `tokens.css`, `kit.css` and page layout are not
shipped app CSS.

`dev/` is a fixture harness, not a host. It loads the read-only reader and the
screen, and links the design tokens/kit for local rendering. It makes no Cadence
host calls. IBM Plex is loaded from Google Fonts for design fidelity.

## Read path

`src/content/reader.mjs` returns summaries and defensive copies. It exposes
`list` and `get` only; there is no create, edit, delete, review, approve or export
method. `list` supports text search, kind filter and updated/name sort. `get`
returns the full content plus computed `reviewState`, `exportState` and
`exportReason`.

`src/screens/works.mjs` mounts a Documents list and read-only deck/doc/sheet
detail. It renders review and export state as information; it exposes no action.
It does not import the reference host.

## Host contract and reference service

`src/contract/host.mjs` is the in-memory reference implementation of
`docs/host-contract.md`: create/patch, review request/decision, export, soft
delete/restore, revision CAS, idempotency, query and audit. It is not imported by
`src/screens/` or `dev/`.

`src/host/server.mjs` exposes the same operations over localhost HTTP and
persists snapshots of the reference host to `.data/works.json`. It seeds the
content fixtures on first start. There is no auth and no production persistence.

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
and no network calls in the read path. It does not prove Cadence host
compatibility or production behaviour.

## Workflow

Work on a task branch. Check for existing work before opening a duplicate PR.
Report exact revisions, real check exit codes and unimplemented interfaces.
Independent review and pinned host-contract evidence precede releases.

WRK-1 covers the scaffold; WRK-2 the read-only surface; WRK-3 the contract; WRK-4
the reference host and CLI. Cadence host implementation, write/review/export UI
and agent/CLI tool calls are follow-ups.
