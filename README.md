# IntentOps Harness

Reportable, auditable AI DevOps Agent.

IntentOps Harness is a reportable, auditable AI DevOps agent. It turns developer notes, issues, and logs into structured intent, evaluated action plans, consent-gated execution, and saved audit artifacts.

It uses Gemini for planning, while the harness keeps control of risk gates, local artifact generation, fallback behavior, and the hash-chained ledger.

```text
Observe -> Packetize -> Plan -> Evaluate -> Gate -> Act -> Verify -> Log
```

## What It Shows

AI coding agents can act quickly, but teams still need to know:

- what the agent understood
- which options it considered
- why one option was selected
- whether human approval was required
- what artifacts were generated
- how the decision can be audited later

IntentOps Harness treats autonomy as a governed loop, not as unchecked execution.

## Core Concepts

### Thought Packet

A structured memo generated from a developer note, issue, log, or README context.

It captures:

- summary
- goal
- context
- constraints
- urgency
- risk signals
- next actions

### HFE Planner

A planning layer that compares multiple action proposals before execution.

The Gemini response can shape the packet and proposals, while the harness normalizes, scores, selects, and records the result.

### Consent Gate

A risk-aware execution gate.

- Low risk: auto-approved
- Medium risk: human approval required
- High risk: rejected or escalated

The important design choice: AI can propose, but the harness controls whether an action is safe to proceed.

### Action Ledger

A lightweight tamper-evident audit trail.

Each entry includes the previous hash, selected plan, consent decision, verification checks, and current hash. This is not a blockchain; it is a compact hash chain for local auditability.

## Current MVP Features

- Gemini API integration through the local Node server
- Local rule-based fallback when Gemini is unavailable
- Thought Packet generation
- HFE-style proposal comparison and scoring
- Consent Gate
- Quality Gate with one controlled refinement pass
- Action Ledger with hash chaining
- Processing animation and completion indicators
- Markdown artifact generation
- Saved artifact folders under `generated-artifacts/<ledger-hash>/`
- One-file `artifact-preview.html` output
- Structured Gemini-guided artifact previews for broader requests
- Task mode selector for document, app/game, and general requests
- Interactive preview for calculator, invader, breakout, Othello, card-game, and mini-game prompts

## Demo Prompts

Before running app or game prompts, select `App / Game` in the left pane. This tells the harness to reject plan-only output when the request expects a playable browser artifact.

Calculator:

```text
Create a small calculator web app.
Use HTML, CSS, and JavaScript.
Generate a safe implementation plan, README draft, issue draft, decision record, and a saved HTML preview.
Do not modify project files or deploy anything without approval.
```

Mini-game:

```text
Create a small mini-game web app.
Include a saved HTML preview.
Do not deploy.
```

Domain report:

```text
Summarize this financial statement for reviewers.
Create a saved HTML preview with key metrics, risks, and next actions.
Do not send anything externally.
```

DevOps triage:

```text
CI is failing after the latest docs change.
The README needs a clearer setup section, and related bugs should become GitHub issues.
Do not deploy automatically. Prefer safe drafts before remote actions.
```

## Run Locally

Install dependencies are not required. The app uses Node's built-in HTTP server APIs and browser JavaScript.

```powershell
npm run dev
```

Then open:

```text
http://localhost:4173/
```

Do not use `file:///.../app/index.html` for the full demo. The Gemini and save APIs are served from the local Node server.

## Gemini Setup

Create a local `.env` file at the repository root:

```env
GEMINI_API_KEY=replace_with_your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Use [.env.example](.env.example) as the safe template.

Never commit `.env`. It is ignored by Git.

## Artifact Saving

After running the harness, click `Save Files`.

The server writes:

```text
generated-artifacts/<ledger-hash>/
  README-draft.md
  issue-draft.md
  decision-record.md
  artifact-preview.html
  manifest.json
```

`artifact-preview.html` is a one-file browser preview.

Gemini can provide a restricted `artifactSpec` with a title, summary, highlights, sections, and table rows. The server renders that structured data into HTML after escaping text. Gemini does not write raw HTML, CSS, or JavaScript into saved files.

For calculator, invader, and mini-game prompts, the preview can also include a small local interactive demo.

`generated-artifacts/` is ignored by Git because it is local demo output.

## Project Layout

```text
intentops-harness/
  README.md
  .env.example
  docs/
    architecture.md
    demo-script.md
    env.md
    hackathon-plan.md
    mvp-spec.md
  app/
    index.html
    styles.css
    main.js
  packages/
    core/
      intentops.js
  scripts/
    dev-server.js
  sample-vault/
    ci-readme-triage.md
  ledger/
    README.md
```

## Safety Boundaries

The MVP intentionally does not:

- deploy code
- push to GitHub
- create real remote issues
- modify project files without a save action
- expose the Gemini API key to browser-side JavaScript

The browser calls the local Node server. The server calls Gemini and writes local artifacts.

Artifact previews are also constrained. Gemini may shape the preview through structured fields, but the harness owns the HTML renderer and blocks raw script injection from model output.

## Quality Gate

After artifacts are generated, the harness assigns a Quality Score against an 80% target.

Good first-pass outputs can pass immediately. If the score is below target and the maximum iteration count has not been reached, the user can click `Refine Once`.

The refinement loop is intentionally bounded:

```text
max iterations: 2
target score: 80%
```

This keeps the agent able to self-improve when quality is actually low, without intentionally weakening the first result or allowing uncontrolled looping.

## Repository Description

An auditable AI DevOps agent for turning developer notes, issues, and logs into intent, evaluated action plans, safe draft artifacts, and hash-chained execution records.
