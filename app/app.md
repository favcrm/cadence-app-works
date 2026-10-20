---
app: works
title: Works
version: '0.1.0'
summary: 'Docs, sheets and decks with revisioned review and export gates; design-first scaffold, host-owned content actions.'
needs:
  connections: []
---

# Works

Design-first scaffold for the Works app. The reviewed flow is Documents → New →
Deck / Doc / Sheet → Review → Export, with a static reference in
`design/mockup/`.

Status: **not installable**. This bundle declares no workflows, screens, actions,
capabilities or provider connections. It is a manifest placeholder so the app
identity and host/app boundary are explicit before the host contract is frozen.

Content reads/writes, typed revisions, review and export enforcement, agent tool
execution and the CLI are host-owned. The app does not approve its own content:
the authoring surface requests review and exports only an approved current
revision. Deletion is soft; purge and permission changes are operator-only.
