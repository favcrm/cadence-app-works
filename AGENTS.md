# Cadence Works App development

This is the independent `works` app (WRK-1 scaffold, WRK-2 read-only surface,
WRK-3 contract, WRK-4 reference host/CLI, WRK-5 dev write surface, WRK-6
installable bundle), not a release. Read `README.md`, `docs/repository-layout.md`,
`docs/content-model.md` and `docs/agent-contract.md` before modifying it.
Preserve the installed app identity `works`; the repository name does not change
installation or data identities.

WRK-2 adds a fixture-backed read-only screen and reader. It is development
evidence only: no app writes, host integration, review/export actions or agent
tools. Do not turn the read-only surface into a write surface without a verified
host contract.

WRK-3 adds `docs/host-contract.md` and the reference in-memory host in
`src/contract/host.mjs` for create/patch, review, export, soft delete, revisions,
CAS and audit.

WRK-4 adds `src/host/server.mjs`, a localhost reference host with JSON state, and
`scripts/works.mjs`, a content CLI. These are development tools, not the Cadence
production host. The read-only screen and `dev/` are host-free.

WRK-5 adds `src/host/client.mjs` and a dev-only write/review/export page
(`src/screens/works-write.mjs`, `dev/write.html`, `dev/write.mjs`,
`dev/write.css`). It calls only the local reference host. It is not the Cadence
production host, not an installed screen and does not change `app/app.md` or the
read-only `src/screens/works.mjs` default. Do not present it as host integration.

WRK-6 adds the installable `app/` bundle: a real manifest, one local
`document-draft` workflow, `screens/works/` (`app-screens/v2`,
`screen-records.v1`, the nine `works.*` operations) and data-only views. It
calls the Cadence screen host; the reference host and dev pages remain
development evidence and are not installed. The installed screen never
supplies an actor or reviewer identity.

## Boundaries

- The Cadence host owns the generic shell, navigation, chat, authorization,
  scoped storage, credential custody, approvals, review/export enforcement,
  agent tool execution and the CLI.
- Works owns content-domain definitions and screens only behind a verified host
  contract. Do not vendor host controls or copy host Rust/React into this
  repository to force a build.
- The master/chat/CLI agent tool-call command is still being refined and remains
  host-owned. Do not define that command, agent orchestration or a second agent
  tool surface here. The content CLI in `scripts/works.mjs` and the dev write
  page are only clients for the local reference host.
- `design/mockup/` is static design evidence. It is not shipped app source and
  its local CSS is not the app's production styling.
- No real data, credentials, provider keys, customer content, production
  installs, host rollout or release. The reference host's `.data/` state is
  fixture data only. No edits to other worktrees or host source without an
  assigned lane.
- Work on a task branch; check existing work before creating a duplicate PR.
  Report exact source/artifact revisions, real check exit codes and
  unimplemented interfaces honestly. Independent review and pinned host contract
  evidence precede releases.

The app manifest (`app/app.md`, `0.2.0`) is the installable bundle. It requires
`app-screens[1]`, `screen-records[1]` and `app-views[1]`, declares no
connections or capabilities and ships the `document-draft` text workflow and
the `screens/works/` screen. The shipped screen and views must not contain
localhost, reference-host, fixture or actor-picker terms; `scripts/check-scaffold.mjs`
and `cadence app check app` enforce that.

WRK-6 replaces the reference-host client path in `app/screens/works/` with the
generic screen bootstrap and MessagePort protocol. The reference host, CLI and
dev write page remain dev-only tools outside shipped assets; do not present
them as the product path.
