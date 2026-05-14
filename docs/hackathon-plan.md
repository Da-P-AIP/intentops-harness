# Hackathon Plan

## Positioning

IntentOps Harness is a reportable, auditable AI DevOps Agent.

It helps teams use AI agents for DevOps tasks without losing visibility, consent, or traceability.

## Demo Story

A developer enters a messy operational note:

```text
CI is failing. README needs an update and issue triage is required.
```

The agent responds like a careful teammate:

1. It explains what it understood.
2. It proposes several possible actions.
3. It compares them.
4. It identifies risk.
5. It asks for approval where needed.
6. It produces safe drafts.
7. It records the whole decision path.

## What To Build First

### Must Have

- Text input
- Thought Packet output
- Three action proposals
- HFE-style comparison table
- Consent Gate result
- Markdown/issue/decision draft output
- Hash-chained ledger view

### Should Have

- Sample input loader
- Risk labels
- Human approval button for medium-risk plans
- Clear next action recommendation

### Later

- Gemini API integration
- GitHub issue creation connector
- Cloud Run deployment
- Persistent ledger storage
- Real connector permission model

## What Not To Build In The MVP

- Real blockchain
- DAO UI
- unrestricted autonomous execution
- skill marketplace
- automatic deploys
- direct code modification without approval

## Pitch Line

IntentOps Harness turns messy developer notes, issues, and logs into structured intent, evaluated plans, consent-gated execution, and auditable action records.

