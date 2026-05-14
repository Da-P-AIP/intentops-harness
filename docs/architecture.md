# Architecture

IntentOps Harness is built around a small governed agent loop.

```text
User Goal / Issue / Log / Memo
  -> Observe
  -> Packetize
  -> Propose
  -> Deliberate
  -> Plan
  -> Evaluate
  -> Consent
  -> Execute
  -> Verify
  -> Ledger
```

The compressed loop is:

```text
Observe -> Packetize -> Plan -> Evaluate -> Gate -> Act -> Verify -> Log
```

## Components

### 1. Intake

Accepts developer-facing input:

- GitHub issue text
- CI logs
- README notes
- incident notes
- team memos

### 2. Thought Packet Generator

Converts messy text into structured intent.

Output fields:

- summary
- goal
- context
- constraints
- urgency
- risk signals
- recommended next actions

### 3. HFE Planner

Generates multiple proposals and compares them.

The MVP uses role-based evaluation rather than true multi-agent parallelism. This keeps the demo compact while preserving the future path to parallel role evaluation.

Internal roles:

- builder
- reviewer
- risk officer
- product operator

### 4. Consent Gate

Maps risk to execution permission.

| Risk | Result |
| --- | --- |
| Low | Auto-approved |
| Medium | Human approval required |
| High | Rejected or escalated |

### 5. Skill And Connector Harness

The MVP does not execute external side effects. It produces safe drafts:

- Markdown update draft
- GitHub issue draft
- decision record draft
- next action list

Future connectors can be added behind the Consent Gate.

### 6. Action Ledger

Records:

- thought packet
- proposals
- selected plan
- consent decision
- generated artifacts
- verification result

Each entry includes:

- previous hash
- payload
- current hash

This is not a blockchain. It is a lightweight hash chain for auditability.

## Design Principle

One agent, multiple governance roles.

The agent can act autonomously, but it must report what it understood, compare options, ask for approval when needed, verify the result, and leave an audit trail.

