# Demo Script

## One-Minute Version

1. Open the app at:

```text
http://localhost:4173/
```

2. Paste this prompt:

```text
Create a small calculator web app.
Use HTML, CSS, and JavaScript.
Generate a safe implementation plan, README draft, issue draft, decision record, and a saved HTML preview.
Do not modify project files or deploy anything without approval.
```

3. Click `Run Harness`.

4. Point out the processing loop:

```text
Observe -> Packetize -> Plan -> Evaluate -> Gate -> Act -> Verify -> Log
```

5. Explain the split:

```text
Gemini proposes the intent packet and action options.
The harness controls risk, consent, verification, artifact saving, and the ledger.
```

6. Show these sections:

- `Thought Packet`: what the agent understood
- `HFE Planner`: compared action options
- `Consent Gate`: whether execution is safe
- `Generated Artifacts`: README, Issue, and Decision drafts
- `Action Ledger`: hash-chained decision record

7. Click `Save Files`.

8. Open:

```text
generated-artifacts/<ledger-hash>/artifact-preview.html
```

9. Show the one-file artifact preview and the saved location block.

## Three-Minute Version

### 1. Problem

AI agents can move fast, but teams need control:

- What did the agent understand?
- Why did it choose this plan?
- Was approval needed?
- What was generated?
- Can we audit it later?

### 2. Core Idea

IntentOps Harness is a reportable, auditable AI DevOps agent.

It does not frame autonomy as unlimited execution. It frames autonomy as a governed loop:

```text
Observe -> Packetize -> Plan -> Evaluate -> Gate -> Act -> Verify -> Log
```

### 3. Live Run

Use the calculator or mini-game prompt.

Click `Run Harness`.

While it runs, explain:

- Gemini reads the task and proposes structured intent.
- The harness evaluates and gates the plan.
- Low-risk draft generation can proceed.
- Riskier actions would require human approval.

### 4. Saved Artifacts

Click `Save Files`.

Show the folder:

```text
generated-artifacts/<ledger-hash>/
```

Show the files:

```text
README-draft.md
issue-draft.md
decision-record.md
artifact-preview.html
manifest.json
```

Open `artifact-preview.html`.

For a calculator prompt, the preview includes a small interactive calculator. For a mini-game prompt, it includes a small click game preview.

### 5. Safety Point

Close with:

```text
The AI proposes. The harness governs.
```

The API key stays server-side. The browser never receives it. If Gemini fails, the app falls back to local rule-based planning so the demo remains usable.

## Good Backup Prompt

```text
CI is failing after the latest docs change.
The README needs a clearer setup section, and related bugs should become GitHub issues.
Do not deploy automatically. Prefer safe drafts before remote actions.
```

This shows the DevOps triage side of the project.

## Pre-Submission Checklist

- `.env` is deleted or kept local only.
- `.env.example` remains in the repository.
- `generated-artifacts/` is deleted before final commit or left ignored.
- `npm run check` passes.
- The app runs at `http://localhost:4173/`.
- `Run Harness` works with Gemini or fallback.
- `Save Files` creates the artifact folder.
