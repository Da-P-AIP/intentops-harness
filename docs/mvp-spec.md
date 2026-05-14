# MVP Specification

## Goal

Build a browser-demoable harness that shows how an AI DevOps agent can move from messy input to safe, auditable action.

## User Flow

1. User pastes a developer note, issue, or log.
2. User clicks `Run Harness`.
3. App generates a Thought Packet.
4. App generates three proposals.
5. App evaluates proposals using HFE-style scores.
6. App selects the strongest safe plan.
7. Consent Gate decides whether execution can proceed.
8. App generates safe output artifacts.
9. App appends a hash-chained ledger entry.

## Risk Rules

The MVP uses simple keyword and action-type heuristics.

Low risk:

- documentation draft
- issue draft
- decision record
- local summary

Medium risk:

- creating remote issues
- changing configuration
- modifying CI behavior

High risk:

- deployment
- deleting data
- rotating secrets
- force-pushing
- changing production infrastructure

## Output Artifacts

- Thought Packet
- HFE comparison
- Consent decision
- Execution draft
- Verification note
- Ledger entry

## Success Criteria

The demo succeeds if a viewer can understand:

- what the agent understood
- what options it considered
- why one option was selected
- whether human approval was needed
- what artifact was produced
- how the decision was recorded

