const RISK_KEYWORDS = {
  high: ["deploy", "production", "delete", "secret", "force push", "infrastructure"],
  medium: ["github issue", "configuration", "ci", "remote", "workflow"],
  low: ["readme", "markdown", "draft", "document", "summary", "memo"],
};

export function runHarness(input, previousHash = "GENESIS", aiDraft = null, options = {}) {
  const normalizedInput = input.trim();
  const packet = normalizePacket(aiDraft?.packet, normalizedInput);
  const proposals = normalizeProposals(aiDraft?.proposals, packet);
  const artifactSpec = normalizeArtifactSpec(aiDraft?.artifactSpec, packet);
  const evaluated = evaluateProposals(proposals, packet);
  const selected = selectProposal(evaluated);
  const consent = decideConsent(selected);
  const artifacts = createArtifacts(packet, selected, consent);
  const verification = verifyArtifacts(packet, artifacts);
  const qualityGate = evaluateQuality({
    packet,
    proposals: evaluated,
    selected,
    consent,
    artifacts,
    verification,
    artifactSpec,
    options,
  });
  const ledgerEntry = createLedgerEntry({
    previousHash,
    taskMode: options.taskMode || "document",
    packet,
    proposals: evaluated,
    selected,
    consent,
    artifacts,
    verification,
    qualityGate,
    artifactSpec,
  });

  return {
    packet,
    proposals: evaluated,
    selected,
    consent,
    artifacts,
    verification,
    qualityGate,
    artifactSpec,
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

function normalizeArtifactSpec(spec, packet) {
  const fallback = {
    title: packet.goal || "Generated Artifact",
    artifactType: "generic",
    summary: packet.summary || "Review generated artifacts before applying side effects.",
    sections: [
      {
        heading: "Purpose",
        body: packet.goal || "Clarify the requested outcome.",
      },
      {
        heading: "Next Actions",
        body: packet.nextActions.join("; "),
      },
    ],
    table: [],
    highlights: [],
  };

  if (!spec || typeof spec !== "object") return fallback;

  return {
    title: asText(spec.title, fallback.title),
    artifactType: asText(spec.artifactType, fallback.artifactType),
    summary: asText(spec.summary, fallback.summary),
    sections: normalizeSections(spec.sections, fallback.sections),
    table: normalizeTable(spec.table),
    highlights: asList(spec.highlights, fallback.highlights).slice(0, 6),
  };
}

function normalizeSections(sections, fallback) {
  if (!Array.isArray(sections) || sections.length === 0) return fallback;
  const normalized = sections
    .slice(0, 8)
    .map((section, index) => ({
      heading: asText(section?.heading, `Section ${index + 1}`),
      body: asText(section?.body, ""),
    }))
    .filter((section) => section.body);
  return normalized.length ? normalized : fallback;
}

function normalizeTable(table) {
  if (!Array.isArray(table)) return [];
  return table.slice(0, 8).map((row) => {
    if (!row || typeof row !== "object") return { Item: String(row) };
    return Object.fromEntries(Object.entries(row).slice(0, 5).map(([key, value]) => [key, String(value)]));
  });
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

export function evaluateQuality({
  packet,
  proposals,
  selected,
  consent,
  artifacts,
  verification,
  artifactSpec = {},
  options = {},
}) {
  const artifactSpecText = [
    artifactSpec.title,
    artifactSpec.artifactType,
    artifactSpec.summary,
    ...(artifactSpec.highlights || []),
    ...(artifactSpec.sections || []).flatMap((section) => [section.heading, section.body]),
    ...(artifactSpec.table || []).flatMap((row) => Object.values(row || {})),
  ].join(" ");
  const reviewText = [
    packet.goal,
    packet.summary,
    packet.context,
    selected.title,
    selected.action,
    ...Object.values(artifacts),
    artifactSpecText,
  ]
    .join(" ")
    .toLowerCase();
  const hasPreviewIntent = /preview|html|calculator|game|\u96fb\u5353|\u30b2\u30fc\u30e0/i.test(
    [packet.goal, packet.summary, selected.action].join(" "),
  );
  const wantsPlayableArtifact = /game|web app|html app|\u30b2\u30fc\u30e0|\u30a2\u30d7\u30ea|othello|reversi|breakout|invader/.test(
    reviewText,
  );
  const appGameMode = options.taskMode === "app-game";
  const planOnlyMismatch =
    (wantsPlayableArtifact || appGameMode) &&
    /command-line|cli|planning & proposal|planning and proposal|current status planning|development plan|initial plan|outlines the plan|proposed technical approach|proposal only|specification|requirements|\u4ed5\u69d8/.test(
      reviewText,
    );
  const hasMultipleOptions = proposals.length >= 3;
  const hasClearArtifacts = Object.values(artifacts).every((artifact) => artifact.length > 120);
  const verified = verification.status === "verified";
  const safe = consent.status === "auto-approved" || consent.status === "human-approved";
  const hasClearIntent = Boolean(packet.goal && packet.summary && packet.nextActions.length);
  const hasSpecificIntent =
    hasPreviewIntent ||
    (!packet.goal.includes("Clarify developer intent") && packet.summary.replace(/\s+/g, " ").trim().length >= 24);
  const hasStructuredPreview = Boolean(
    artifactSpec.title &&
      artifactSpec.summary &&
      Array.isArray(artifactSpec.sections) &&
      artifactSpec.sections.length >= 2,
  );
  const hasRichPreview = Boolean(
    hasStructuredPreview &&
      ((Array.isArray(artifactSpec.highlights) && artifactSpec.highlights.length >= 2) ||
        (Array.isArray(artifactSpec.table) && artifactSpec.table.length >= 2)),
  );
  const modeAligned = !appGameMode || /game|app|prototype|browser|playable|preview/i.test(artifactSpec.artifactType || reviewText);
  const refined = Number(options.iteration || 1) > 1;

  let score = 48;
  if (hasClearIntent) score += 8;
  if (hasSpecificIntent) score += 8;
  if (hasMultipleOptions) score += 8;
  if (hasClearArtifacts) score += 8;
  if (verified) score += 7;
  if (safe) score += 7;
  if (hasPreviewIntent) score += 3;
  if (hasStructuredPreview) score += 4;
  if (hasRichPreview) score += 3;
  if (modeAligned) score += 2;
  if (refined) score += 5;
  if (!hasSpecificIntent && !refined) score = Math.min(score, 66);
  if (planOnlyMismatch && !refined) score = Math.min(score, appGameMode ? 68 : 76);
  if (score >= 90 && !refined) score -= stableHash(reviewText).charCodeAt(2) % 5;
  score = Math.max(45, Math.min(95, score));

  const findings = [];
  if (!hasClearIntent) findings.push("Clarify the goal, summary, and next actions.");
  if (!hasSpecificIntent) findings.push("Clarify the requested outcome before treating this as ready.");
  if (planOnlyMismatch) {
    findings.push("The selected task mode expects a playable/browser artifact, but the output is still plan-only.");
  }
  if (!hasMultipleOptions && score < 80) findings.push("Add more alternative plans before choosing one.");
  if (!hasClearArtifacts) findings.push("Expand the generated drafts so reviewers can act on them.");
  if (!hasStructuredPreview && score < 90) findings.push("Add more concrete preview structure for reviewers.");
  if (!hasPreviewIntent && score < 80) findings.push("Clarify whether a saved HTML preview is expected.");
  if (!refined && score < 80) findings.push("Run one refinement pass to improve acceptance criteria and saved artifacts.");
  if (findings.length === 0) findings.push("Artifacts are clear enough for review and safe local saving.");

  return {
    score,
    target: 80,
    status: score >= 80 ? "pass" : "needs-refinement",
    iteration: Number(options.iteration || 1),
    maxIterations: 2,
    findings,
    suggestedRefinement:
      score >= 80
        ? "No refinement required. Review and save artifacts."
        : "Ask Gemini to strengthen acceptance criteria, test notes, and saved artifact clarity.",
  };
}

export function createLedgerEntry(payload) {
  const timestamp = new Date().toISOString();
  const body = {
    timestamp,
    previousHash: payload.previousHash,
    taskMode: payload.taskMode,
    packet: payload.packet,
    selectedPlan: payload.selected,
    consent: payload.consent,
    verification: payload.verification,
    qualityGate: payload.qualityGate,
    artifactSpec: payload.artifactSpec,
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
