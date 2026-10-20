# Works design reference

Static, canned reference for the reviewed Works flow. No runtime, host calls,
credentials or real content.

**Flow:** Documents → New → Deck / Doc / Sheet → Review → Export.

The top `MOCKUP FLOW` bar is a prototype control, not product navigation. It
jumps between the states below. The chat is canned; Apply changes the local
revision and invalidates review; approval unlocks export.

## States

```text
?flow=documents            Documents home
?flow=new                  New doc / sheet / deck dialog
?flow=deck                 Deck editor + chat proposal
?flow=doc                  Document editor
?flow=sheet                Sheet editor
?flow=review               Review r4 → r5
?flow=export               Export blocked until the current revision is approved
&flow=export&approved=1    Ready export
&flow=review&approved=1    Approved review
&flow=deck&apply=1         Chat apply → r6; review invalidated
&flow=new&create=1         Create a draft
&theme=light               Light theme
```

## Files

- `index.html`, `canvas.js`, `canvas.css` — the reference flow.
- `tokens.css`, `kit.css` — Cadence design tokens/controls used by the
  reference. They are not the app's shipped CSS.

The mockup loads IBM Plex from Google Fonts for design fidelity. It is a static
reference, not an app bundle.

Run from the repository root:

```sh
python3 -m http.server 4173 --directory design/mockup
```
