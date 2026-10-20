# Cadence Works App

Private repository for the independent Cadence **Works** app: docs, sheets and
decks with revisioned review and export gates. The app identity is `works`; the
repository name does not change installation or data identities.

## Status

v0.4 reference host + CLI (WRK-4). This is **not** an installable app and has no
Cadence host integration. The read-only surface is unchanged. The v0 content
contract now runs behind a localhost reference host with JSON persistence and a
CLI; the service is development tooling, not the production Cadence host. No app
write/review/export controls and no agent tool-call command are added.

## What is here

| Path | Purpose |
|---|---|
| `design/mockup/` | Static reference for the reviewed Documents → New → Deck/Doc/Sheet → Review → Export flow |
| `src/content/` | Read-only content fixtures and reader: list/search/filter/get, review/export state |
| `src/contract/` | Reference in-memory host: create/patch, review, export, soft delete, CAS, idempotency and audit |
| `src/host/` | Localhost reference host service over the contract; JSON state |
| `src/screens/` | Dependency-free read-only Documents and detail surface |
| `scripts/works.mjs` | CLI for the reference host |
| `dev/` | Development harness over the fixture reader; dev-only tokens/kit |
| `tests/` | Reader, contract, reference-host and CLI tests |
| `app/app.md` | Manifest placeholder; no workflows, screens or capabilities claimed |
| `docs/host-contract.md` | Transport-agnostic host content contract v0 |
| `docs/content-model.md` | Proposed docs/sheets/decks model, revisions, review/export gate and query |
| `docs/agent-contract.md` | Proposed master/chat/CLI capability matrix; tool-call command deferred |

The mockup, dev harness and reference host are development evidence only. The
app screen stays read-only; the reference host is not imported by it.

## Run the read-only surface

```sh
python3 -m http.server 4173
# http://127.0.0.1:4173/dev/
# http://127.0.0.1:4173/design/mockup/
```

Direct states: `/dev/?id=q3-planning`, `/dev/?id=q3-notes`,
`/dev/?id=q3-budget`, `&theme=light`.

## Run the reference host

```sh
node src/host/server.mjs
# http://127.0.0.1:4174
# state: .data/works.json (ignored; delete it to reseed fixtures)
```

The host binds to localhost, has no auth and is not production. The CLI uses
`WORKS_HOST` (default `http://127.0.0.1:4174`):

```sh
node scripts/works.mjs list --kind deck
node scripts/works.mjs show q3-planning
node scripts/works.mjs create --kind doc --title "Retention addendum" \
  --content ./content.json --actor author-1 --key create-1
node scripts/works.mjs patch retention-addendum --if-revision 1 \
  --operations ./operations.json --actor author-1 --key patch-1
node scripts/works.mjs request-review retention-addendum --revision 2 --actor author-1
node scripts/works.mjs review retention-addendum --revision 2 \
  --decision approve --actor reviewer-1
node scripts/works.mjs export retention-addendum --revision 2 \
  --format pdf --actor reviewer-1
```

`--content` is the kind payload (`blocks`, `slides` or `columns`/`rows`);
`--operations` is a JSON array such as
`[{"type":"set_title","title":"Retention addendum v2"}]`. Writes require
`--actor` and `--key` (idempotency); patch/trash/restore require
`--if-revision`. The CLI prints JSON and exits non-zero on a host error.

## Check

```sh
node scripts/check-scaffold.mjs
node --test --test-force-exit tests/*.test.mjs
```

CI runs both. The force exit is for undici's keep-alive sockets; the test servers
are closed before exit. The scaffold check also verifies source syntax and keeps
the read-only app free of host imports.

## Boundaries

- The reference host is local development tooling: no auth, no real data, no
  production persistence and no Cadence host integration.
- The app screen has no create/edit/delete/review/export controls and does not
  import the host.
- The CLI is a content client for the reference host, not the master/chat/CLI
  agent tool-call command.
- No host changes, credentials, provider calls, installs or releases.

## Next

1. Implement the v0 contract in the Cadence production host.
2. Add write/review/export UI behind that verified host contract.
3. Add agent/CLI tool calls only after the host tool-call command is frozen.

WRK-1 scaffold, WRK-2 read-only surface, WRK-3 contract/fixture, WRK-4 reference
host/CLI.
