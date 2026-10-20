# Cadence Works App development

This is the independent `works` app (WRK-1 scaffold, WRK-2 read-only surface),
not a release. Read `README.md`, `docs/repository-layout.md`,
`docs/content-model.md` and `docs/agent-contract.md` before modifying it.
Preserve the installed app identity `works`; the repository name does not change
installation or data identities.

WRK-2 adds a fixture-backed read-only screen and reader. It is development
evidence only: no writes, host integration, review/export actions, agent tools or
CLI. Do not turn the read-only surface into a write surface without a verified
host contract, and do not add a second agent/CLI surface here.

## Boundaries

- The Cadence host owns the generic shell, navigation, chat, authorization,
  scoped storage, credential custody, approvals, review/export enforcement,
  agent tool execution and the CLI.
- Works owns content-domain definitions and screens only behind a verified host
  contract. Do not vendor host controls or copy host Rust/React into this
  repository to force a build.
- The master/chat/CLI tool-call command is still being refined and remains
  host-owned. Do not define a second tool surface, a CLI, or agent orchestration
  here while that command is unsettled.
- `design/mockup/` is static design evidence. It is not shipped app source and
  its local CSS is not the app's production styling.
- No real data, credentials, provider keys, customer content, production
  installs, host rollout or release. No edits to other worktrees or host source
  without an assigned lane.
- Work on a task branch; check existing work before creating a duplicate PR.
  Report exact source/artifact revisions, real check exit codes and
  unimplemented interfaces honestly. Independent review and pinned host contract
  evidence precede releases.

The app manifest is a placeholder: it declares no workflows, screens,
capabilities or provider connections and is not installable.
