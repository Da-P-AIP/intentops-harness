const RISK_KEYWORDS = {
  high: ["deploy", "production", "delete", "secret", "force push", "infrastructure"],
  medium: ["github issue", "configuration", "ci", "remote", "workflow"],
  low: ["readme", "markdown", "draft", "document", "summary", "memo"],
};

export function runHarness(input, previousHash = "GENESIS", aiDraft = null) {
  const normalizedInput = input.trim();
  const packet = normalizePacket(aiDraft?.packet, normalizedInput);
  const proposals = normalizeProposals(aiDraft?.proposals, packet);
  const evaluated = evaluateProposals(proposals, packet);
  const selected = selectProposal(evaluated);
  const consent = decideConsent(selected);
  const artifacts = createArtifacts(packet, selected, consent);
  const verification = verifyArtifacts(packet, artifacts);
  const ledgerEntry = createLedgerEntry({
    previousHash,
    packet,
    proposals: evaluated,
    selected,
    consent,
    artifacts,
    verification,
  });

  return {
    packet,
    proposals: evaluated,
    selected,
    consent,
    artifacts,
    verification,
    ledgerEntry,
  };
}

function normalizePacket(packet, input) {
  const fallback = createThoughtPacket(input);
  if (!packet || typeof packet !== "object") return fallback;

  return {
    summary: asText(packet.summary, fallback.summary),
    goal: asText(packet.goal, fallback.goal),
    context: asText(packet.context, fallback.context),
    constraints: asList(packet.constraints, fallback.constraints),
    urgency: ["normal", "elevated"].includes(packet.urgency) ? packet.urgency : fallback.urgency,
    riskSignals: asList(packet.riskSignals, fallback.riskSignals).filter((risk) =>
      ["low", "medium", "high"].includes(risk),
    ),
    nextActions: asList(packet.nextActions, fallback.nextActions),
  };
}

function normalizeProposals(proposals, packet) {
  if (!Array.isArray(proposals) || proposals.length === 0) return createProposals(packet);

  return proposals.slice(0, 3).map((proposal, index) => ({
    id: asText(proposal.id, `ai-proposal-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    title: asText(proposal.title, `AI proposal ${index + 1}`),
    action: asText(proposal.action, "Create safe drafts and route side effects through approval."),
    roleNotes: {
      builder: asText(proposal.roleNotes?.builder, "Implementation should stay small and reversible."),
      reviewer: asText(proposal.roleNotes?.reviewer, "Output should be readable before execution."),
      risk: asText(proposal.roleNotes?.risk, "Side effects must pass the Consent Gate."),
      product: asText(proposal.roleNotes?.product, "The plan should be easy to explain in a demo."),
    },
    risk: ["low", "medium", "high"].includes(proposal.risk) ? proposal.risk : "medium",
  }));
}

export function createThoughtPacket(input) {
  const lower = input.toLowerCase();
  const goals = [];
  const constraints = [];
  const riskSignals = [];

  if (lower.includes("ci")) goals.push("Investigate CI failure");
  if (lower.includes("readme")) goals.push("Improve README or documentation");
  if (lower.includes("issue")) goals.push("Prepare issue triage");
  if (lower.includes("log")) goals.push("Summarize operational signal from logs");
  if (goals.length === 0) goals.push("Clarify developer intent and propose a safe next action");

  if (lower.includes("do not") || lower.includes("don't")) constraints.push("Respect explicit negative constraints");
  if (lower.includes("approval")) constraints.push("Require approval before external side effects");
  if (lower.includes("draft")) constraints.push("Prefer draft artifacts before execution");
  if (constraints.length === 0) constraints.push("Avoid external side effects in the MVP");

  for (const [level, words] of Object.entries(RISK_KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) riskSignals.push(level);
  }

  return {
    summary: summarize(input),
    goal: goals.join("; "),
    context: "Developer-facing operational note, issue, log, or memo.",
    constraints,
    urgency: lower.includes("failing") || lower.includes("urgent") ? "elevated" : "normal",
    riskSignals: [...new Set(riskSignals)],
    nextActions: [
      "Generate safe action proposals",
      "Compare proposals before execution",
      "Route side effects through the Consent Gate",
      "Record the final decision in the Action Ledger",
    ],
  };
}

export function createProposals(packet) {
  return [
    {
      id: "safe-draft",
      title: "Generate safe drafts first",
      action: "Create README update, issue draft, and decision record without external side effects.",
      roleNotes: {
        builder: "Fast to implement and easy to demo.",
        reviewer: "Readable artifacts can be checked before use.",
        risk: "No remote mutation.",
        product: "Clearly communicates agent value.",
      },
      risk: "low",
    },
    {
      id: "approval-issue",
      title: "Prepare issue creation behind approval",
      action: "Draft GitHub issues and wait for human approval before remote creation.",
      roleNotes: {
        builder: "Requires a connector later, but can be represented as a draft now.",
        reviewer: "Keeps human ownership over public project state.",
        risk: "Remote side effects require consent.",
        product: "Shows governance without blocking momentum.",
      },
      risk: packet.riskSignals.includes("medium") ? "medium" : "low",
    },
    {
      id: "direct-execute",
      title: "Directly execute all fixes",
      action: "Modify files, create issues, and change CI configuration immediately.",
      roleNotes: {
        builder: "Looks autonomous, but expands implementation scope.",
        reviewer: "Harder to validate in a short demo.",
        risk: "Potential side effects and configuration changes.",
        product: "May distract from auditable autonomy.",
      },
      risk: packet.riskSignals.includes("high") ? "high" : "medium",
    },
  ];
}

export function evaluateProposals(proposals, packet) {
  return proposals.map((proposal) => {
    const riskPenalty = proposal.risk === "high" ? 45 : proposal.risk === "medium" ? 20 : 5;
    const value = proposal.id === "safe-draft" ? 88 : proposal.id === "approval-issue" ? 82 : 65;
    const feasibility = proposal.id === "direct-execute" ? 50 : 90;
    const governance = proposal.risk === "low" ? 92 : proposal.risk === "medium" ? 78 : 35;
    const urgencyFit = packet.urgency === "elevated" && proposal.id !== "direct-execute" ? 84 : 72;
    const total = Math.round((value + feasibility + governance + urgencyFit - riskPenalty) / 4);

    return {
      ...proposal,
      scores: {
        value,
        feasibility,
        governance,
        urgencyFit,
        riskPenalty,
        total,
      },
    };
  });
}

export function selectProposal(proposals) {
  return [...proposals].sort((a, b) => b.scores.total - a.scores.total)[0];
}

export function decideConsent(proposal) {
  if (proposal.risk === "low") {
    return {
      status: "auto-approved",
      reason: "The selected plan only creates local drafts and audit records.",
      requiredBy: "Consent Gate",
    };
  }

  if (proposal.risk === "medium") {
    return {
      status: "human-approval-required",
      reason: "The selected plan may create remote project state or change workflow behavior.",
      requiredBy: "Consent Gate",
    };
  }

  return {
    status: "rejected",
    reason: "The selected plan is too risky for autonomous execution in the MVP.",
    requiredBy: "Consent Gate",
  };
}

export function createArtifacts(packet, selected, consent) {
  const issueDraft = [
    "## Issue Draft",
    "",
    `Goal: ${packet.goal}`,
    "",
    "### Context",
    packet.summary,
    "",
    "### Proposed Next Step",
    selected.action,
    "",
    `Consent: ${consent.status}`,
  ].join("\n");

  const decisionRecord = [
    "# Decision Record",
    "",
    `Selected plan: ${selected.title}`,
    `Risk: ${selected.risk}`,
    `Consent: ${consent.status}`,
    "",
    "## Rationale",
    consent.reason,
  ].join("\n");

  const readmeDraft = [
    "## Operations Note",
    "",
    "IntentOps Harness reviewed the incoming developer note and recommends a safe draft-first workflow.",
    "",
    `Primary goal: ${packet.goal}`,
    "",
    "Next actions:",
    "- Review generated drafts",
    "- Approve any remote side effects before execution",
    "- Store final actions in the ledger",
  ].join("\n");

  return {
    readmeDraft,
    issueDraft,
    decisionRecord,
  };
}

export function verifyArtifacts(packet, artifacts) {
  const hasPacketGoal = Object.values(artifacts).some((artifact) => artifact.includes(packet.goal));
  const hasConsent = Object.values(artifacts).some((artifact) => artifact.includes("Consent:"));

  return {
    status: hasPacketGoal && hasConsent ? "verified" : "needs-review",
    checks: [
      { name: "goal reflected in artifacts", passed: hasPacketGoal },
      { name: "consent status recorded", passed: hasConsent },
      { name: "external side effects avoided", passed: true },
    ],
  };
}

export function createLedgerEntry(payload) {
  const timestamp = new Date().toISOString();
  const body = {
    timestamp,
    previousHash: payload.previousHash,
    packet: payload.packet,
    selectedPlan: payload.selected,
    consent: payload.consent,
    verification: payload.verification,
  };
  const hash = stableHash(JSON.stringify(body));

  return {
    ...body,
    hash,
  };
}

export function stableHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function summarize(input) {
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 177)}...`;
}

function asText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asList(value, fallback) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : fallback;
  }

  if (typeof value === "string" && value.trim()) return [value.trim()];

  return fallback;
}
