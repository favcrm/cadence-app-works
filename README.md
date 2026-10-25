# Cadence Works App

Private repository for the independent Cadence **Works** app: docs, sheets and
decks with revisioned review and export gates. The app identity is `works`; the
repository name does not change installation or data identities.

## Status

WRK-6 makes `app/` an installable bundle (`0.2.0`):

- `app/app.md`: manifest. Requires `app-screens[1]`, `screen-records[1]` and
  `app-views[1]`. Declares no connections and no capabilities.
- `app/workflows/document-draft.md`: a local text-draft workflow. It produces
  draft text for a person to paste into Works. It does not mutate Works and
  makes no content-approval claim.
- `app/screens/works/`: the Works screen (`screens.json` with `app-screens/v2`
  and `screen-records.v1`, `client.js`, `app.css`). It calls only the nine
  `works.*` host operations declared in `screens.json`. Review and export are
  host-confirmed slots. The screen has no localhost, reference-host or actor
  input.
- `app/views/app-views-v1.json`: data-only list and detail views.
- `app/assets/works.svg`: listing icon.

The host, not the app, decides who may author, review, approve or export.

## Installable bundle

```sh
cadence app check app                                  # offline package validation; exit 0 on pass
cadence app catalog install-check <bundle>             # prints the digest, name, version, file list
cadence app catalog install <bundle> --expected-digest <digest>
cadence app catalog approve <install-id> --digest <digest>
cadence app context create <options>                   # optional content defaults; see --help
```

Install, approval and context are host operations gated by the operator's
verified session. This repository does not run them.

## Dev-only reference tools

The files below are development tooling. They are **not** shipped app assets,
are not referenced by `app/screens/works/`, and do not claim Cadence host
integration:

| Path | Purpose |
|---|---|
| `design/mockup/` | Static design evidence for the Documents -> New -> Deck/Doc/Sheet -> Review -> Export flow |
| `src/content/` | Read-only content fixtures and reader |
| `src/contract/` | Reference in-memory host implementation of `docs/host-contract.md` |
| `src/host/server.mjs` | Localhost reference host service (JSON state, no auth) |
| `src/host/client.mjs` | Browser client for the reference host |
| `src/screens/works.mjs` | Dev-only read-only surface |
| `src/screens/works-write.mjs` | Dev-only write/review/export actions over the reference host |
| `scripts/works.mjs` | CLI for the reference host |
| `dev/` | Read-only fixture harness plus the dev write page |
| `tests/` | Reader, contract, reference-host and CLI tests |
| `docs/` | Host content contract v0, content model, agent contract |

## Run the dev read-only surface

```sh
python3 -m http.server 4173
# http://127.0.0.1:4173/dev/
# http://127.0.0.1:4173/design/mockup/
```

## Run the reference host (dev only)

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

## Run the dev write surface (dev only)

```sh
node src/host/server.mjs
python3 -m http.server 4173
# http://127.0.0.1:4173/dev/write.html
# optional: ?host=http://127.0.0.1:4174&theme=light
```

Only loopback hosts are accepted. The page takes an explicit actor string, which
is valid only for this dev reference host and must never appear in the shipped
screen. It is not an installed screen.

## Check

```sh
node scripts/check-scaffold.mjs            # package validation: bundle, manifest, workflow, views, screen digests, dev-tool syntax
node --test --test-force-exit tests/*.test.mjs
cadence app check app                      # host validator; exit 0 on pass
```

CI runs the first two. `cadence app check app` runs the host's offline
validator and is the authoritative package check. The force exit is for
undici's keep-alive sockets; the test servers are closed before exit.

## Boundaries

- The reference host is local development tooling: no auth, no real data, no
  production persistence and no Cadence host integration.
- The shipped screen has no reference host, fixture or actor input. Its
  create/edit/trash/restore/review/export controls call only host operations.
- The dev write page is not an installed screen and is not shipped.
- No host changes, credentials, provider calls, installs or releases from this
  repository.

## Next

1. Install and mount the bundle through the standard screen host, and exercise
   create/read/patch/review/export/trash/restore against the merged host.
2. Add agent/CLI tool calls only after the host tool-call command is frozen.

WRK-1 scaffold, WRK-2 read-only surface, WRK-3 contract/fixture, WRK-4 reference
host/CLI, WRK-5 dev write surface, WRK-6 installable bundle.

## Publish

`app.md` is the release manifest; its `listing` block is the catalogue copy.
Tag `vX.Y.Z`, or run the `publish` workflow manually, and the workflow:

1. runs `cadence app check app` and builds the catalogue entry from the
   manifest (no `catalogue.json`, no hand-written `upload.json`);
2. installs the **target** Cadence release — the `cadence_version` input or the
   `CADENCE_TARGET_VERSION` repository variable, else latest — starts a clean
   temporary daemon, and runs `cadence app catalog install-check app`;
3. refuses before publishing when the target host cannot install the bundle
   (missing contract or assistant action), and otherwise publishes through
   GitHub OIDC (or opens the fallback marketplace PR).

`DRY_RUN=1 APP_CHECK_JSON=/tmp/app-check.json APP_INSTALL_CHECK_JSON=/tmp/app-install-check.json node .github/scripts/publish.mjs` prints the entry and artifact hash
without writing; the install-check report is required even for a dry run. The gate is the target host, not only the offline bundle check.
