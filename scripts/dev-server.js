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

  if (!input.trim()) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "input is required" }));
    return;
  }

  const aiDraft = await createGeminiDraft(input);
  const result = runHarness(input, previousHash, aiDraft);

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
          selectedPlan: ledgerEntry.selectedPlan?.title || null,
          consent: ledgerEntry.consent?.status || null,
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

async function createGeminiDraft(input) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!key || key === "replace_with_your_gemini_api_key") return null;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = [
    "You are the planning brain for IntentOps Harness, an auditable AI DevOps agent.",
    "Return strict JSON only. Do not wrap it in Markdown.",
    "The harness will handle risk gates and audit logs, so your job is to structure intent and propose safe action options.",
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
    "  ]",
    "}",
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
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const shouldShowCalculator = sourceText.includes("calculator") || sourceText.includes("\u96fb\u5353");
  const shouldShowGame =
    sourceText.includes("mini-game") ||
    sourceText.includes("minigame") ||
    sourceText.includes("game") ||
    sourceText.includes("\u30b2\u30fc\u30e0");
  const optionalDemo = shouldShowCalculator
    ? calculatorDemoHtml()
    : shouldShowGame
      ? gameDemoHtml()
      : genericPreviewHtml(artifacts);

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
      ${shouldShowGame ? gameStyles() : ""}
    </style>
  </head>
  <body>
    <header>
      <div>
        <p class="eyebrow">IntentOps Artifact Preview</p>
        <h1>${escapeHtml(selectedPlan.title || "Generated Artifact")}</h1>
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
    ${shouldShowGame ? gameScript() : ""}
  </body>
</html>
`;
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

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
