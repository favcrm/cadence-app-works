# Repository layout

Status: WRK-1 scaffold. Design-first; no runtime.

```text
cadence-app-works/
  README.md
  AGENTS.md
  app/
    app.md                 # manifest placeholder; not installable
  design/mockup/           # reviewed static reference; not shipped source
  docs/
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

Planned after the host contract is frozen: `src/` for domain definitions and the
app screen, `tests/` for contract checks, and package/release tooling. Do not add
empty planned directories or unsupported declarations just to fill the tree.

## Checks

```sh
node --check design/mockup/canvas.js
node scripts/check-scaffold.mjs
```

CI runs the scaffold check on push and pull request. The check verifies required
files, the `works` manifest identity/version, the mockup entry, no signed preview
URL, and JavaScript syntax. It does not prove host compatibility or runtime
behaviour.

## Workflow

Work on a task branch. Check for existing work before opening a duplicate PR.
Report exact revisions, real check exit codes and unimplemented interfaces.
Independent review and pinned host-contract evidence precede releases.

WRK-1 covers this scaffold. The host contract and first runtime surface are
follow-ups; the agent/CLI tool-call command remains host-owned until frozen.
