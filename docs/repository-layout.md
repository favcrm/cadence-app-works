# Repository layout

Status: WRK-1 scaffold, WRK-2 read-only content surface and WRK-3 host content
contract v0 with a test-only fixture. No host integration, app writes or release.

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
      host.mjs             # test-only in-memory host contract fixture
    screens/
      works.mjs            # dependency-free read surface
      works.css            # layout classes over the host token/kit contract
  tests/
    content.test.mjs       # reader, gate and defensive-copy tests
    host-contract.test.mjs # host contract conformance
  docs/
    host-contract.md       # transport-agnostic content contract v0
    content-model.md       # proposed content/revision/review/export/query model
    agent-contract.md      # proposed master/chat/CLI contract; tool calls deferred
    repository-layout.md
  scripts/
    check-scaffold.mjs
  .github/workflows/ci.yml
  package.json             # static dev/check scripts; no dependencies
```

## Boundaries

The Cadence host owns the generic shell, navigation, chat, authorization,
scoped storage, credential custody, approvals, review/export enforcement, agent
tool execution and the CLI. This repository owns content-domain definitions and
screens only behind a verified host contract.

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

## Host contract fixture

`src/contract/host.mjs` is an in-memory reference implementation of
`docs/host-contract.md` used only by `tests/host-contract.test.mjs`. It covers
create/patch, review request/decision, export, soft delete/restore, revision CAS,
idempotency, query and audit. It is not a host, opens no network, is not imported
by `src/screens/` or `dev/`, and does not add app write controls. The host
transport, persistence and real authorization are follow-ups.

## Checks

```sh
node scripts/check-scaffold.mjs
node --test tests/*.test.mjs
```

CI runs both. The scaffold check verifies required files, the `works` manifest
identity/version, the mockup entry, source syntax, no signed preview URL and no
network calls in the read path. It does not prove host compatibility or runtime
behaviour.

## Workflow

Work on a task branch. Check for existing work before opening a duplicate PR.
Report exact revisions, real check exit codes and unimplemented interfaces.
Independent review and pinned host-contract evidence precede releases.

WRK-1 covers the scaffold; WRK-2 covers the read-only surface; WRK-3 covers the
host contract v0 and its fixture. Host implementation, write/review/export UI and
the agent/CLI tool-call command are follow-ups.
