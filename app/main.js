import { runHarness } from "../packages/core/intentops.js";

const sampleText = `CI is failing after the latest docs change.

The README also needs a clearer setup section before the hackathon submission. There are two related bugs that should probably become GitHub issues, but creating remote issues should wait for approval.

Constraints:
- Do not deploy anything automatically.
- Do not change production configuration.
- Keep the output readable for reviewers.
- Prefer safe drafts over direct side effects.

Desired outcome:
- Explain what is happening.
- Propose a safe workflow.
- Generate a README update draft.
- Draft follow-up issues.
- Record the decision path.`;

const state = {
  ledger: [],
  latestResult: null,
  activeArtifact: "readmeDraft",
  taskMode: "document",
};

const elements = {
  inputText: document.querySelector("#inputText"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  runButton: document.querySelector("#runButton"),
  approveButton: document.querySelector("#approveButton"),
  packetOutput: document.querySelector("#packetOutput"),
  urgencyBadge: document.querySelector("#urgencyBadge"),
  selectedBadge: document.querySelector("#selectedBadge"),
  proposalOutput: document.querySelector("#proposalOutput"),
  consentBadge: document.querySelector("#consentBadge"),
  consentReason: document.querySelector("#consentReason"),
  verificationOutput: document.querySelector("#verificationOutput"),
  qualityPanel: document.querySelector(".quality-panel"),
  qualityBadge: document.querySelector("#qualityBadge"),
  qualityFill: document.querySelector("#qualityFill"),
  qualityReason: document.querySelector("#qualityReason"),
  qualityFindings: document.querySelector("#qualityFindings"),
  refineButton: document.querySelector("#refineButton"),
  artifactOutput: document.querySelector("#artifactOutput"),
  artifactsPanel: document.querySelector(".artifacts-panel"),
  completionNote: document.querySelector("#completionNote"),
  completionBeacon: document.querySelector("#completionBeacon"),
  saveArtifactsButton: document.querySelector("#saveArtifactsButton"),
  saveNote: document.querySelector("#saveNote"),
  ledgerOutput: document.querySelector("#ledgerOutput"),
  ledgerCount: document.querySelector("#ledgerCount"),
  aiStatus: document.querySelector("#aiStatus"),
  chainStatus: document.querySelector("#chainStatus"),
  loopConsole: document.querySelector(".loop-console"),
  loopStage: document.querySelector("#loopStage"),
  loopStatus: document.querySelector("#loopStatus"),
  loopNodes: [...document.querySelectorAll(".loop-node")],
  processTitle: document.querySelector("#processTitle"),
  processSteps: [...document.querySelectorAll("[data-process-step]")],
  revealPanels: [...document.querySelectorAll(".packet-panel, .panel:not(.packet-panel)")],
  tabs: [...document.querySelectorAll(".tab")],
};

elements.loadSampleButton.addEventListener("click", () => {
  elements.inputText.value = sampleText;
});

for (const button of elements.modeButtons) {
  button.addEventListener("click", () => {
    state.taskMode = button.dataset.taskMode;
    renderTaskMode();
  });
}

elements.runButton.addEventListener("click", async () => {
  const input = elements.inputText.value.trim();
  if (!input) {
    elements.inputText.focus();
    return;
  }

  const previousHash = state.ledger.at(-1)?.hash ?? "GENESIS";
  resetRunView();
  beginProcessing();
  animateLoop();

  elements.runButton.disabled = true;
  elements.runButton.textContent = "Running...";
  elements.aiStatus.textContent = "AI: contacting Gemini";

  const result = await runWithServer(input, previousHash);
  state.latestResult = result;
  state.ledger.push(result.ledgerEntry);
  render(result);
  endProcessing(result.ai);

  elements.runButton.disabled = false;
  elements.runButton.textContent = "Run Harness";
});

elements.approveButton.addEventListener("click", () => {
  if (!state.latestResult) return;

  state.latestResult.consent = {
    status: "human-approved",
    reason: "Human approval was granted for the pending medium-risk plan.",
    requiredBy: "Human operator",
  };
  state.latestResult.ledgerEntry.consent = state.latestResult.consent;
  beginProcessing(["Gate", "Act", "Verify", "Log"]);
  render(state.latestResult);
  animateLoop(["Gate", "Act", "Verify", "Log"]);
  endProcessing(state.latestResult.ai);
});

elements.refineButton.addEventListener("click", async () => {
  if (!state.latestResult) return;

  const quality = state.latestResult.qualityGate;
  if (!quality || quality.iteration >= quality.maxIterations) return;

  const previousHash = state.ledger.at(-1)?.hash ?? "GENESIS";
  beginProcessing(["Packetize", "Plan", "Evaluate"]);
  elements.qualityPanel.classList.add("refining");
  elements.refineButton.disabled = true;
  elements.refineButton.textContent = "Refining...";
  elements.aiStatus.textContent = "AI: refining with Gemini";

  const result = await refineWithServer(elements.inputText.value.trim(), previousHash, state.latestResult);
  state.latestResult = result;
  state.ledger.push(result.ledgerEntry);
  render(result);
  endProcessing(result.ai);

  elements.qualityPanel.classList.remove("refining");
  elements.refineButton.textContent = "Refine Once";
});

elements.saveArtifactsButton.addEventListener("click", async () => {
  if (!state.latestResult) return;

  elements.saveArtifactsButton.disabled = true;
  elements.saveArtifactsButton.textContent = "Saving...";

  const saved = await saveArtifacts(state.latestResult);
  if (saved) {
    elements.saveNote.textContent = `Saved: ${saved.directory} / open artifact-preview.html for the one-page preview.`;
    elements.saveNote.classList.add("saved");
  } else {
    elements.saveNote.textContent = "Save failed. The generated artifacts are still visible here.";
    elements.saveNote.classList.remove("saved");
  }

  elements.saveArtifactsButton.textContent = "Save Files";
  elements.saveArtifactsButton.disabled = false;
});

for (const tab of elements.tabs) {
  tab.addEventListener("click", () => {
    state.activeArtifact = tab.dataset.artifact;
    renderArtifact();
    renderTabs();
  });
}

function render(result) {
  renderAiStatus(result.ai);
  renderPacket(result.packet);
  renderProposals(result.proposals, result.selected);
  renderConsent(result.consent);
  renderVerification(result.verification);
  renderQuality(result.qualityGate);
  renderArtifact();
  renderLedger();
  elements.saveArtifactsButton.disabled = false;
  elements.saveNote.textContent = "Save README / Issue / Decision as Markdown files.";
  elements.saveNote.classList.remove("saved");
  revealResults();
}

function renderQuality(quality) {
  if (!quality) {
    elements.qualityBadge.textContent = "waiting";
    elements.qualityFill.style.width = "0%";
    elements.qualityReason.textContent = "Run the harness to self-review artifacts.";
    elements.qualityFindings.innerHTML = "";
    elements.refineButton.disabled = true;
    return;
  }

  elements.qualityBadge.textContent = `${quality.score}% ${quality.status}`;
  elements.qualityBadge.className = quality.status === "pass" ? "badge" : "badge medium";
  elements.qualityFill.style.width = `${quality.score}%`;
  elements.qualityReason.textContent = quality.suggestedRefinement;
  elements.qualityFindings.innerHTML = "";

  for (const finding of quality.findings) {
    const item = document.createElement("li");
    item.textContent = finding;
    elements.qualityFindings.append(item);
  }

  elements.refineButton.disabled = quality.status === "pass" || quality.iteration >= quality.maxIterations;
}

function renderAiStatus(ai) {
  if (!ai) {
    elements.aiStatus.textContent = "AI: local fallback";
    return;
  }

  elements.aiStatus.textContent = ai.status === "used" ? `AI: Gemini ${ai.model}` : "AI: local fallback";
}

function renderPacket(packet) {
  elements.urgencyBadge.textContent = `urgency: ${packet.urgency}`;
  elements.urgencyBadge.className = packet.urgency === "elevated" ? "badge medium" : "badge";

  elements.packetOutput.innerHTML = "";
  const rows = [
    ["Summary", packet.summary],
    ["Goal", packet.goal],
    ["Context", packet.context],
    ["Constraints", packet.constraints.join("; ")],
    ["Risk signals", packet.riskSignals.join(", ") || "none"],
    ["Next actions", packet.nextActions.join("; ")],
  ];

  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    elements.packetOutput.append(term, detail);
  }
}

function renderProposals(proposals, selected) {
  elements.selectedBadge.textContent = `selected: ${selected.id}`;
  elements.proposalOutput.innerHTML = "";

  for (const proposal of proposals) {
    const card = document.createElement("div");
    card.className = proposal.id === selected.id ? "proposal selected" : "proposal";

    const riskClass = proposal.risk === "high" ? "badge high" : proposal.risk === "medium" ? "badge medium" : "badge";
    card.innerHTML = `
      <div class="proposal-head">
        <div class="proposal-title"></div>
        <span class="${riskClass}"></span>
      </div>
      <p class="muted"></p>
      <div class="score-row">
        ${scoreCell("Value", proposal.scores.value)}
        ${scoreCell("Feasible", proposal.scores.feasibility)}
        ${scoreCell("Gov", proposal.scores.governance)}
        ${scoreCell("Urgency", proposal.scores.urgencyFit)}
        ${scoreCell("Total", proposal.scores.total)}
      </div>
    `;

    card.querySelector(".proposal-title").textContent = proposal.title;
    card.querySelector(".badge").textContent = proposal.risk;
    card.querySelector("p").textContent = proposal.action;
    elements.proposalOutput.append(card);
  }
}

function renderConsent(consent) {
  elements.consentBadge.textContent = consent.status;
  elements.consentBadge.className =
    consent.status === "rejected" ? "badge high" : consent.status.includes("required") ? "badge medium" : "badge";
  elements.consentReason.textContent = consent.reason;
  elements.approveButton.disabled = consent.status !== "human-approval-required";
}

function renderVerification(verification) {
  elements.verificationOutput.innerHTML = "";

  for (const check of verification.checks) {
    const row = document.createElement("div");
    row.className = "check";
    row.innerHTML = `<span class="check-mark"></span><span></span>`;
    row.querySelector(".check-mark").textContent = check.passed ? "OK" : "!";
    row.querySelector("span:last-child").textContent = check.name;
    elements.verificationOutput.append(row);
  }
}

function renderArtifact() {
  if (!state.latestResult) {
    elements.artifactOutput.textContent = "Run the harness to generate safe draft artifacts.";
    return;
  }

  elements.artifactOutput.textContent = state.latestResult.artifacts[state.activeArtifact];
}

function renderTabs() {
  for (const tab of elements.tabs) {
    tab.classList.toggle("active", tab.dataset.artifact === state.activeArtifact);
  }
}

function resetRunView() {
  state.latestResult = null;
  state.activeArtifact = "readmeDraft";
  elements.loopConsole.classList.remove("processing");
  elements.loopStage.classList.remove("running");
  elements.loopStatus.textContent = "standby";
  elements.processTitle.textContent = "standby";
  elements.completionBeacon.classList.remove("ready");
  elements.completionNote.textContent = "Artifacts will glow when the run is complete.";
  elements.artifactsPanel.classList.remove("complete-glow", "revealed");

  for (const node of elements.loopNodes) {
    node.classList.remove("active", "done");
  }

  for (const step of elements.processSteps) {
    step.classList.remove("active", "done");
  }

  for (const panel of elements.revealPanels) {
    panel.classList.remove("revealed", "resetting");
    void panel.offsetWidth;
    panel.classList.add("resetting");
  }

  elements.packetOutput.innerHTML = "";
  elements.urgencyBadge.textContent = "not run";
  elements.urgencyBadge.className = "badge";
  elements.selectedBadge.textContent = "waiting";
  elements.proposalOutput.innerHTML = "";
  elements.consentBadge.textContent = "waiting";
  elements.consentBadge.className = "badge";
  elements.consentReason.textContent = "Run the harness to evaluate execution permission.";
  elements.verificationOutput.innerHTML = "";
  renderQuality(null);
  renderArtifact();
  renderTabs();
  elements.saveArtifactsButton.disabled = true;
  elements.saveNote.textContent = "Saved files will appear under generated-artifacts/.";
  elements.saveNote.classList.remove("saved");
}

function renderLedger() {
  elements.ledgerCount.textContent = `${state.ledger.length} entries`;
  const latestHash = state.ledger.at(-1)?.hash ?? "GENESIS";
  elements.chainStatus.textContent = `Ledger: ${latestHash}`;
  elements.ledgerOutput.innerHTML = "";

  for (const entry of [...state.ledger].reverse()) {
    const row = document.createElement("div");
    row.className = "ledger-entry";
    row.innerHTML = `
      <div class="ledger-hash"></div>
      <div>
        <strong></strong>
        <p class="muted"></p>
      </div>
      <span class="badge"></span>
    `;
    row.querySelector(".ledger-hash").textContent = entry.hash;
    row.querySelector("strong").textContent = entry.selectedPlan.title;
    row.querySelector("p").textContent = `Previous: ${entry.previousHash}`;
    row.querySelector(".badge").textContent = entry.consent.status;
    elements.ledgerOutput.append(row);
  }
}

function scoreCell(label, value) {
  return `<div class="score"><span>${label}</span>${value}</div>`;
}

function beginProcessing(activeSteps = []) {
  elements.loopConsole.classList.add("processing");
  elements.loopConsole.classList.remove("restarting");
  void elements.loopConsole.offsetWidth;
  elements.loopConsole.classList.add("restarting");
  elements.processTitle.textContent = "drive sequence active";
  elements.completionBeacon.classList.remove("ready");
  elements.completionNote.textContent = "Generating artifacts...";
  for (const step of elements.processSteps) {
    step.classList.remove("active", "done");
    if (activeSteps.includes(step.dataset.processStep)) step.classList.add("active");
  }
  for (const panel of elements.revealPanels) {
    panel.classList.remove("revealed");
  }
}

function endProcessing(ai) {
  elements.loopConsole.classList.remove("processing");
  elements.processTitle.textContent = ai?.status === "used" ? "gemini response locked" : "fallback response locked";
  for (const step of elements.processSteps) {
    step.classList.remove("active");
    step.classList.add("done");
  }
  signalCompletion(ai);
}

function revealResults() {
  elements.revealPanels.forEach((panel, index) => {
    window.setTimeout(() => {
      panel.classList.remove("revealed", "resetting");
      void panel.offsetWidth;
      panel.classList.add("revealed");
    }, index * 70);
  });
}

async function runWithServer(input, previousHash) {
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, previousHash, taskMode: state.taskMode }),
    });

    if (!response.ok) throw new Error(`server returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Local fallback: ${error.message}`);
    return {
      ...runHarness(input, previousHash, null, { taskMode: state.taskMode }),
      input,
      ai: { provider: "local", model: "browser-fallback", status: "fallback" },
    };
  }
}

async function refineWithServer(input, previousHash, previousResult) {
  try {
    const response = await fetch("/api/refine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, previousHash, previousResult, taskMode: state.taskMode }),
    });

    if (!response.ok) throw new Error(`server returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Refine fallback: ${error.message}`);
    return {
      ...runHarness(
        `${input}\n\nRefine once: strengthen acceptance criteria, test notes, and saved artifact clarity.`,
        previousHash,
        null,
        { iteration: 2, taskMode: state.taskMode },
      ),
      input,
      ai: { provider: "local", model: "browser-refine-fallback", status: "fallback" },
    };
  }
}

function renderTaskMode() {
  for (const button of elements.modeButtons) {
    button.classList.toggle("active", button.dataset.taskMode === state.taskMode);
  }
}

async function saveArtifacts(result) {
  try {
    const response = await fetch("/api/save-artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: result.artifacts,
        ledgerEntry: result.ledgerEntry,
        input: result.input || elements.inputText.value,
      }),
    });

    if (!response.ok) throw new Error(`server returned ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Save failed: ${error.message}`);
    return null;
  }
}

function animateLoop(steps = ["Observe", "Packetize", "Plan", "Evaluate", "Gate", "Act", "Verify", "Log"]) {
  elements.loopStage.classList.add("running");
  elements.loopStatus.textContent = "running";

  for (const node of elements.loopNodes) {
    node.classList.remove("active", "done");
  }

  steps.forEach((step, index) => {
    window.setTimeout(() => {
      for (const node of elements.loopNodes) {
        if (node.dataset.step === step) {
          node.classList.add("active");
        } else if (steps.slice(0, index).includes(node.dataset.step)) {
          node.classList.add("done");
          node.classList.remove("active");
        }
      }
      updateProcessStep(step, index, steps);
      elements.loopStatus.textContent = step.toLowerCase();
    }, index * 170);
  });

  window.setTimeout(() => {
    for (const node of elements.loopNodes) {
      node.classList.remove("active");
      if (steps.includes(node.dataset.step)) node.classList.add("done");
    }
    elements.loopStage.classList.remove("running");
    elements.loopStatus.textContent = "logged";
  }, steps.length * 170 + 240);
}

function updateProcessStep(step, index, steps) {
  for (const item of elements.processSteps) {
    const isCurrent = item.dataset.processStep === step;
    const isDone = steps.slice(0, index).includes(item.dataset.processStep);
    item.classList.toggle("active", isCurrent);
    item.classList.toggle("done", isDone);
  }
  elements.processTitle.textContent = `${step.toLowerCase()} in progress`;
}

function signalCompletion(ai) {
  const source = ai?.status === "used" ? "Gemini + Harness" : "Local Harness";
  elements.completionNote.textContent = `${source} run complete. Check README / Issue / Decision tabs here.`;
  elements.completionBeacon.classList.add("ready");
  elements.artifactsPanel.classList.remove("complete-glow");
  void elements.artifactsPanel.offsetWidth;
  elements.artifactsPanel.classList.add("complete-glow");
  elements.artifactsPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

renderArtifact();
renderTaskMode();
