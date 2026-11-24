# Cadence Works App

Private repository for the independent Cadence **Works** app for revisioned
docs, sheets and decks. The app identity is `works`; the repository name does
not change installation or data identities.

## Status

Works 0.3 adds app-owned logical storage. Version 0.3.1 removes the unused
`app-views/v1` declaration and data file: the hosted board displays the Works
screen and does not serve that contract. The hosted AgenticOS board serves
content operations (AOS-399), not review or export. See `docs/host-contract.md`.

- `app/app.md`: manifest. Requires `app-screens[1]`, `screen-records[1]`,
  `screen-startup[1]` and `app-storage[1]`. Declares no connections or
  capabilities.
- `app/app-storage.json` and `app/storage/001-documents.json`: the
  `app-storage/v1` descriptor and its one raw-byte-checksummed migration. They
  declare the `documents` content table (`kind`, `title`, `tags`, `blocks`,
  `slides`, `columns`, `rows`), `record_kind: "document"`, `default_table: null`
  and no generic record read/write bridge, and no review/export/actor columns.
  The migration creates the table and the `documents_kind` index.
- `app/workflows/document-draft.md`: a local text-draft workflow. It produces
  draft text for a person to paste into Works. It does not mutate Works and
  makes no content-approval claim.
- `app/screens/works/`: the Works screen (`screens.json` with `app-screens/v2`
  and `screen-records.v1`, `client.js`, `app.css`). It calls only the nine
  `works.*` host operations declared in `screens.json`. Review and export are
  host-confirmed slots. The screen has no localhost, reference-host or actor
  input.
- `app/assets/works.svg`: listing icon.

The host, not the app, decides who may author, review, approve or export.
`scripts/check-scaffold.mjs` and `scripts/app-storage.mjs` prove package member
shape, migration checksums and the content boundary offline; they do not prove
runtime install, migration execution, adoption or review/export.

## Installable bundle

```sh
cadence app check app                                  # offline package validation; exit 0 on pass
cadence app catalog install-check <bundle>             # prints the digest, name, version, file list
cadence app catalog install <bundle> --expected-digest <digest>
cadence app catalog approve <install-id> --digest <digest>
cadence app context create <options>                   # optional content defaults; see --help
```

Install, approval and context are host operations gated by the operator's
verified session. This repository does not run them. A host older than the
declared contracts refuses the bundle. Native Cadence has no app-storage
execution runtime and refuses the `app-storage: [1]` requirement; hosted v2
serves the six content operations over the `documents` schema (AOS-399) but has
no review/export slot executor or verified reviewer authority yet. No install,
adoption or hosted review/export is claimed here.

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
cadence app check app                      # authoritative host validator; a pre-AOS-384 native host refuses app-storage
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
From 0.3.0 the package declares `app-storage: [1]`, so it is a hosted-only
release: native Cadence refuses that requirement. Push the tag `vX.Y.Z` that
matches `app.md` (the version is bound to the tag), and the `publish` workflow:

1. installs the exact Cadence release named by the `cadence_version` input or
   the `CADENCE_TARGET_VERSION` repository variable (no "latest") and runs
   `cadence app check app` for the canonical digest and inventory, accepting
   exit 3 only when the sole refusal is the hosted-only `app-storage`
   (`.github/scripts/assert-app-check.py`);
2. builds the catalogue entry from the manifest and scans every uploaded member
   with `cadence secret scan`;
3. delivers the exact bundle to the hosted catalogue's
   `/public/apps/candidates` with a GitHub OIDC token. The catalogue binds this
   repository, workflow and tag to the `works` app id, re-verifies the bytes
   and lists that version. Listing is not installation.

The catalogue refuses publication with `app_disabled` while Works is disabled.
For an authorized cutover, use the v2 operator registry script
(`apps/api/scripts/catalogue-registry.ts` on deployed `main`):

1. With Works still disabled, run `set-release --app works --version <version>
   --publication disabled` for each older published version. Confirm each
   release's publication state in the managed catalogue; the public directory
   reports only `app_disabled` while the app is disabled.
2. Run `set-app --id works --availability enabled`. The console's **Enable app**
   button requires a published release, so it cannot perform this step. If the
   operator registry route is unavailable, leave Works disabled.
3. Confirm `/public/apps/works/versions` has no recommended version and every
   old release reports `release_disabled`. Then push the new tag. Match the
   publish receipt's digest to the installable, recommended version in that
   same directory. If publication fails, check whether it landed before
   retrying; restore app-level `disabled` if the cutover cannot complete.
   Do not re-enable old releases.

For registry commands, `--remote` alone prints a plan. Applying to production
also requires `--apply --confirm-account <account-id>` and operator
authorization.

`DRY_RUN=1 APP_CHECK_JSON=/tmp/app-check.json node .github/scripts/publish.mjs`
on a matching tag ref prints the entry and artifact hash without sending.

## Screen build and verify

The installed screen in `app/screens/works/` is built from `src/screen/` on the
pinned `@cadence/app-kit` (vendored in `app-kit/`) and `@cadence/screen-ui`
(`.cadence-ui/cadence-screen-ui-1.0.0.tgz`, recorded in `screen-ui.lock.json`).

```bash
# once per clone: unpack the pinned SDK archive (CI does this with a strict check)
mkdir .cadence-ui/package && tar -xzf .cadence-ui/cadence-screen-ui-1.0.0.tgz -C .cadence-ui
pnpm install --frozen-lockfile
pnpm typecheck && pnpm build && pnpm verify && pnpm test
```

`.cadence-ui/package` is ignored by git. Rebuild and commit `app/screens/works/`
whenever `src/screen/`, `scripts/*.mjs`, `app/app.md`, `package.json`, the
lockfiles or `app-kit/` change; `pnpm verify` compares the declared sha256 and
source digest. The build needs the exact Node version in `screen-ui.lock.json`.
`pnpm preview` serves a synthetic host on port 3188 (use a browser that allows
`localhost`).
