# Cadence Works App

Private repository for the independent Cadence **Works** app: docs, sheets and
decks with revisioned review and export gates. The app identity is `works`; the
repository name does not change installation or data identities.

## Status

v0.1 design-first scaffold (WRK-1). This is **not** an installable app. It has no
runtime content, review/export backend, agent tools or CLI. The reviewed UX is a
static reference; application source follows behind a verified Cadence host
contract.

## What is here

| Path | Purpose |
|---|---|
| `design/mockup/` | Static reference for the reviewed Documents → New → Deck/Doc/Sheet → Review → Export flow |
| `app/app.md` | Manifest placeholder; no workflows, screens or capabilities claimed |
| `docs/content-model.md` | Proposed docs/sheets/decks model, revisions, review/export gate and query |
| `docs/agent-contract.md` | Proposed master/chat/CLI capability matrix, use cases and guardrails; tool calls deferred |
| `docs/repository-layout.md` | Host/app boundaries and planned layout |
| `scripts/check-scaffold.mjs` | Static scaffold check used by CI |

The mockup is design evidence only. It is not shipped app source and the app
screen will use the host-injected UI kit, not the mockup's local CSS.

## Run the design reference

```sh
python3 -m http.server 4173 --directory design/mockup
# http://127.0.0.1:4173/?flow=documents&theme=dark
```

The top flow bar is a mockup control, not product navigation. Direct states:

```text
?flow=documents|new|deck|doc|sheet|review|export
&flow=export&approved=1    ready export
&flow=review&approved=1    approved review
&flow=deck&apply=1         chat apply; review invalidated
&flow=new&create=1         create a draft
&theme=light               light theme
```

## Check

```sh
node --check design/mockup/canvas.js
node scripts/check-scaffold.mjs
```

CI runs the same checks. No install step is required.

## Boundaries

- The Cadence host owns the shell, navigation, chat, authorization, scoped
  storage, credential custody, approvals, review/export enforcement, agent tool
  execution and the CLI.
- Works owns content-domain definitions and screens only behind a verified host
  contract.
- The master/chat/CLI tool-call command is still being refined. This repository
  does not define or implement a second tool surface.
- No real data, credentials, provider calls, production installs or release.

## Next

1. Freeze the host contract for content read/write, revisions, review and export.
2. Add the basic app screen behind that contract.
3. Add agent/CLI tools only after the host tool-call command is frozen.

WRK-1 covers this scaffold. Follow-up tickets cover the host contract and the
first runtime surface.
