export const contentFixtures = [
  {
    id: "q3-planning",
    title: "Q3 planning",
    kind: "deck",
    revision: 5,
    reviewedRevision: 4,
    owner: "you",
    updated: "2m ago",
    updatedAt: "2026-10-20T08:35:00Z",
    tags: ["q3", "planning"],
    slides: [
      {
        title: "What we ship, what we cut.",
        body: "A working plan for the next eight weeks.",
        notes: "Open on the decision, not the process."
      },
      {
        title: "The case for retention",
        body: "Retention compounds. Acquisition does not. The next quarter is about keeping the accounts we already have.",
        notes: "Use the Q2 cohort numbers; do not cite the forecast."
      },
      {
        title: "Three bets",
        body: "Retention story, export path, and the operator review loop.",
        notes: "Each bet gets one owner and one metric."
      },
      {
        title: "Retention chart",
        body: "The Q2 cohort chart moves here. The label must say Q2.",
        notes: "The chart source is the Q2 board packet."
      },
      {
        title: "Scope",
        body: "Ship the retention story and export path. Cut the pricing table and the mobile preview.",
        notes: "No new pricing work this quarter."
      },
      {
        title: "Risks",
        body: "Data freshness, review capacity, and export QA.",
        notes: "Export QA is the blocking risk."
      }
    ],
    changes: [
      { type: "changed", text: "Headline: “What we ship, what we cut.” → “Three bets. One dependency.”" },
      { type: "added", text: "Retention chart on slide 4" }
    ]
  },
  {
    id: "q3-notes",
    title: "Q3 planning notes",
    kind: "doc",
    revision: 3,
    reviewedRevision: 2,
    owner: "you",
    updated: "12m ago",
    updatedAt: "2026-10-20T08:25:00Z",
    tags: ["q3", "brief"],
    blocks: [
      { type: "h2", text: "The quarter is eight weeks" },
      {
        type: "p",
        text: "We ship the retention story and the export path. We cut the pricing table and the mobile preview. The operator review is part of the export path, not a separate project."
      },
      { type: "callout", label: "Decision", text: "Ship the retention chart and the review trail." },
      {
        type: "p",
        text: "The retention chart cites Q2. The chart label must stay Q2 even when the deck is revised for Q3."
      }
    ],
    changes: [
      { type: "changed", text: "Scope paragraph tightened" },
      { type: "added", text: "Q2 retention source cited in paragraph 2" }
    ]
  },
  {
    id: "q3-budget",
    title: "Q3 budget",
    kind: "sheet",
    revision: 2,
    reviewedRevision: 1,
    owner: "Jon",
    updated: "28m ago",
    updatedAt: "2026-10-20T08:09:00Z",
    tags: ["q3", "finance"],
    columns: ["", "Q1", "Q2", "Q3 plan", "Δ"],
    rows: [
      ["Activation", "18,420", "21,090", "24,500", "+16%"],
      ["Review time", "3.8d", "3.2d", "2.5d", "−22%"],
      ["Export success", "—", "1,284", "1,900", "+48%"],
      ["Open risks", "7", "5", "3", "−40%"]
    ],
    changes: [
      { type: "changed", text: "Q3 plan column added" },
      { type: "added", text: "Export-success risk flagged on C4" }
    ]
  },
  {
    id: "customer-review",
    title: "Customer review",
    kind: "deck",
    revision: 2,
    reviewedRevision: 2,
    owner: "Mira",
    updated: "1h ago",
    updatedAt: "2026-10-20T07:35:00Z",
    tags: ["customer", "research"],
    slides: [
      {
        title: "What customers told us",
        body: "Operators want fewer review steps, not more automation.",
        notes: "Three interviews; two asked for the same export trail."
      },
      {
        title: "Where review stalls",
        body: "The handoff between the editor and the reviewer is the slowest step.",
        notes: "The revision trail is the trust surface."
      },
      {
        title: "What we will test",
        body: "One review panel, one revision compare, one export gate.",
        notes: "No new permissions in the first slice."
      }
    ]
  },
  {
    id: "launch-brief",
    title: "Launch brief",
    kind: "doc",
    revision: 2,
    reviewedRevision: 2,
    owner: "Mira",
    updated: "3h ago",
    updatedAt: "2026-10-20T05:35:00Z",
    tags: ["launch"],
    blocks: [
      { type: "h2", text: "What launches" },
      {
        type: "p",
        text: "The Works content surface launches with docs, sheets and decks in one app. Review and export remain explicit gates, not implicit saves."
      },
      { type: "callout", label: "Non-goal", text: "No autonomous approval or silent publishing." },
      {
        type: "p",
        text: "The first release is read-only. Write actions and agent tools follow behind the host contract."
      }
    ]
  },
  {
    id: "board-update",
    title: "Board update",
    kind: "deck",
    revision: 3,
    reviewedRevision: 3,
    owner: "Mira",
    updated: "4h ago",
    updatedAt: "2026-10-20T04:35:00Z",
    tags: ["board", "q3"],
    slides: [
      {
        title: "Q3 progress",
        body: "The retention story is drafted; the export path is in review.",
        notes: "Lead with the review number."
      },
      {
        title: "What changed",
        body: "The review gate is now part of the product surface.",
        notes: "No unapproved revision can export."
      },
      {
        title: "Next decisions",
        body: "Freeze the host content contract and the first runtime surface.",
        notes: "Agent tools wait on the tool-call command."
      }
    ]
  },
  {
    id: "pipeline",
    title: "Pipeline",
    kind: "sheet",
    revision: 5,
    reviewedRevision: 5,
    owner: "Sam",
    updated: "yesterday",
    updatedAt: "2026-10-19T12:00:00Z",
    tags: ["sales"],
    columns: ["Stage", "Count", "Value", "Owner"],
    rows: [
      ["Discovery", "18", "1.2M", "Sam"],
      ["Evaluation", "9", "840K", "Nina"],
      ["Contract", "4", "410K", "Jo"],
      ["Renewal", "11", "620K", "Sam"]
    ]
  },
  {
    id: "launch-readout",
    title: "Launch readout",
    kind: "deck",
    revision: 1,
    reviewedRevision: 0,
    owner: "you",
    updated: "yesterday",
    updatedAt: "2026-10-19T09:00:00Z",
    tags: ["launch"],
    slides: [
      {
        title: "What shipped",
        body: "The first Works surface is a read-only view of content and review state.",
        notes: "Draft; first review is not requested."
      },
      {
        title: "What we learned",
        body: "The revision gate is the useful part of the workflow.",
        notes: "Keep the next slice small."
      }
    ]
  },
  {
    id: "decision-log",
    title: "Decision log",
    kind: "doc",
    revision: 7,
    reviewedRevision: 7,
    owner: "Jon",
    updated: "2d ago",
    updatedAt: "2026-10-18T10:00:00Z",
    tags: ["decisions"],
    blocks: [
      { type: "h2", text: "Decisions" },
      {
        type: "p",
        text: "One content service, three clients. The master agent, chat agent and CLI use the same host API with different scopes."
      },
      { type: "callout", label: "Gate", text: "No author approves its own revision; export only uses the reviewed revision." },
      {
        type: "p",
        text: "Delete is soft. Purge and permission changes are operator-only."
      }
    ]
  },
  {
    id: "assumptions",
    title: "Assumptions",
    kind: "sheet",
    revision: 1,
    reviewedRevision: 0,
    owner: "Sam",
    updated: "3d ago",
    updatedAt: "2026-10-17T09:00:00Z",
    tags: ["planning"],
    columns: ["Assumption", "Owner", "Status", "Impact"],
    rows: [
      ["Review capacity stays at one reviewer", "Mira", "Open", "High"],
      ["Export QA completes before launch", "Sam", "Open", "High"],
      ["No new pricing work this quarter", "Jon", "Accepted", "Medium"]
    ]
  }
];
