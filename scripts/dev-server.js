import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarness } from "../packages/core/intentops.js";

const root = normalize(join(fileURLToPath(new URL("../", import.meta.url))));
const port = Number(process.env.PORT || 4173);

loadDotEnv();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://localhost:${port}`);

    if (request.method === "POST" && url.pathname === "/api/run") {
      await handleRun(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/save-artifacts") {
      await handleSaveArtifacts(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/refine") {
      await handleRefine(request, response);
      return;
    }

    serveStatic(url.pathname, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => {
  console.log(`IntentOps Harness demo running at http://localhost:${port}`);
});

async function handleRun(request, response) {
  const body = await readJsonBody(request);
  const input = String(body.input || "");
  const previousHash = String(body.previousHash || "GENESIS");
  const taskMode = normalizeTaskMode(body.taskMode);

  if (!input.trim()) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "input is required" }));
    return;
  }

  const aiDraft = await createGeminiDraft(input, taskMode);
  const result = runHarness(input, previousHash, aiDraft, { taskMode });

  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      ...result,
      input,
      ai: aiDraft
        ? { provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-flash", status: "used" }
        : { provider: "local", model: "rule-based-fallback", status: "fallback" },
    }),
  );
}

async function handleRefine(request, response) {
  const body = await readJsonBody(request);
  const input = String(body.input || "");
  const previousHash = String(body.previousHash || "GENESIS");
  const taskMode = normalizeTaskMode(body.taskMode);
  const previousResult = body.previousResult || {};
  const previousQuality = previousResult.qualityGate || {};
  const nextIteration = Math.min(Number(previousQuality.iteration || 1) + 1, 2);

  if (!input.trim()) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "input is required" }));
    return;
  }

  const refinementInput = [
    input,
    "",
    "Refinement request:",
    "Improve the previous artifacts so the Quality Gate can reach at least 80%.",
    "Strengthen acceptance criteria, test notes, saved artifact clarity, and reviewer usefulness.",
    "Keep the plan safe and avoid direct deployment or remote side effects.",
    "",
    "Previous quality findings:",
    ...(previousQuality.findings || []),
    "",
    "Previous selected plan:",
    previousResult.selected?.title || "",
    previousResult.selected?.action || "",
  ].join("\n");

  const aiDraft = await createGeminiDraft(refinementInput, taskMode);
  const result = runHarness(refinementInput, previousHash, aiDraft, { iteration: nextIteration, taskMode });

  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      ...result,
      input,
      refinedFrom: previousResult.ledgerEntry?.hash || null,
      ai: aiDraft
        ? { provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-flash", status: "used" }
        : { provider: "local", model: "rule-based-fallback", status: "fallback" },
    }),
  );
}

async function handleSaveArtifacts(request, response) {
  const body = await readJsonBody(request);
  const artifacts = body.artifacts || {};
  const ledgerEntry = body.ledgerEntry || {};
  const input = String(body.input || "");
  const hash = safeSegment(String(ledgerEntry.hash || `run-${Date.now()}`));
  const outputDir = join(root, "generated-artifacts", hash);

  if (!artifacts.readmeDraft || !artifacts.issueDraft || !artifacts.decisionRecord) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "missing artifacts" }));
    return;
  }

  mkdirSync(outputDir, { recursive: true });

  const files = [
    ["README-draft.md", artifacts.readmeDraft],
    ["issue-draft.md", artifacts.issueDraft],
    ["decision-record.md", artifacts.decisionRecord],
    ["artifact-preview.html", createArtifactPreview({ artifacts, ledgerEntry, input, outputDir, hash })],
    [
      "manifest.json",
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          ledgerHash: ledgerEntry.hash || null,
          previousHash: ledgerEntry.previousHash || null,
          taskMode: ledgerEntry.taskMode || null,
          selectedPlan: ledgerEntry.selectedPlan?.title || null,
          consent: ledgerEntry.consent?.status || null,
          qualityScore: ledgerEntry.qualityGate?.score || null,
          qualityStatus: ledgerEntry.qualityGate?.status || null,
          artifactType: ledgerEntry.artifactSpec?.artifactType || null,
        },
        null,
        2,
      ),
    ],
  ];

  for (const [name, content] of files) {
    writeFileSync(join(outputDir, name), String(content), "utf8");
  }

  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      directory: `generated-artifacts/${hash}`,
      files: files.map(([name]) => `generated-artifacts/${hash}/${name}`),
    }),
  );
}

function serveStatic(pathname, response) {
  const requestPath = pathname === "/" ? "/app/index.html" : pathname;
  const filePath = normalize(join(root, requestPath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

async function createGeminiDraft(input, taskMode = "document") {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!key || key === "replace_with_your_gemini_api_key") return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = [
    "You are the planning brain for IntentOps Harness, an auditable AI DevOps agent.",
    "Return strict JSON only. Do not wrap it in Markdown.",
    "The harness will handle risk gates and audit logs, so your job is to structure intent and propose safe action options.",
    `Task mode: ${taskMode}.`,
    "",
    "JSON schema:",
    "{",
    '  "packet": {',
    '    "summary": "short summary",',
    '    "goal": "main goal",',
    '    "context": "operational context",',
    '    "constraints": ["constraint"],',
    '    "urgency": "normal or elevated",',
    '    "riskSignals": ["low", "medium", "high"],',
    '    "nextActions": ["next action"]',
    "  },",
    '  "proposals": [',
    "    {",
    '      "id": "short-kebab-id",',
    '      "title": "proposal title",',
    '      "action": "what to do",',
    '      "risk": "low or medium or high",',
    '      "roleNotes": {',
    '        "builder": "builder view",',
    '        "reviewer": "reviewer view",',
    '        "risk": "risk view",',
    '        "product": "product view"',
    "      }",
    "    }",
    "  ],",
    '  "artifactSpec": {',
    '    "title": "preview title",',
    '    "artifactType": "calculator | game | report | dashboard | document | generic",',
    '    "summary": "what the saved preview should communicate",',
    '    "highlights": ["short highlight"],',
    '    "sections": [',
    '      { "heading": "section heading", "body": "safe plain-text content for the preview" }',
    "    ],",
    '    "table": [',
    '      { "Label": "row label", "Value": "row value" }',
    "    ]",
    "  }",
    "}",
    "",
    "For artifactSpec, do not output HTML, CSS, JavaScript, Markdown fences, external links, or remote resources.",
    "Use artifactSpec to make the saved artifact-preview.html domain-aware for the user request.",
    "Examples: RPG requests should include character/map/quest/battle sections; financial requests should include metric rows and risk/next-action sections.",
    "If the user asks to create a web app or game, prefer a browser artifact/preview direction over CLI unless the user explicitly asks for CLI.",
    "Avoid selecting a plan-only or requirements-only output when the user asks to make a playable app or game.",
    ...(taskMode === "app-game"
      ? [
          "For app-game mode, the selected proposal must target a browser-based artifact preview.",
          "Do not choose CLI, document-only, planning-only, or requirements-only output.",
          "artifactSpec should describe a tangible playable UI state, controls, scoring/state, and core interaction loop.",
          "If the exact game is unknown to the renderer, still make the preview specific enough for the harness to render a useful prototype.",
        ]
      : []),
    ...(taskMode === "document"
      ? [
          "For document mode, prioritize reviewer-ready written artifacts, summaries, decision records, tables, and next actions.",
        ]
      : []),
    "",
    "Developer input:",
    input,
  ].join("\n");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Gemini fallback: ${response.status} ${errorText.slice(0, 240)}`);
      return null;
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    return JSON.parse(stripJsonFence(text));
  } catch (error) {
    console.warn(`Gemini fallback: ${error.message}`);
    return null;
  }
}

function normalizeTaskMode(value) {
  return ["document", "app-game", "general"].includes(value) ? value : "document";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function loadDotEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function stripJsonFence(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
}

function createArtifactPreview({ artifacts, ledgerEntry, input, outputDir, hash }) {
  const packet = ledgerEntry.packet || {};
  const selectedPlan = ledgerEntry.selectedPlan || {};
  const artifactSpec = ledgerEntry.artifactSpec || {};
  const taskMode = ledgerEntry.taskMode || "document";
  const sourceText = [
    packet.summary,
    packet.goal,
    packet.context,
    input,
    selectedPlan.title,
    selectedPlan.action,
    artifacts.readmeDraft,
    artifacts.issueDraft,
    artifacts.decisionRecord,
    artifactSpec.title,
    artifactSpec.artifactType,
    artifactSpec.summary,
    ...(artifactSpec.highlights || []),
    ...(artifactSpec.sections || []).flatMap((section) => [section.heading, section.body]),
    ...(artifactSpec.table || []).flatMap((row) => Object.values(row || {})),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const shouldShowCalculator = sourceText.includes("calculator") || sourceText.includes("\u96fb\u5353");
  const shouldShowInvader =
    sourceText.includes("invader") ||
    sourceText.includes("space invaders") ||
    sourceText.includes("\u30a4\u30f3\u30d9\u30fc\u30c0\u30fc");
  const shouldShowBreakout =
    sourceText.includes("breakout") ||
    sourceText.includes("brick breaker") ||
    sourceText.includes("brick-breaker") ||
    sourceText.includes("\u30d6\u30ed\u30c3\u30af\u5d29\u3057");
  const shouldShowPacMaze =
    sourceText.includes("pac-man") ||
    sourceText.includes("pacman") ||
    sourceText.includes("pac maze") ||
    sourceText.includes("pac-maze") ||
    sourceText.includes("\u30d1\u30c3\u30af\u30de\u30f3");
  const shouldShowOthello =
    sourceText.includes("othello") ||
    sourceText.includes("reversi") ||
    sourceText.includes("\u30aa\u30bb\u30ed");
  const shouldShowWarCard = sourceText.includes("war card") || sourceText.includes("'war'") || sourceText.includes("card game");
  const shouldShowGenericAppGame =
    taskMode === "app-game" && String(artifactSpec.artifactType || "").toLowerCase() === "game";
  const shouldShowGame =
    sourceText.includes("mini-game") ||
    sourceText.includes("minigame") ||
    sourceText.includes("click game") ||
    sourceText.includes("tap game");
  const optionalDemo = shouldShowCalculator
    ? calculatorDemoHtml()
    : shouldShowInvader
      ? invaderDemoHtml()
      : shouldShowBreakout
        ? breakoutDemoHtml()
        : shouldShowPacMaze
          ? pacMazeDemoHtml()
          : shouldShowOthello
            ? othelloDemoHtml()
            : shouldShowWarCard
              ? warCardDemoHtml()
              : shouldShowGame
                ? gameDemoHtml()
                : shouldShowGenericAppGame
                  ? genericAppGameDemoHtml(artifactSpec)
                  : structuredPreviewHtml(artifactSpec);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IntentOps Artifact Preview</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #edf4f1;
        --surface: #ffffff;
        --ink: #1d2528;
        --muted: #667275;
        --line: #dce2df;
        --accent: #1f7a6d;
        --mint: #5ee0bd;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(rgba(31, 122, 109, 0.055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(31, 122, 109, 0.055) 1px, transparent 1px),
          var(--bg);
        background-size: 28px 28px;
        color: var(--ink);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 20px;
        padding: 32px clamp(18px, 4vw, 56px);
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.86);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: var(--accent);
        font-size: 13px;
        font-weight: 900;
        text-transform: uppercase;
      }
      h1 { margin: 0; font-size: clamp(28px, 4vw, 48px); letter-spacing: 0; }
      main {
        display: grid;
        grid-template-columns: minmax(280px, 0.9fr) minmax(320px, 1.1fr);
        gap: 22px;
        padding: 26px clamp(18px, 4vw, 56px) 48px;
      }
      section {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        box-shadow: 0 18px 44px rgba(26, 38, 41, 0.1);
        padding: 20px;
      }
      .span { grid-column: 1 / -1; }
      .path-box {
        grid-column: 1 / -1;
        border: 1px solid rgba(31, 122, 109, 0.18);
        background: #f6fbf9;
      }
      .path-row {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 12px;
        align-items: center;
        margin-top: 10px;
      }
      .path-label {
        color: var(--muted);
        font-size: 13px;
        font-weight: 900;
      }
      .path-value {
        overflow-wrap: anywhere;
        border-radius: 6px;
        background: #fff;
        color: var(--accent);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 13px;
        padding: 10px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        border-radius: 999px;
        background: #ecf8f4;
        color: var(--accent);
        font-size: 12px;
        font-weight: 900;
        padding: 0 12px;
      }
      dl {
        display: grid;
        grid-template-columns: 130px 1fr;
        gap: 12px 16px;
      }
      dt { color: var(--muted); font-size: 13px; font-weight: 900; }
      dd { margin: 0; line-height: 1.55; }
      pre {
        margin: 0;
        overflow: auto;
        border-radius: 8px;
        background: #172124;
        color: #e9f1ee;
        padding: 18px;
        white-space: pre-wrap;
        line-height: 1.55;
      }
      @media (max-width: 900px) {
        header { align-items: start; flex-direction: column; }
        main { grid-template-columns: 1fr; }
        dl { grid-template-columns: 1fr; }
      }
      ${shouldShowCalculator ? calculatorStyles() : ""}
      ${shouldShowInvader ? invaderStyles() : ""}
      ${shouldShowBreakout ? breakoutStyles() : ""}
      ${shouldShowPacMaze ? pacMazeStyles() : ""}
      ${shouldShowOthello ? othelloStyles() : ""}
      ${shouldShowWarCard ? warCardStyles() : ""}
      ${shouldShowGame ? gameStyles() : ""}
      ${shouldShowGenericAppGame && !shouldShowPacMaze && !shouldShowOthello && !shouldShowWarCard && !shouldShowBreakout && !shouldShowInvader && !shouldShowCalculator && !shouldShowGame ? genericAppGameStyles() : ""}
      ${!shouldShowCalculator && !shouldShowInvader && !shouldShowBreakout && !shouldShowPacMaze && !shouldShowOthello && !shouldShowWarCard && !shouldShowGame && !shouldShowGenericAppGame ? structuredPreviewStyles() : ""}
    </style>
  </head>
  <body>
    <header>
      <div>
        <p class="eyebrow">IntentOps Artifact Preview</p>
        <h1>${escapeHtml(artifactSpec.title || selectedPlan.title || "Generated Artifact")}</h1>
      </div>
      <span class="badge">Ledger ${escapeHtml(ledgerEntry.hash || "untracked")}</span>
    </header>
    <main>
      <section class="path-box">
        <h2>Saved Location</h2>
        <div class="path-row">
          <div class="path-label">Folder</div>
          <div class="path-value">${escapeHtml(outputDir)}</div>
        </div>
        <div class="path-row">
          <div class="path-label">This file</div>
          <div class="path-value">${escapeHtml(join(outputDir, "artifact-preview.html"))}</div>
        </div>
      </section>
      <section>
        <h2>Decision Summary</h2>
        <dl>
          <dt>Goal</dt>
          <dd>${escapeHtml(packet.goal || "Not provided")}</dd>
          <dt>Consent</dt>
          <dd>${escapeHtml(ledgerEntry.consent?.status || "not recorded")}</dd>
          <dt>Risk</dt>
          <dd>${escapeHtml(selectedPlan.risk || "not recorded")}</dd>
          <dt>Quality</dt>
          <dd>${escapeHtml(ledgerEntry.qualityGate ? `${ledgerEntry.qualityGate.score}% ${ledgerEntry.qualityGate.status}` : "not recorded")}</dd>
          <dt>Plan</dt>
          <dd>${escapeHtml(selectedPlan.action || "Not provided")}</dd>
        </dl>
      </section>
      ${optionalDemo}
      <section class="span">
        <h2>README Draft</h2>
        <pre>${escapeHtml(artifacts.readmeDraft)}</pre>
      </section>
      <section>
        <h2>Issue Draft</h2>
        <pre>${escapeHtml(artifacts.issueDraft)}</pre>
      </section>
      <section>
        <h2>Decision Record</h2>
        <pre>${escapeHtml(artifacts.decisionRecord)}</pre>
      </section>
    </main>
    ${shouldShowCalculator ? calculatorScript() : ""}
    ${shouldShowInvader ? invaderScript() : ""}
    ${shouldShowBreakout ? breakoutScript() : ""}
    ${shouldShowPacMaze ? pacMazeScript() : ""}
    ${shouldShowOthello ? othelloScript() : ""}
    ${shouldShowWarCard ? warCardScript() : ""}
    ${shouldShowGame ? gameScript() : ""}
    ${shouldShowGenericAppGame && !shouldShowPacMaze && !shouldShowOthello && !shouldShowWarCard && !shouldShowBreakout && !shouldShowInvader && !shouldShowCalculator && !shouldShowGame ? genericAppGameScript() : ""}
  </body>
</html>
`;
}

function structuredPreviewHtml(spec = {}) {
  const sections = Array.isArray(spec.sections) ? spec.sections.slice(0, 8) : [];
  const highlights = Array.isArray(spec.highlights) ? spec.highlights.slice(0, 6) : [];
  const table = Array.isArray(spec.table) ? spec.table.slice(0, 8) : [];
  const tableKeys = [...new Set(table.flatMap((row) => Object.keys(row || {}).slice(0, 5)))].slice(0, 5);

  return `<section class="structured-preview">
        <div class="structured-head">
          <div>
            <h2>${escapeHtml(spec.title || "Generated Output")}</h2>
            <p>${escapeHtml(spec.summary || "Review this safe, structured preview before applying any side effects.")}</p>
          </div>
          <span class="badge">${escapeHtml(spec.artifactType || "generic")}</span>
        </div>
        ${
          highlights.length
            ? `<div class="highlight-grid">${highlights
                .map((highlight) => `<div class="highlight-item">${escapeHtml(highlight)}</div>`)
                .join("")}</div>`
            : ""
        }
        ${
          sections.length
            ? `<div class="preview-sections">${sections
                .map(
                  (section) => `<article>
                    <h3>${escapeHtml(section.heading || "Section")}</h3>
                    <p>${escapeHtml(section.body || "")}</p>
                  </article>`,
                )
                .join("")}</div>`
            : `<p>This page is a saved one-file preview of the artifacts generated by IntentOps Harness. Review the Markdown drafts below before applying any side effects.</p>`
        }
        ${
          table.length && tableKeys.length
            ? `<div class="table-wrap">
                <table>
                  <thead><tr>${tableKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead>
                  <tbody>
                    ${table
                      .map(
                        (row) =>
                          `<tr>${tableKeys.map((key) => `<td>${escapeHtml(row?.[key] ?? "")}</td>`).join("")}</tr>`,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : ""
        }
      </section>`;
}

function genericPreviewHtml() {
  return `<section>
        <h2>Generated Output</h2>
        <p>This page is a saved one-file preview of the artifacts generated by IntentOps Harness. Review the Markdown drafts below before applying any side effects.</p>
      </section>`;
}

function calculatorDemoHtml() {
  return `<section>
        <h2>Calculator Preview</h2>
        <div class="calculator" aria-label="Calculator demo">
          <output id="display">0</output>
          <div class="keys">
            <button data-key="7">7</button>
            <button data-key="8">8</button>
            <button data-key="9">9</button>
            <button data-key="/" class="op">/</button>
            <button data-key="4">4</button>
            <button data-key="5">5</button>
            <button data-key="6">6</button>
            <button data-key="*" class="op">*</button>
            <button data-key="1">1</button>
            <button data-key="2">2</button>
            <button data-key="3">3</button>
            <button data-key="-" class="op">-</button>
            <button data-key="0">0</button>
            <button data-key=".">.</button>
            <button data-key="=" class="equals">=</button>
            <button data-key="+" class="op">+</button>
            <button data-key="clear" class="clear">Clear</button>
          </div>
        </div>
      </section>`;
}

function gameDemoHtml() {
  return `<section>
        <h2>Mini Game Preview</h2>
        <div class="game-demo" aria-label="Mini game preview">
          <div class="game-hud">
            <strong>Score: <span id="score">0</span></strong>
            <span>Time: <span id="time">20</span>s</span>
          </div>
          <button id="target" type="button">Tap</button>
          <p id="gameStatus">Click the target before time runs out.</p>
          <button id="restart" type="button">Restart</button>
        </div>
      </section>`;
}

function invaderDemoHtml() {
  return `<section>
        <h2>Invader Game Preview</h2>
        <div class="invader-demo" aria-label="Invader game preview">
          <div class="invader-hud">
            <strong>Score: <span id="invaderScore">0</span></strong>
            <span id="invaderStatus">Move: Left / Right, Fire: Space</span>
          </div>
          <div id="invaderField">
            <div id="invaderFleet"></div>
            <div id="ship"></div>
            <div id="laser"></div>
          </div>
          <div class="invader-controls">
            <button id="leftBtn" type="button">Left</button>
            <button id="fireBtn" type="button">Fire</button>
            <button id="rightBtn" type="button">Right</button>
            <button id="resetInvaders" type="button">Restart</button>
          </div>
        </div>
      </section>`;
}

function breakoutDemoHtml() {
  return `<section>
        <h2>Block Breaker Preview</h2>
        <div class="breakout-demo" aria-label="Block breaker game preview">
          <div class="breakout-hud">
            <strong>Score: <span id="breakoutScore">0</span></strong>
            <span id="breakoutStatus">Move the paddle and break all blocks.</span>
          </div>
          <canvas id="breakoutCanvas" width="520" height="340"></canvas>
          <div class="breakout-controls">
            <button id="breakoutLeft" type="button">Left</button>
            <button id="breakoutLaunch" type="button">Launch</button>
            <button id="breakoutRight" type="button">Right</button>
            <button id="breakoutReset" type="button">Restart</button>
          </div>
        </div>
      </section>`;
}

function pacMazeDemoHtml() {
  return `<section>
        <h2>Pac-Maze Preview</h2>
        <div class="pac-demo" aria-label="Pac-Man inspired maze preview">
          <div class="pac-hud">
            <strong>Score: <span id="pacScore">0</span></strong>
            <span id="pacStatus">Use arrow keys. Collect all pellets.</span>
          </div>
          <div id="pacMaze" aria-label="Pac maze board"></div>
          <button id="pacReset" type="button">Restart</button>
        </div>
      </section>`;
}

function othelloDemoHtml() {
  return `<section>
        <h2>Othello Preview</h2>
        <div class="othello-demo" aria-label="Othello game preview">
          <div class="othello-hud">
            <strong>Turn: <span id="othelloTurn">Black</span></strong>
            <span id="othelloScore">Black 2 / White 2</span>
          </div>
          <div id="othelloBoard" aria-label="Othello board"></div>
          <p id="othelloStatus">Place a disc on a highlighted square.</p>
          <button id="othelloReset" type="button">Restart</button>
        </div>
      </section>`;
}

function genericAppGameDemoHtml(spec = {}) {
  return `<section>
        <h2>${escapeHtml(spec.title || "Playable Prototype Preview")}</h2>
        <div class="proto-demo" aria-label="Generic playable game preview">
          <div class="proto-hud">
            <strong>Score: <span id="protoScore">0</span></strong>
            <span id="protoStatus">Move with arrow keys and collect the markers.</span>
          </div>
          <div id="protoField"></div>
          <button id="protoReset" type="button">Restart</button>
        </div>
      </section>`;
}

function warCardDemoHtml() {
  return `<section>
        <h2>Card Game Preview</h2>
        <div class="war-demo" aria-label="War card game preview">
          <div class="war-score">
            <strong>Player <span id="playerScore">0</span></strong>
            <strong>CPU <span id="cpuScore">0</span></strong>
          </div>
          <div class="war-table">
            <div class="card-face" id="playerCard">?</div>
            <div class="card-face" id="cpuCard">?</div>
          </div>
          <p id="warStatus">Draw a card. Higher card wins the round.</p>
          <div class="war-actions">
            <button id="drawCard" type="button">Draw</button>
            <button id="resetWar" type="button">Restart</button>
          </div>
        </div>
      </section>`;
}

function structuredPreviewStyles() {
  return `
      .structured-preview {
        display: grid;
        gap: 18px;
      }
      .structured-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
      }
      .structured-head p {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }
      .highlight-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
      }
      .highlight-item {
        border: 1px solid rgba(31, 122, 109, 0.18);
        border-radius: 8px;
        background: #f6fbf9;
        color: var(--accent);
        font-size: 14px;
        font-weight: 800;
        line-height: 1.45;
        padding: 12px;
      }
      .preview-sections {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .preview-sections article {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fbfdfc;
        padding: 14px;
      }
      .preview-sections h3 {
        margin: 0 0 8px;
        font-size: 17px;
      }
      .preview-sections p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 520px;
      }
      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 12px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f6fbf9;
        color: var(--accent);
        font-size: 12px;
        text-transform: uppercase;
      }
      tr:last-child td {
        border-bottom: 0;
      }`;
}

function calculatorStyles() {
  return `
      .calculator {
        max-width: 360px;
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      #display {
        display: block;
        width: 100%;
        min-height: 72px;
        margin-bottom: 12px;
        border-radius: 8px;
        background: #172124;
        color: #e9f1ee;
        font-size: 34px;
        font-weight: 800;
        line-height: 72px;
        overflow: hidden;
        padding: 0 16px;
        text-align: right;
      }
      .keys {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .keys button {
        min-height: 52px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--ink);
        cursor: pointer;
        font: inherit;
        font-weight: 800;
      }
      .keys button:hover {
        border-color: var(--accent);
      }
      .keys .op,
      .keys .equals {
        background: #1f7a6d;
        border-color: #1f7a6d;
        color: #fff;
      }
      .keys .clear {
        grid-column: 1 / -1;
        background: #ecf8f4;
        color: var(--accent);
      }`;
}

function gameStyles() {
  return `
      .game-demo {
        position: relative;
        min-height: 360px;
        overflow: hidden;
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background:
          linear-gradient(rgba(31, 122, 109, 0.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(31, 122, 109, 0.07) 1px, transparent 1px),
          #f6fbf9;
        background-size: 24px 24px;
        padding: 16px;
      }
      .game-hud {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #target {
        position: absolute;
        left: 48%;
        top: 48%;
        width: 78px;
        height: 78px;
        border: 0;
        border-radius: 50%;
        background: #1f7a6d;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 900;
        box-shadow: 0 0 26px rgba(94, 224, 189, 0.5);
      }
      #gameStatus {
        position: absolute;
        left: 16px;
        bottom: 58px;
        margin: 0;
        color: var(--muted);
      }
      #restart {
        position: absolute;
        left: 16px;
        bottom: 16px;
        min-height: 36px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--accent);
        cursor: pointer;
        font: inherit;
        font-weight: 900;
        padding: 0 14px;
      }`;
}

function invaderStyles() {
  return `
      .invader-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .invader-hud {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #invaderField {
        position: relative;
        height: 360px;
        overflow: hidden;
        border-radius: 8px;
        background:
          linear-gradient(rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          #101b1f;
        background-size: 24px 24px;
      }
      #invaderFleet {
        position: absolute;
        left: 50%;
        top: 34px;
        display: grid;
        grid-template-columns: repeat(6, 34px);
        gap: 12px;
        transform: translateX(-50%);
      }
      .invader {
        width: 34px;
        height: 24px;
        border-radius: 6px 6px 3px 3px;
        background: var(--mint);
        box-shadow: 0 0 14px rgba(94, 224, 189, 0.46);
      }
      #ship {
        position: absolute;
        bottom: 20px;
        left: 50%;
        width: 54px;
        height: 28px;
        border-radius: 8px 8px 4px 4px;
        background: #1f7a6d;
        transform: translateX(-50%);
        box-shadow: 0 0 20px rgba(44, 184, 199, 0.42);
      }
      #ship::before {
        position: absolute;
        left: 19px;
        top: -13px;
        width: 16px;
        height: 16px;
        border-radius: 3px 3px 0 0;
        background: #1f7a6d;
        content: "";
      }
      #laser {
        position: absolute;
        display: none;
        width: 4px;
        height: 22px;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 0 14px rgba(255, 255, 255, 0.9);
      }
      .invader-controls {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-top: 12px;
      }
      .invader-controls button {
        min-height: 42px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--accent);
        cursor: pointer;
        font: inherit;
        font-weight: 900;
      }`;
}

function breakoutStyles() {
  return `
      .breakout-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .breakout-hud {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #breakoutCanvas {
        display: block;
        width: 100%;
        max-width: 520px;
        aspect-ratio: 52 / 34;
        border-radius: 8px;
        background:
          linear-gradient(rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          #101b1f;
        background-size: 24px 24px;
        box-shadow: inset 0 0 0 1px rgba(94, 224, 189, 0.16);
      }
      .breakout-controls {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-top: 12px;
      }
      .breakout-controls button {
        min-height: 42px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--accent);
        cursor: pointer;
        font: inherit;
        font-weight: 900;
      }`;
}

function pacMazeStyles() {
  return `
      .pac-demo,
      .proto-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .pac-hud,
      .proto-hud {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #pacMaze {
        display: grid;
        grid-template-columns: repeat(11, 28px);
        gap: 3px;
        width: max-content;
        max-width: 100%;
        overflow: auto;
        border-radius: 8px;
        background: #101b1f;
        padding: 8px;
      }
      .pac-cell {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 5px;
        background: #172124;
      }
      .pac-wall {
        background: #1f7a6d;
        box-shadow: inset 0 0 0 1px rgba(94, 224, 189, 0.35);
      }
      .pac-pellet::after {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #f8fbf9;
        content: "";
      }
      .pac-player::after,
      .pac-enemy::after {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        content: "";
      }
      .pac-player::after {
        background: #f0c84b;
        box-shadow: 0 0 14px rgba(240, 200, 75, 0.55);
      }
      .pac-enemy::after {
        background: #d85f7a;
        border-radius: 50% 50% 4px 4px;
      }
      #pacReset {
        margin-top: 12px;
        color: var(--accent);
        font-weight: 900;
      }`;
}

function genericAppGameStyles() {
  return `
      .proto-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .proto-hud {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #protoField {
        position: relative;
        height: 340px;
        overflow: hidden;
        border-radius: 8px;
        background:
          linear-gradient(rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(94, 224, 189, 0.08) 1px, transparent 1px),
          #101b1f;
        background-size: 24px 24px;
      }
      .proto-player,
      .proto-marker {
        position: absolute;
        display: grid;
        place-items: center;
        border-radius: 50%;
      }
      .proto-player {
        width: 34px;
        height: 34px;
        background: var(--mint);
        box-shadow: 0 0 18px rgba(94, 224, 189, 0.55);
      }
      .proto-marker {
        width: 18px;
        height: 18px;
        background: #fff;
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.7);
      }
      #protoReset {
        margin-top: 12px;
        color: var(--accent);
        font-weight: 900;
      }`;
}

function othelloStyles() {
  return `
      .othello-demo,
      .war-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .othello-hud,
      .war-score {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
        color: var(--accent);
        font-weight: 900;
      }
      #othelloBoard {
        display: grid;
        grid-template-columns: repeat(8, minmax(28px, 1fr));
        gap: 4px;
        max-width: 440px;
        border-radius: 8px;
        background: #172124;
        padding: 8px;
      }
      .othello-cell {
        position: relative;
        aspect-ratio: 1;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        background: #1f7a6d;
        cursor: pointer;
      }
      .othello-cell.valid {
        box-shadow: inset 0 0 0 2px rgba(94, 224, 189, 0.8);
      }
      .othello-cell.black::after,
      .othello-cell.white::after {
        position: absolute;
        inset: 16%;
        border-radius: 50%;
        content: "";
      }
      .othello-cell.black::after {
        background: #172124;
        box-shadow: inset 0 0 0 2px rgba(255,255,255,0.08);
      }
      .othello-cell.white::after {
        background: #f8fbf9;
        box-shadow: inset 0 0 0 2px rgba(0,0,0,0.12);
      }
      #othelloStatus {
        color: var(--muted);
        line-height: 1.5;
      }
      #othelloReset {
        min-height: 38px;
        color: var(--accent);
        font-weight: 900;
      }`;
}

function warCardStyles() {
  return `
      .war-demo {
        border: 1px solid rgba(31, 122, 109, 0.2);
        border-radius: 8px;
        background: #f6fbf9;
        padding: 16px;
      }
      .war-score,
      .war-actions,
      .war-table {
        display: flex;
        gap: 12px;
      }
      .war-score {
        justify-content: space-between;
        color: var(--accent);
        font-weight: 900;
      }
      .war-table {
        justify-content: center;
        margin: 22px 0;
      }
      .card-face {
        display: grid;
        place-items: center;
        width: 120px;
        height: 166px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #fff;
        color: var(--ink);
        font-size: 42px;
        font-weight: 900;
        box-shadow: 0 14px 24px rgba(26, 38, 41, 0.12);
      }
      .war-actions button {
        color: var(--accent);
        font-weight: 900;
      }`;
}

function calculatorScript() {
  return `<script>
      const display = document.querySelector("#display");
      let expression = "";
      document.querySelectorAll("[data-key]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.key;
          if (key === "clear") {
            expression = "";
            display.textContent = "0";
            return;
          }
          if (key === "=") {
            try {
              if (!/^[0-9+\\-*/.\\s]+$/.test(expression)) throw new Error("invalid");
              const result = Function('"use strict"; return (' + expression + ')')();
              expression = String(Number.isFinite(result) ? Number(result.toFixed(10)) : 0);
              display.textContent = expression;
            } catch {
              expression = "";
              display.textContent = "Error";
            }
            return;
          }
          expression += key;
          display.textContent = expression;
        });
      });
    </script>`;
}

function gameScript() {
  return `<script>
      const scoreEl = document.querySelector("#score");
      const timeEl = document.querySelector("#time");
      const target = document.querySelector("#target");
      const statusEl = document.querySelector("#gameStatus");
      const restart = document.querySelector("#restart");
      let score = 0;
      let time = 20;
      let timer = null;

      function moveTarget() {
        const box = target.parentElement.getBoundingClientRect();
        const x = 24 + Math.random() * Math.max(1, box.width - 126);
        const y = 56 + Math.random() * Math.max(1, box.height - 158);
        target.style.left = x + "px";
        target.style.top = y + "px";
      }

      function start() {
        score = 0;
        time = 20;
        scoreEl.textContent = score;
        timeEl.textContent = time;
        statusEl.textContent = "Click the target before time runs out.";
        target.disabled = false;
        moveTarget();
        clearInterval(timer);
        timer = setInterval(() => {
          time -= 1;
          timeEl.textContent = time;
          if (time <= 0) {
            clearInterval(timer);
            target.disabled = true;
            statusEl.textContent = "Finished. Final score: " + score;
          }
        }, 1000);
      }

      target.addEventListener("click", () => {
        score += 1;
        scoreEl.textContent = score;
        moveTarget();
      });
      restart.addEventListener("click", start);
      start();
    </script>`;
}

function invaderScript() {
  return `<script>
      const field = document.querySelector("#invaderField");
      const fleet = document.querySelector("#invaderFleet");
      const ship = document.querySelector("#ship");
      const laser = document.querySelector("#laser");
      const scoreEl = document.querySelector("#invaderScore");
      const statusEl = document.querySelector("#invaderStatus");
      const leftBtn = document.querySelector("#leftBtn");
      const rightBtn = document.querySelector("#rightBtn");
      const fireBtn = document.querySelector("#fireBtn");
      const resetBtn = document.querySelector("#resetInvaders");
      let shipX = 50;
      let score = 0;
      let laserTimer = null;

      function buildFleet() {
        fleet.innerHTML = "";
        for (let i = 0; i < 18; i += 1) {
          const invader = document.createElement("div");
          invader.className = "invader";
          fleet.append(invader);
        }
      }

      function moveShip(delta) {
        shipX = Math.max(8, Math.min(92, shipX + delta));
        ship.style.left = shipX + "%";
      }

      function fire() {
        if (laserTimer) return;
        const fieldRect = field.getBoundingClientRect();
        const shipRect = ship.getBoundingClientRect();
        let y = shipRect.top - fieldRect.top - 24;
        const x = shipRect.left - fieldRect.left + shipRect.width / 2;
        laser.style.display = "block";
        laser.style.left = x + "px";
        laser.style.top = y + "px";

        laserTimer = setInterval(() => {
          y -= 12;
          laser.style.top = y + "px";
          const laserRect = laser.getBoundingClientRect();
          for (const invader of [...document.querySelectorAll(".invader")]) {
            const rect = invader.getBoundingClientRect();
            const hit =
              laserRect.left < rect.right &&
              laserRect.right > rect.left &&
              laserRect.top < rect.bottom &&
              laserRect.bottom > rect.top;
            if (hit) {
              invader.remove();
              score += 10;
              scoreEl.textContent = score;
              stopLaser();
              if (!document.querySelector(".invader")) statusEl.textContent = "Cleared. All invaders removed.";
              return;
            }
          }
          if (y < 10) stopLaser();
        }, 28);
      }

      function stopLaser() {
        clearInterval(laserTimer);
        laserTimer = null;
        laser.style.display = "none";
      }

      function restart() {
        score = 0;
        shipX = 50;
        scoreEl.textContent = score;
        statusEl.textContent = "Move: Left / Right, Fire: Space";
        moveShip(0);
        stopLaser();
        buildFleet();
      }

      leftBtn.addEventListener("click", () => moveShip(-8));
      rightBtn.addEventListener("click", () => moveShip(8));
      fireBtn.addEventListener("click", fire);
      resetBtn.addEventListener("click", restart);
      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") moveShip(-8);
        if (event.key === "ArrowRight") moveShip(8);
        if (event.code === "Space") {
          event.preventDefault();
          fire();
        }
      });
      restart();
    </script>`;
}

function breakoutScript() {
  return `<script>
      const canvas = document.querySelector("#breakoutCanvas");
      const context = canvas.getContext("2d");
      const scoreEl = document.querySelector("#breakoutScore");
      const statusEl = document.querySelector("#breakoutStatus");
      const leftButton = document.querySelector("#breakoutLeft");
      const rightButton = document.querySelector("#breakoutRight");
      const launchButton = document.querySelector("#breakoutLaunch");
      const resetButton = document.querySelector("#breakoutReset");
      const width = canvas.width;
      const height = canvas.height;
      const keys = new Set();
      let paddle;
      let ball;
      let bricks;
      let score;
      let running;
      let frame;

      function reset() {
        paddle = { x: width / 2 - 48, y: height - 28, w: 96, h: 12, speed: 7 };
        ball = { x: width / 2, y: height - 46, r: 7, dx: 3.4, dy: -3.8 };
        bricks = [];
        score = 0;
        running = false;
        scoreEl.textContent = score;
        statusEl.textContent = "Press Launch, then use Left / Right or arrow keys.";
        for (let row = 0; row < 4; row += 1) {
          for (let col = 0; col < 8; col += 1) {
            bricks.push({ x: 24 + col * 60, y: 38 + row * 28, w: 48, h: 16, alive: true });
          }
        }
        draw();
      }

      function draw() {
        context.clearRect(0, 0, width, height);
        context.fillStyle = "#101b1f";
        context.fillRect(0, 0, width, height);
        context.strokeStyle = "rgba(94, 224, 189, 0.12)";
        for (let x = 0; x < width; x += 24) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, height);
          context.stroke();
        }
        for (let y = 0; y < height; y += 24) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
        for (const brick of bricks) {
          if (!brick.alive) continue;
          context.fillStyle = "#5ee0bd";
          context.shadowColor = "rgba(94, 224, 189, 0.7)";
          context.shadowBlur = 10;
          context.fillRect(brick.x, brick.y, brick.w, brick.h);
        }
        context.shadowBlur = 0;
        context.fillStyle = "#1f7a6d";
        context.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
        context.beginPath();
        context.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.shadowColor = "rgba(255, 255, 255, 0.85)";
        context.shadowBlur = 12;
        context.fill();
        context.shadowBlur = 0;
      }

      function collideBrick() {
        for (const brick of bricks) {
          if (!brick.alive) continue;
          const hit =
            ball.x + ball.r > brick.x &&
            ball.x - ball.r < brick.x + brick.w &&
            ball.y + ball.r > brick.y &&
            ball.y - ball.r < brick.y + brick.h;
          if (hit) {
            brick.alive = false;
            ball.dy *= -1;
            score += 10;
            scoreEl.textContent = score;
            if (bricks.every((item) => !item.alive)) {
              running = false;
              statusEl.textContent = "Cleared. All blocks removed.";
            }
            return;
          }
        }
      }

      function step() {
        if (keys.has("ArrowLeft")) paddle.x -= paddle.speed;
        if (keys.has("ArrowRight")) paddle.x += paddle.speed;
        paddle.x = Math.max(0, Math.min(width - paddle.w, paddle.x));

        if (running) {
          ball.x += ball.dx;
          ball.y += ball.dy;
          if (ball.x - ball.r <= 0 || ball.x + ball.r >= width) ball.dx *= -1;
          if (ball.y - ball.r <= 0) ball.dy *= -1;
          const paddleHit =
            ball.x > paddle.x &&
            ball.x < paddle.x + paddle.w &&
            ball.y + ball.r >= paddle.y &&
            ball.y - ball.r <= paddle.y + paddle.h;
          if (paddleHit && ball.dy > 0) ball.dy *= -1;
          collideBrick();
          if (ball.y - ball.r > height) {
            running = false;
            statusEl.textContent = "Missed. Press Restart to try again.";
          }
        } else if (statusEl.textContent.startsWith("Press")) {
          ball.x = paddle.x + paddle.w / 2;
          ball.y = paddle.y - 18;
        }

        draw();
        frame = requestAnimationFrame(step);
      }

      function launch() {
        if (!running && !bricks.every((item) => !item.alive)) {
          running = true;
          statusEl.textContent = "Breaking blocks.";
        }
      }

      leftButton.addEventListener("pointerdown", () => keys.add("ArrowLeft"));
      leftButton.addEventListener("pointerup", () => keys.delete("ArrowLeft"));
      rightButton.addEventListener("pointerdown", () => keys.add("ArrowRight"));
      rightButton.addEventListener("pointerup", () => keys.delete("ArrowRight"));
      launchButton.addEventListener("click", launch);
      resetButton.addEventListener("click", reset);
      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") keys.add(event.key);
        if (event.code === "Space") {
          event.preventDefault();
          launch();
        }
      });
      window.addEventListener("keyup", (event) => keys.delete(event.key));
      reset();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(step);
    </script>`;
}

function pacMazeScript() {
  return `<script>
      const mazeEl = document.querySelector("#pacMaze");
      const scoreEl = document.querySelector("#pacScore");
      const statusEl = document.querySelector("#pacStatus");
      const resetEl = document.querySelector("#pacReset");
      const layout = [
        "###########",
        "#.........#",
        "#.###.###.#",
        "#.#.....#.#",
        "#.#.###.#.#",
        "#...#E#...#",
        "#.#.###.#.#",
        "#.#.....#.#",
        "#.###.###.#",
        "#P........#",
        "###########",
      ];
      let player;
      let enemy;
      let pellets;
      let score;

      function resetPac() {
        pellets = new Set();
        score = 0;
        layout.forEach((row, r) => {
          [...row].forEach((cell, c) => {
            if (cell === "P") player = { r, c };
            if (cell === "E") enemy = { r, c };
            if (cell === ".") pellets.add(r + "," + c);
          });
        });
        renderPac();
      }

      function isWall(r, c) {
        return !layout[r] || layout[r][c] === "#";
      }

      function movePac(dr, dc) {
        const next = { r: player.r + dr, c: player.c + dc };
        if (isWall(next.r, next.c)) return;
        player = next;
        const key = player.r + "," + player.c;
        if (pellets.delete(key)) {
          score += 10;
          scoreEl.textContent = score;
        }
        moveEnemy();
        renderPac();
      }

      function moveEnemy() {
        const options = [[1,0],[-1,0],[0,1],[0,-1]]
          .map(([dr, dc]) => ({ r: enemy.r + dr, c: enemy.c + dc }))
          .filter((pos) => !isWall(pos.r, pos.c));
        options.sort((a, b) => Math.abs(a.r - player.r) + Math.abs(a.c - player.c) - (Math.abs(b.r - player.r) + Math.abs(b.c - player.c)));
        enemy = options[0] || enemy;
      }

      function renderPac() {
        mazeEl.innerHTML = "";
        scoreEl.textContent = score;
        for (let r = 0; r < layout.length; r += 1) {
          for (let c = 0; c < layout[r].length; c += 1) {
            const cell = document.createElement("div");
            cell.className = "pac-cell";
            if (layout[r][c] === "#") cell.classList.add("pac-wall");
            if (pellets.has(r + "," + c)) cell.classList.add("pac-pellet");
            if (player.r === r && player.c === c) cell.classList.add("pac-player");
            if (enemy.r === r && enemy.c === c) cell.classList.add("pac-enemy");
            mazeEl.append(cell);
          }
        }
        if (enemy.r === player.r && enemy.c === player.c) statusEl.textContent = "Caught. Restart to try again.";
        else if (pellets.size === 0) statusEl.textContent = "Cleared. All pellets collected.";
        else statusEl.textContent = "Use arrow keys. Pellets remaining: " + pellets.size;
      }

      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") movePac(-1, 0);
        if (event.key === "ArrowDown") movePac(1, 0);
        if (event.key === "ArrowLeft") movePac(0, -1);
        if (event.key === "ArrowRight") movePac(0, 1);
      });
      resetEl.addEventListener("click", resetPac);
      resetPac();
    </script>`;
}

function genericAppGameScript() {
  return `<script>
      const field = document.querySelector("#protoField");
      const scoreEl = document.querySelector("#protoScore");
      const statusEl = document.querySelector("#protoStatus");
      const resetEl = document.querySelector("#protoReset");
      let player;
      let markers;
      let score;

      function resetProto() {
        field.innerHTML = "";
        player = document.createElement("div");
        player.className = "proto-player";
        player.style.left = "24px";
        player.style.top = "24px";
        field.append(player);
        markers = [];
        score = 0;
        scoreEl.textContent = score;
        statusEl.textContent = "Move with arrow keys and collect the markers.";
        for (let i = 0; i < 8; i += 1) {
          const marker = document.createElement("div");
          marker.className = "proto-marker";
          marker.style.left = 48 + Math.random() * 380 + "px";
          marker.style.top = 48 + Math.random() * 220 + "px";
          field.append(marker);
          markers.push(marker);
        }
      }

      function moveProto(dx, dy) {
        const box = field.getBoundingClientRect();
        const x = Math.max(0, Math.min(box.width - 34, player.offsetLeft + dx));
        const y = Math.max(0, Math.min(box.height - 34, player.offsetTop + dy));
        player.style.left = x + "px";
        player.style.top = y + "px";
        const playerRect = player.getBoundingClientRect();
        for (const marker of [...markers]) {
          const rect = marker.getBoundingClientRect();
          const hit = playerRect.left < rect.right && playerRect.right > rect.left && playerRect.top < rect.bottom && playerRect.bottom > rect.top;
          if (hit) {
            marker.remove();
            markers = markers.filter((item) => item !== marker);
            score += 10;
            scoreEl.textContent = score;
          }
        }
        if (markers.length === 0) statusEl.textContent = "Cleared. Prototype loop complete.";
      }

      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") moveProto(0, -18);
        if (event.key === "ArrowDown") moveProto(0, 18);
        if (event.key === "ArrowLeft") moveProto(-18, 0);
        if (event.key === "ArrowRight") moveProto(18, 0);
      });
      resetEl.addEventListener("click", resetProto);
      resetProto();
    </script>`;
}

function othelloScript() {
  return `<script>
      const boardEl = document.querySelector("#othelloBoard");
      const turnEl = document.querySelector("#othelloTurn");
      const scoreEl = document.querySelector("#othelloScore");
      const statusEl = document.querySelector("#othelloStatus");
      const resetEl = document.querySelector("#othelloReset");
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      let board;
      let turn;

      function resetOthello() {
        board = Array.from({ length: 8 }, () => Array(8).fill(""));
        board[3][3] = "white";
        board[3][4] = "black";
        board[4][3] = "black";
        board[4][4] = "white";
        turn = "black";
        renderOthello();
      }

      function captures(row, col, color) {
        if (board[row][col]) return [];
        const other = color === "black" ? "white" : "black";
        const flips = [];
        for (const [dr, dc] of dirs) {
          const line = [];
          let r = row + dr;
          let c = col + dc;
          while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === other) {
            line.push([r, c]);
            r += dr;
            c += dc;
          }
          if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === color) flips.push(...line);
        }
        return flips;
      }

      function validMoves(color) {
        const moves = [];
        for (let r = 0; r < 8; r += 1) {
          for (let c = 0; c < 8; c += 1) {
            if (captures(r, c, color).length) moves.push([r, c]);
          }
        }
        return moves;
      }

      function play(row, col) {
        const flips = captures(row, col, turn);
        if (!flips.length) return;
        board[row][col] = turn;
        for (const [r, c] of flips) board[r][c] = turn;
        turn = turn === "black" ? "white" : "black";
        if (!validMoves(turn).length) turn = turn === "black" ? "white" : "black";
        renderOthello();
      }

      function renderOthello() {
        boardEl.innerHTML = "";
        const moves = validMoves(turn).map(([r, c]) => r + "," + c);
        let black = 0;
        let white = 0;
        for (let r = 0; r < 8; r += 1) {
          for (let c = 0; c < 8; c += 1) {
            const cell = document.createElement("button");
            const value = board[r][c];
            if (value === "black") black += 1;
            if (value === "white") white += 1;
            cell.className = "othello-cell " + value + (moves.includes(r + "," + c) ? " valid" : "");
            cell.type = "button";
            cell.addEventListener("click", () => play(r, c));
            boardEl.append(cell);
          }
        }
        turnEl.textContent = turn === "black" ? "Black" : "White";
        scoreEl.textContent = "Black " + black + " / White " + white;
        statusEl.textContent = moves.length ? "Place a disc on a highlighted square." : "No legal moves remain.";
      }

      resetEl.addEventListener("click", resetOthello);
      resetOthello();
    </script>`;
}

function warCardScript() {
  return `<script>
      const playerCard = document.querySelector("#playerCard");
      const cpuCard = document.querySelector("#cpuCard");
      const playerScoreEl = document.querySelector("#playerScore");
      const cpuScoreEl = document.querySelector("#cpuScore");
      const statusEl = document.querySelector("#warStatus");
      const drawEl = document.querySelector("#drawCard");
      const resetEl = document.querySelector("#resetWar");
      let playerScore = 0;
      let cpuScore = 0;
      const labels = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

      function draw() {
        const player = 1 + Math.floor(Math.random() * 13);
        const cpu = 1 + Math.floor(Math.random() * 13);
        playerCard.textContent = labels[player - 1];
        cpuCard.textContent = labels[cpu - 1];
        if (player > cpu) {
          playerScore += 1;
          statusEl.textContent = "Player wins the round.";
        } else if (cpu > player) {
          cpuScore += 1;
          statusEl.textContent = "CPU wins the round.";
        } else {
          statusEl.textContent = "War. This preview counts ties as a draw.";
        }
        playerScoreEl.textContent = playerScore;
        cpuScoreEl.textContent = cpuScore;
      }

      function reset() {
        playerScore = 0;
        cpuScore = 0;
        playerScoreEl.textContent = "0";
        cpuScoreEl.textContent = "0";
        playerCard.textContent = "?";
        cpuCard.textContent = "?";
        statusEl.textContent = "Draw a card. Higher card wins the round.";
      }

      drawEl.addEventListener("click", draw);
      resetEl.addEventListener("click", reset);
      reset();
    </script>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
