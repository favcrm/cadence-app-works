# Cadence Works App development

This is the independent `works` app (WRK-1 scaffold, WRK-2 read-only surface,
WRK-3 contract, WRK-4 reference host/CLI), not a release. Read `README.md`, `docs/repository-layout.md`,
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
production host. The reference host is not imported by `src/screens/` or `dev/`;
it adds no app write controls. Do not wire it into the app UI or present it as
Cadence host integration.

## Boundaries

- The Cadence host owns the generic shell, navigation, chat, authorization,
  scoped storage, credential custody, approvals, review/export enforcement,
  agent tool execution and the CLI.
- Works owns content-domain definitions and screens only behind a verified host
  contract. Do not vendor host controls or copy host Rust/React into this
  repository to force a build.
- The master/chat/CLI agent tool-call command is still being refined and remains
  host-owned. Do not define that command, agent orchestration or a second agent
  tool surface here. The content CLI in `scripts/works.mjs` is only a client for
  the local reference host.
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

The app manifest is a placeholder: it declares no workflows, screens,
capabilities or provider connections and is not installable.
