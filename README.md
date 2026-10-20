# Cadence Works App

Private repository for the independent Cadence **Works** app: docs, sheets and
decks with revisioned review and export gates. The app identity is `works`; the
repository name does not change installation or data identities.

## Status

v0.3 host content contract v0 (WRK-3). This is **not** an installable app and
has no host integration. The merged read-only surface still shows Documents →
deck/doc/sheet detail → review/export status, with no actions. WRK-3 adds a
transport-agnostic host contract and an in-memory conformance fixture for
create/patch, review, export, soft delete, revisions and audit. The fixture is
test-only and is not wired into the app.

## What is here

| Path | Purpose |
|---|---|
| `design/mockup/` | Static reference for the reviewed Documents → New → Deck/Doc/Sheet → Review → Export flow |
| `src/content/` | Read-only content fixtures and reader: list/search/filter/get, review/export state |
| `src/contract/` | Test-only in-memory host: create/patch, review, export, soft delete, CAS, idempotency and audit |
| `src/screens/` | Dependency-free read-only Documents and detail surface |
| `dev/` | Development harness over the fixture reader; dev-only tokens/kit |
| `tests/` | Node tests for the reader and the host contract conformance |
| `app/app.md` | Manifest placeholder; no workflows, screens or capabilities claimed |
| `docs/host-contract.md` | Transport-agnostic host content contract v0 |
| `docs/content-model.md` | Proposed docs/sheets/decks model, revisions, review/export gate and query |
| `docs/agent-contract.md` | Proposed master/chat/CLI capability matrix; tool-call command deferred |
| `docs/repository-layout.md` | Host/app boundaries and planned layout |
| `scripts/check-scaffold.mjs` | Static scaffold, source-syntax and no-network-call check |

The mockup and dev harness are design/development evidence only. They are not
shipped app source; the app screen will use the host-injected UI kit.

## Run

From the repository root:

```sh
python3 -m http.server 4173
```

- Read-only surface: `http://127.0.0.1:4173/dev/`
- Design reference: `http://127.0.0.1:4173/design/mockup/`

Read-only direct states:

```text
/dev/                         Documents
/dev/?id=q3-planning          Deck detail
/dev/?id=q3-notes             Doc detail
/dev/?id=q3-budget            Sheet detail
/dev/?id=q3-planning&theme=light
```

The development page loads IBM Plex from Google Fonts. It makes no Cadence host
calls.

## Check

```sh
node scripts/check-scaffold.mjs
node --test tests/*.test.mjs
```

CI runs both. The scaffold check also verifies source syntax and rejects
`fetch`/`XMLHttpRequest` in the read path.

## Read-only boundary

- The reader returns summaries and defensive copies; no create/edit/delete,
  review, approval or export action is exposed in the app.
- Export is only a computed state: edited/draft content is blocked; a reviewed
  current revision is ready.
- `src/contract/host.mjs` is a test-only conformance fixture. It is not imported
  by `src/screens/` or `dev/` and is not a host or a production content service.
- No host integration, persistence, auth, permissions, agent tools or CLI.
- No real data, credentials, provider calls, installs or releases.

## Next

1. Implement the v0 contract in the Cadence host.
2. Add write/review/export UI behind that verified host contract.
3. Add agent/CLI tools only after the host tool-call command is frozen.

WRK-1 covers the scaffold. WRK-2 covers the read-only surface. WRK-3 covers the
host contract and fixture conformance.
