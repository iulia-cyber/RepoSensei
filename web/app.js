const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const questionEl = document.getElementById("question");
const repoMetaEl = document.getElementById("repo-meta");
const graphEl = document.getElementById("graph");
const refreshGraphEl = document.getElementById("refresh-graph");
const graphLayoutSelectEl = document.getElementById("graph-layout-select");
const graphCountEl = document.getElementById("graph-count");
const messageTemplate = document.getElementById("message-template");

const repoUrlEl = document.getElementById("repo-url");
const cloneFormEl = document.getElementById("clone-form");
const inspectFormEl = document.getElementById("inspect-form");
const inspectUrlEl = document.getElementById("inspect-url");
const repoSelectEl = document.getElementById("repo-select");
const useRepoEl = document.getElementById("use-repo");
const reindexEl = document.getElementById("reindex");
const syncEmbeddingsEl = document.getElementById("sync-embeddings");
const refreshDbEl = document.getElementById("refresh-db");
const statusEl = document.getElementById("repo-status");
const dbStatusEl = document.getElementById("db-status");
const recentChatsEl = document.getElementById("recent-chats");
const summaryEl = document.getElementById("repo-summary");
const modelSummaryEl = document.getElementById("model-summary");
const modelSummaryTopEl = document.getElementById("model-summary-top");
const modelFormEl = document.getElementById("model-form");
const modelIdEl = document.getElementById("model-id");
const modelApiKeyEl = document.getElementById("model-api-key");
const openaiModelEl = document.getElementById("openai-model");
const openaiApiKeyEl = document.getElementById("openai-api-key");
const embeddingModelEl = document.getElementById("embedding-model");
const graphFolderListEl = document.getElementById("graph-folder-list");
const graphFileListEl = document.getElementById("graph-file-list");
const filePreviewEl = document.getElementById("file-preview");
const filePreviewLabelEl = document.getElementById("file-preview-label");
const filePreviewWrapperEl = document.getElementById("file-preview-wrapper");
const filePreviewLineNumsEl = document.getElementById("file-preview-line-nums");
const openFileWindowEl = document.getElementById("open-file-window");
const exportGraphBtnEl = document.getElementById("export-graph-btn");
const layoutEl = document.querySelector(".layout");
const layoutResizerEl = document.getElementById("layout-resizer");
const rowResizerEl = document.getElementById("row-resizer");
const controlCardEl = document.querySelector(".control-card");
const graphLayoutShellEl = document.querySelector(".graph-layout-shell");
const graphResizerEl = document.getElementById("graph-resizer");
const guideOverlayEl = document.getElementById("guide-overlay");
const guideOpenEl = document.getElementById("open-guide");
const guideCloseEl = document.getElementById("guide-close");
const guideSkipEl = document.getElementById("guide-skip");
const guideOkEl = document.getElementById("guide-ok");
const graphFullscreenWrapEl = document.getElementById("graph-fullscreen-wrap");
const graphFullscreenBtnEl = document.getElementById("graph-fullscreen-btn");
const graphExitFullscreenBtnEl = document.getElementById("graph-exit-fullscreen-btn");
const themeToggleEl = document.getElementById("theme-toggle");
const searchFilesEl = document.getElementById("search-files");
const searchResultsEl = document.getElementById("search-results");
const exportChatBtnEl = document.getElementById("export-chat-btn");

let latestMeta = null;
let activeRepoPath = null;
let graphTransform = {
  scale: 1,
  x: 0,
  y: 0,
};
let latestGraph = null;
let selectedFolderKey = "all";
let selectedFilePath = null;

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, isError = false) {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }
}

function addMessage(role, text, citations = [], model = null) {
  if (!messageTemplate?.content || !messagesEl) {
    return;
  }
  const fragment = messageTemplate.content.cloneNode(true);
  const item = fragment.querySelector(".message");
  const roleEl = fragment.querySelector(".message-role");
  const textEl = fragment.querySelector(".message-text");
  const modelEl = fragment.querySelector(".message-model");
  const citationsEl = fragment.querySelector(".citation-list");
  if (!item || !roleEl || !textEl) {
    return;
  }

  roleEl.textContent = role === "user" ? "You" : "Repo-Sensei";
  roleEl.style.color = role === "user" ? "#f5b557" : "#5ff0c6";
  textEl.textContent = text;

  if (!model || role === "user") {
    if (modelEl) modelEl.remove();
  } else {
    const details = model.used
      ? `Model: ${model.provider}${model.modelId ? ` (${model.modelId})` : ""}`
      : model.provider === "huggingface"
        ? `Model fallback (HF error): ${model.error || "unknown"}`
        : "Model: retrieval fallback";
    modelEl.textContent = details;
  }

  if (!citations.length) {
    if (citationsEl) citationsEl.remove();
  } else {
    citationsEl.innerHTML = citations
      .map(
        (citation) =>
          `<li><button type="button" class="citation-link" data-file="${escapeHtml(citation.file)}" data-line="${escapeHtml(String(citation.line))}"><code>${escapeHtml(citation.file)}:${citation.line}</code></button> ${escapeHtml(citation.snippet || "")}</li>`,
      )
      .join("");
  }

  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = `Request failed with status ${response.status}`;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {}
    if (parsed?.error) {
      throw new Error(parsed.error);
    }
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return response.json();
}

function updateMeta(meta) {
  latestMeta = meta;
  activeRepoPath = meta?.activeRepo?.rootPath || null;
  const db = meta.database || {};
  const model = meta.model || {};
  const embeddings = meta.embeddings || {};
  const dbStatus = db.enabled
    ? db.connected
      ? `Connected (${db.user}@${db.host}:${db.port}/${db.database})`
      : "Not connected"
    : "Disabled";
  const modelStatus = model.modelId
    ? model.hasApiKey
      ? `${model.provider} (${model.modelId})`
      : `${model.provider} (${model.modelId}, missing API key)`
    : model.hasOpenAIApiKey
      ? `OpenAI fallback (${model.openaiModel || "default"})`
      : "Retrieval-only";
  const embeddingStatus = embeddings.enabled
    ? embeddings.ready
      ? `Ready (${embeddings.model}, chunks: ${embeddings.chunkCount || 0})`
      : embeddings.syncing
        ? "Syncing..."
        : `Not ready${embeddings.lastError ? `: ${embeddings.lastError}` : ""}`
    : "Disabled";

  repoMetaEl.innerHTML = `
    <div><strong>Active Repo:</strong> ${escapeHtml(meta.activeRepo?.label || "unknown")}</div>
    <div><strong>Path:</strong> ${escapeHtml(meta.repoPath || "")}</div>
    <div><strong>Indexed:</strong> ${meta.indexedFiles} files</div>
    <div><strong>Graph:</strong> ${meta.graphNodes} nodes, ${meta.graphEdges} edges</div>
    <div><strong>Model:</strong> ${escapeHtml(modelStatus)}</div>
    <div><strong>Embeddings:</strong> ${escapeHtml(embeddingStatus)}</div>
    <div><strong>DB:</strong> ${escapeHtml(dbStatus)}</div>
  `;

  if (modelSummaryEl) {
    modelSummaryEl.textContent = `Model: ${modelStatus}`;
  }
  if (modelSummaryTopEl) {
    modelSummaryTopEl.textContent = `Model: ${modelStatus}`;
  }
}

function renderRecentChats(items) {
  if (!recentChatsEl) {
    return;
  }
  recentChatsEl.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    recentChatsEl.innerHTML = `<li class="recent-chat-empty">No persisted chats yet.</li>`;
    return;
  }

  const rows = items.slice(0, 12);
  for (const row of rows) {
    const question = String(row.question || "").trim();
    const answer = String(row.answer || "").trim();
    const li = document.createElement("li");
    li.className = "recent-chat-item";
    li.innerHTML = `
      <p class="recent-chat-q">${escapeHtml(question || "(empty question)")}</p>
      <p class="recent-chat-a">${escapeHtml(answer.slice(0, 220) || "(empty answer)")}</p>
    `;
    recentChatsEl.appendChild(li);
  }
}

function renderDbStatus(payload) {
  if (!dbStatusEl) {
    return;
  }

  const db = payload?.database || {};
  const snapshots = payload?.snapshots || {};
  const dbStatus = db.enabled
    ? db.connected
      ? `DB connected (${db.user}@${db.host}:${db.port}/${db.database})`
      : `DB unavailable${db.lastError ? `: ${db.lastError}` : ""}`
    : "DB disabled";

  const snapshotStatus =
    snapshots && typeof snapshots.files === "number" && typeof snapshots.edges === "number"
      ? `Snapshot files: ${snapshots.files}, edges: ${snapshots.edges}`
      : "Snapshot stats unavailable";

  dbStatusEl.textContent = `${dbStatus} | ${snapshotStatus}`;
  dbStatusEl.classList.toggle("error", db.enabled && !db.connected);
  renderRecentChats(payload?.recentChats || []);
}

function renderRepoOptions(payload) {
  repoSelectEl.innerHTML = "";
  for (const repo of payload.repos || []) {
    const option = document.createElement("option");
    option.value = repo.rootPath;
    option.textContent = `${repo.label} (${repo.source})`;
    if (payload.activeRepo?.rootPath === repo.rootPath) {
      option.selected = true;
    }
    repoSelectEl.appendChild(option);
  }
}

function renderSummary(summary) {
  if (!summary) {
    summaryEl.innerHTML = `<p class="status">No summary available.</p>`;
    return;
  }

  const languages = (summary.languages || [])
    .slice(0, 6)
    .map((language) => `<li>${escapeHtml(language.language)} - ${language.lines} lines</li>`)
    .join("");

  const mainFiles = (summary.mainFiles || [])
    .slice(0, 8)
    .map(
      (file) =>
        `<li><code>${escapeHtml(file.file)}</code> (${file.lineCount} lines, in:${file.incoming}, out:${file.outgoing})</li>`,
    )
    .join("");

  const questions = (summary.suggestedQuestions || [])
    .map((question) => `<li><button type="button" class="suggested-question" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button></li>`)
    .join("");

  const readme = summary.readmePreview
    ? `<pre class="readme-preview">${escapeHtml(summary.readmePreview)}</pre>`
    : `<p class="status">No README preview found.</p>`;

  summaryEl.innerHTML = `
    <div class="summary-grid">
      <section>
        <h3>Main Languages</h3>
        <ul>${languages || "<li>None detected</li>"}</ul>
      </section>
      <section>
        <h3>Main Code Files</h3>
        <ul>${mainFiles || "<li>None detected</li>"}</ul>
      </section>
      <section>
        <h3>Suggested Questions</h3>
        <ul>${questions || "<li>Ask about auth, routes, and data flow.</li>"}</ul>
      </section>
      <section>
        <h3>README Preview</h3>
        ${readme}
      </section>
    </div>
  `;

  summaryEl.querySelectorAll(".suggested-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = btn.getAttribute("data-question") || btn.textContent || "";
      if (q && questionEl) {
        questionEl.value = q;
        questionEl.focus();
      }
    });
  });
}

function computeFolderBuckets(graph) {
  const folders = new Set();
  let hasRootFiles = false;
  for (const node of graph.nodes || []) {
    const id = String(node.id || "");
    const parts = id.split("/");
    if (parts.length > 1) {
      folders.add(parts[0]);
    } else {
      hasRootFiles = true;
    }
  }

  const result = [{ key: "all", label: "All files" }];
  if (hasRootFiles) {
    result.push({ key: "__root__", label: "(root files)" });
  }

  const namedFolders = Array.from(folders).sort((a, b) => a.localeCompare(b));
  for (const name of namedFolders) {
    result.push({ key: name, label: name });
  }
  return result;
}

function renderFolderList(graph) {
  if (!graphFolderListEl) {
    return;
  }
  const buckets = computeFolderBuckets(graph);
  graphFolderListEl.innerHTML = buckets
    .map(
      (bucket) => `
      <button
        type="button"
        class="graph-folder-item${bucket.key === selectedFolderKey ? " graph-folder-item--active" : ""}"
        data-folder="${escapeHtml(bucket.key)}"
      >
        ${escapeHtml(bucket.label)}
      </button>
    `,
    )
    .join("");

  const items = graphFolderListEl.querySelectorAll(".graph-folder-item");
  for (const item of items) {
    item.addEventListener("click", () => {
      const key = item.getAttribute("data-folder") || "all";
      selectedFolderKey = key;
      selectedFilePath = null;
      if (filePreviewEl) {
        filePreviewEl.innerHTML = "";
        const ln = filePreviewWrapperEl?.querySelector(".file-preview-line-nums");
        if (ln) ln.textContent = "";
      }
      renderFolderList(graph);
      renderFileList(graph);
      if (latestGraph) {
        drawGraph(latestGraph);
      }
    });
  }
}

function filteredNodeIdsForFolder(graph) {
  const nodes = graph.nodes || [];
  if (selectedFolderKey === "all") {
    return nodes.map((node) => String(node.id || ""));
  }
  if (selectedFolderKey === "__root__") {
    return nodes.map((node) => String(node.id || "")).filter((id) => !id.includes("/"));
  }
  const prefix = `${selectedFolderKey}/`;
  return nodes.map((node) => String(node.id || "")).filter((id) => id.startsWith(prefix));
}

function renderFileList(graph) {
  if (!graphFileListEl) {
    return;
  }

  const ids = filteredNodeIdsForFolder(graph);
  const sorted = ids.slice().sort((a, b) => a.localeCompare(b));
  graphFileListEl.innerHTML = sorted
    .map(
      (id) => `
      <button
        type="button"
        class="graph-file-item${id === selectedFilePath ? " graph-file-item--active" : ""}"
        data-path="${escapeHtml(id)}"
        title="${escapeHtml(id)}"
      >
        ${escapeHtml(id)}
      </button>
    `,
    )
    .join("");

  const items = graphFileListEl.querySelectorAll(".graph-file-item");
  for (const item of items) {
    item.addEventListener("click", async () => {
      const path = item.getAttribute("data-path");
      if (!path) {
        return;
      }
      selectedFilePath = path;
      renderFileList(graph);
      if (latestGraph) {
        drawGraph(latestGraph);
      }
      await loadFileContent(path);
    });
  }
}

function getLanguageFromPath(filePath) {
  const ext = (filePath || "").split(".").pop().toLowerCase();
  const map = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "tsx",
    jsx: "javascript",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    html: "htmlbars",
    css: "css",
    sql: "sql",
    sh: "bash",
    bash: "bash",
  };
  return map[ext] || "plaintext";
}

function renderCodeWithHighlight(containerEl, content, language) {
  if (!containerEl) return;
  containerEl.innerHTML = "";
  const code = document.createElement("code");
  code.className = "language-" + (language || "plaintext");
  code.textContent = content || "";
  containerEl.appendChild(code);
  if (typeof window.hljs !== "undefined") {
    try {
      window.hljs.highlightElement(code);
    } catch (e) {
      /* ignore */
    }
  }
  const wrapper = containerEl.closest(".file-preview-wrapper");
  const lineNumsEl = wrapper?.querySelector(".file-preview-line-nums");
  if (lineNumsEl) {
    const lines = (content || "").split("\n");
    const n = lines.length;
    lineNumsEl.textContent = n ? Array.from({ length: n }, (_, i) => i + 1).join("\n") : "";
  }
}

function scrollFilePreviewToLine(lineNum) {
  if (!filePreviewWrapperEl || !filePreviewEl || !lineNum || lineNum < 1) return;
  const lineHeight = 1.4 * parseFloat(getComputedStyle(filePreviewEl).fontSize);
  filePreviewWrapperEl.scrollTop = Math.max(0, (lineNum - 1) * lineHeight);
}

async function loadFileContent(path, scrollToLine = null) {
  try {
    selectedFilePath = path || null;
    const payload = await fetchJson("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (filePreviewEl) {
      const lang = getLanguageFromPath(path);
      renderCodeWithHighlight(filePreviewEl, payload.content || "", lang);
      if (scrollToLine != null) {
        requestAnimationFrame(() => scrollFilePreviewToLine(scrollToLine));
      }
    }
    if (filePreviewLabelEl) {
      const lines = typeof payload.lineCount === "number" ? ` (${payload.lineCount} lines)` : "";
      filePreviewLabelEl.textContent = `${path}${lines}`;
    }
    if (openFileWindowEl) {
      openFileWindowEl.disabled = !path;
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

function showGuide(force = false) {
  if (!guideOverlayEl) {
    return;
  }
  const skipFlag = window.localStorage.getItem("repo-sensei-guide-skip") === "1";
  if (!force && skipFlag) {
    return;
  }
  guideOverlayEl.classList.add("visible");
}

function hideGuide() {
  if (!guideOverlayEl) {
    return;
  }
  guideOverlayEl.classList.remove("visible");
}

function polarLayout(nodes, cx, cy, radius) {
  const positioned = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const angle = (Math.PI * 2 * i) / nodes.length;
    positioned.push({
      ...nodes[i],
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return positioned;
}

function gridLayout(nodes, width, height) {
  const count = nodes.length;
  if (!count) {
    return [];
  }

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const padding = 40;
  const cellWidth = (width - padding * 2) / cols;
  const cellHeight = (height - padding * 2) / rows;

  const positioned = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positioned.push({
      ...nodes[i],
      x: padding + col * cellWidth + cellWidth / 2,
      y: padding + row * cellHeight + cellHeight / 2,
    });
  }
  return positioned;
}

function getSelectedLayout() {
  if (!graphLayoutSelectEl) {
    return "radial";
  }
  const value = graphLayoutSelectEl.value;
  if (value === "grid") return "grid";
  if (value === "byfolder") return "byfolder";
  return "radial";
}

function hierarchyLayout(nodes, width, height) {
  const count = nodes.length;
  if (!count) return [];

  const groups = new Map();
  for (const node of nodes) {
    const g = node.group || "root";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(node);
  }
  const groupNames = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
  const padding = 50;
  const maxR = Math.min(width, height) * 0.42;
  const groupCount = groupNames.length;
  const positioned = [];

  for (let gi = 0; gi < groupCount; gi += 1) {
    const name = groupNames[gi];
    const groupNodes = groups.get(name);
    const angle0 = (Math.PI * 2 * gi) / groupCount - Math.PI / 2;
    const angle1 = (Math.PI * 2 * (gi + 1)) / groupCount - Math.PI / 2;
    const cx = width / 2 + (maxR * 0.6) * Math.cos((angle0 + angle1) / 2);
    const cy = height / 2 + (maxR * 0.6) * Math.sin((angle0 + angle1) / 2);
    const r = Math.min(80, maxR * 0.35);
    const n = groupNodes.length;
    for (let i = 0; i < n; i += 1) {
      const a = (Math.PI * 2 * i) / n;
      positioned.push({
        ...groupNodes[i],
        x: cx + r * Math.cos(a),
        y: cy + r * Math.sin(a),
      });
    }
  }
  return positioned;
}

function edgeEndPoint(sx, sy, tx, ty, radius) {
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const u = dx / len;
  const v = dy / len;
  return { x: tx - u * radius, y: ty - v * radius };
}

function applyGraphTransform() {
  if (!graphEl) {
    return;
  }
  const inner = graphEl.querySelector("#graph-inner");
  if (!inner) {
    return;
  }
  inner.setAttribute(
    "transform",
    `translate(${graphTransform.x},${graphTransform.y}) scale(${graphTransform.scale})`,
  );
}

function resetGraphTransform() {
  graphTransform.scale = 1;
  graphTransform.x = 0;
  graphTransform.y = 0;
  applyGraphTransform();
}

function drawGraph(graph) {
  const width = 900;
  const height = 620;
  const cx = width / 2;
  const cy = height / 2;
  const allNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  let nodesForFolder = allNodes;
  if (selectedFolderKey === "__root__") {
    nodesForFolder = allNodes.filter((node) => !String(node.id || "").includes("/"));
  } else if (selectedFolderKey && selectedFolderKey !== "all") {
    const prefix = `${selectedFolderKey}/`;
    nodesForFolder = allNodes.filter((node) => String(node.id || "").startsWith(prefix));
  }

  const nodeCount = Math.min(nodesForFolder.length, 180);
  const nodes = nodesForFolder.slice(0, nodeCount);
  const layout = getSelectedLayout();
  const positionedNodes =
    layout === "grid"
      ? gridLayout(nodes, width, height)
      : layout === "byfolder"
        ? hierarchyLayout(nodes, width, height)
        : polarLayout(nodes, cx, cy, Math.min(width, height) * 0.36);
  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));

  const nodeRadius = 5;
  const edgeMarkup = graph.edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
    .slice(0, 400)
    .map((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      const end = edgeEndPoint(source.x, source.y, target.x, target.y, nodeRadius);
      return `<line class="edge" x1="${source.x}" y1="${source.y}" x2="${end.x}" y2="${end.y}" marker-end="url(#arrowhead)" />`;
    })
    .join("");

  const folderLabel =
    selectedFolderKey === "all"
      ? "all folders"
      : selectedFolderKey === "__root__"
        ? "root"
        : selectedFolderKey;
  if (graphCountEl) {
    const total = nodesForFolder.length;
    const showing = total > nodeCount ? `${nodeCount} of ${total}` : `${total}`;
    graphCountEl.textContent = `Showing ${showing} files (${folderLabel}). Click a folder on the left to filter. Arrow = imports.`;
  }

  const defs =
    '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="rgba(170,220,236,0.5)" /></marker></defs>';
  const nodeMarkup = positionedNodes
    .map(
      (node) => `
      <g>
        <circle class="node${selectedFilePath && selectedFilePath === node.id ? " node-selected" : ""}" cx="${node.x}" cy="${node.y}" r="4.2" data-path="${escapeHtml(
          node.id,
        )}">
          <title>${escapeHtml(node.id)}</title>
        </circle>
        <text class="node-label" x="${node.x + 6}" y="${node.y - 6}">${escapeHtml(node.label)}</text>
      </g>
    `,
    )
    .join("");

  graphEl.innerHTML = `<g id="graph-inner">${defs}<g>${edgeMarkup}</g><g>${nodeMarkup}</g></g>`;
  resetGraphTransform();
}

function initGraphInteractions() {
  if (!graphEl) {
    return;
  }

  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  graphEl.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = Math.min(3, Math.max(0.4, graphTransform.scale * factor));
      graphTransform.scale = nextScale;
      applyGraphTransform();
    },
    { passive: false },
  );

  graphEl.addEventListener("mousedown", (event) => {
    isPanning = true;
    lastX = event.clientX;
    lastY = event.clientY;
  });

  graphEl.addEventListener("mousemove", (event) => {
    if (!isPanning) {
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    graphTransform.x += dx;
    graphTransform.y += dy;
    applyGraphTransform();
  });

  graphEl.addEventListener("mouseleave", () => {
    isPanning = false;
  });

  window.addEventListener("mouseup", () => {
    isPanning = false;
  });

  graphEl.addEventListener("click", async (event) => {
    const target = event.target;
    if (!target || typeof target.getAttribute !== "function") {
      return;
    }
    const tag = String(target.tagName || "").toLowerCase();
    if (tag !== "circle") {
      return;
    }
    const path = target.getAttribute("data-path");
    if (!path) {
      return;
    }
    selectedFilePath = path;
    if (latestGraph) {
      renderFileList(latestGraph);
      drawGraph(latestGraph);
    }
    await loadFileContent(path);
  });
}

function initLayoutResizers() {
  if (controlCardEl && rowResizerEl) {
    let rowDragging = false;
    let startY = 0;
    let startHeight = 0;

    rowResizerEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      rowDragging = true;
      startY = event.clientY;
      const h = controlCardEl.getBoundingClientRect().height;
      startHeight = typeof h === "number" && h > 0 ? h : 320;
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (event) => {
      if (!rowDragging) {
        return;
      }
      const dy = event.clientY - startY;
      const newHeight = Math.max(180, Math.min(800, startHeight + dy));
      controlCardEl.style.height = `${newHeight}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!rowDragging) {
        return;
      }
      rowDragging = false;
      document.body.style.userSelect = "";
    });
  }

  if (layoutEl && layoutResizerEl) {
    let isDragging = false;
    let startX = 0;
    let startLeft = 0;

    layoutResizerEl.addEventListener("mousedown", (event) => {
      isDragging = true;
      startX = event.clientX;
      const chatCard = document.querySelector(".chat-card");
      const leftWidth = chatCard ? chatCard.getBoundingClientRect().width : layoutEl.getBoundingClientRect().width * 0.45;
      startLeft = Number.isFinite(leftWidth) ? leftWidth : layoutEl.getBoundingClientRect().width * 0.45;
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (event) => {
      if (!isDragging) {
        return;
      }
      const dx = event.clientX - startX;
      const rect = layoutEl.getBoundingClientRect();
      const left = Math.max(280, Math.min(rect.width - 440, startLeft + dx));
      const right = rect.width - left - 6;
      layoutEl.style.gridTemplateColumns = `${left}px 6px ${right}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      document.body.style.userSelect = "";
    });
  }

  if (graphLayoutShellEl && graphResizerEl) {
    let isDragging = false;
    let startX = 0;

    graphResizerEl.addEventListener("mousedown", (event) => {
      isDragging = true;
      startX = event.clientX;
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (event) => {
      if (!isDragging) {
        return;
      }
      const dx = event.clientX - startX;
      const rect = graphLayoutShellEl.getBoundingClientRect();
      const minSidebar = 160;
      const maxSidebar = Math.max(minSidebar, rect.width * 0.6);
      const current = Math.min(maxSidebar, Math.max(minSidebar, rect.width * 0.28 + dx));
      graphLayoutShellEl.style.gridTemplateColumns = `${current}px 5px 1fr`;
    });

    window.addEventListener("mouseup", () => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      document.body.style.userSelect = "";
    });
  }

  const filesResizableEl = document.getElementById("graph-files-resizable");
  const filesResizeHandleEl = document.getElementById("files-resize-handle");
  if (filesResizableEl && filesResizeHandleEl) {
    let filesDragging = false;
    let startY = 0;
    let startHeight = 0;

    filesResizeHandleEl.addEventListener("mousedown", (event) => {
      event.preventDefault();
      filesDragging = true;
      startY = event.clientY;
      startHeight = filesResizableEl.getBoundingClientRect().height;
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (event) => {
      if (!filesDragging) {
        return;
      }
      const dy = event.clientY - startY;
      const newHeight = Math.max(120, Math.min(500, startHeight + dy));
      filesResizableEl.style.height = `${newHeight}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!filesDragging) {
        return;
      }
      filesDragging = false;
      document.body.style.userSelect = "";
    });
  }
}

function initFullscreen() {
  if (!graphFullscreenWrapEl || (!graphFullscreenBtnEl && !graphExitFullscreenBtnEl)) {
    return;
  }

  function isFullscreen() {
    return !!(
      document.fullscreenElement === graphFullscreenWrapEl ||
      document.webkitFullscreenElement === graphFullscreenWrapEl
    );
  }

  function requestFs() {
    if (graphFullscreenWrapEl.requestFullscreen) {
      graphFullscreenWrapEl.requestFullscreen();
    } else if (graphFullscreenWrapEl.webkitRequestFullscreen) {
      graphFullscreenWrapEl.webkitRequestFullscreen();
    }
  }

  function exitFs() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }

  function updateButton() {
    const header = document.getElementById("graph-fullscreen-header");
    if (header) {
      header.setAttribute("aria-hidden", isFullscreen() ? "false" : "true");
    }
  }

  document.addEventListener("fullscreenchange", updateButton);
  document.addEventListener("webkitfullscreenchange", updateButton);

  if (graphFullscreenBtnEl) {
    graphFullscreenBtnEl.addEventListener("click", () => {
      if (isFullscreen()) {
        exitFs();
      } else {
        requestFs();
      }
    });
  }
  if (graphExitFullscreenBtnEl) {
    graphExitFullscreenBtnEl.addEventListener("click", exitFs);
  }
  updateButton();
}

async function refreshMeta() {
  const meta = await fetchJson("/api/meta");
  updateMeta(meta);
  return meta;
}

async function refreshGraph() {
  const graph = await fetchJson("/api/graph");
  latestGraph = graph;
  renderFolderList(graph);
  renderFileList(graph);
  drawGraph(graph);
}

async function refreshRepos() {
  const repos = await fetchJson("/api/repos");
  renderRepoOptions(repos);
}

async function refreshSummary() {
  const summary = await fetchJson("/api/repo/summary");
  renderSummary(summary);
}

async function refreshModels() {
  const models = await fetchJson("/api/models");
  const configured = models.configured || {};
  const embeddings = models.embeddings || {};
  if (configured.modelId) {
    modelIdEl.value = configured.modelId;
  }
  if (configured.openaiModel) {
    openaiModelEl.value = configured.openaiModel;
  }
  if (configured.embeddingModel) {
    embeddingModelEl.value = configured.embeddingModel;
  } else if (embeddings.model) {
    embeddingModelEl.value = embeddings.model;
  }
}

async function refreshDbStatus() {
  const db = await fetchJson("/api/db-status");
  renderDbStatus(db);
}

async function fullRefresh() {
  await refreshMeta();
  await Promise.all([refreshRepos(), refreshSummary(), refreshGraph(), refreshModels(), refreshDbStatus()]);
}

if (graphLayoutSelectEl) {
  graphLayoutSelectEl.addEventListener("change", () => {
    if (latestGraph) {
      drawGraph(latestGraph);
    }
  });
}

cloneFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = repoUrlEl.value.trim();
  if (!repoUrl) {
    return;
  }

  setStatus("Cloning repository... this may take up to a few minutes.");
  try {
    const payload = await fetchJson("/api/repo/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl }),
    });
    repoUrlEl.value = "";
    setStatus(`Loaded repo: ${payload.activeRepo?.label || "unknown"}`);
    await fullRefresh();
    addMessage(
      "assistant",
      `Repository switched to ${payload.activeRepo?.label || "new repo"}. Ask me about architecture, auth flow, APIs, or main files.`,
    );
  } catch (error) {
    setStatus(error.message, true);
  }
});

inspectFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = inspectUrlEl.value.trim();
  if (!repoUrl) {
    return;
  }

  setStatus("Inspecting GitHub URL without clone... downloading snapshot.");
  try {
    const payload = await fetchJson("/api/repo/inspect-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl }),
    });
    inspectUrlEl.value = "";
    setStatus(
      `Inspected: ${payload.activeRepo?.label || "repo"} (${payload.downloadedFiles || 0} files downloaded)`,
    );
    await fullRefresh();
    addMessage(
      "assistant",
      `Repository snapshot ready: ${payload.activeRepo?.label || "remote repo"}. Ask architecture, routes, and data-flow questions.`,
    );
  } catch (error) {
    setStatus(error.message, true);
  }
});

useRepoEl.addEventListener("click", async () => {
  const repoPath = repoSelectEl.value;
  if (!repoPath) {
    setStatus("Select a repository first.", true);
    return;
  }

  setStatus("Switching repository...");
  try {
    await fetchJson("/api/repo/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath }),
    });
    setStatus("Repository switched.");
    await fullRefresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

reindexEl.addEventListener("click", async () => {
  setStatus("Reindexing repository...");
  try {
    await fetchJson("/api/reindex", { method: "POST" });
    setStatus("Reindex complete.");
    await fullRefresh();
  } catch (error) {
    setStatus(error.message, true);
  }
});

refreshGraphEl.addEventListener("click", async () => {
  setStatus("Refreshing graph...");
  try {
    await refreshGraph();
    setStatus("Graph refreshed.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

syncEmbeddingsEl.addEventListener("click", async () => {
  setStatus("Syncing embeddings...");
  try {
    await fetchJson("/api/embeddings/sync", { method: "POST" });
    setStatus("Embedding sync complete.");
    await Promise.all([refreshMeta(), refreshDbStatus()]);
  } catch (error) {
    setStatus(error.message, true);
  }
});

refreshDbEl.addEventListener("click", async () => {
  setStatus("Refreshing DB status...");
  try {
    await refreshDbStatus();
    setStatus("DB status refreshed.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

modelFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const modelId = modelIdEl.value.trim();
  const apiKey = modelApiKeyEl.value.trim();
  const openaiModel = openaiModelEl.value.trim();
  const openaiApiKey = openaiApiKeyEl.value.trim();
  const embeddingModel = embeddingModelEl.value.trim();

  setStatus("Saving model config...");
  try {
    await fetchJson("/api/model/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId,
        apiKey,
        openaiModel,
        openaiApiKey,
        embeddingModel,
      }),
    });
    modelApiKeyEl.value = "";
    openaiApiKeyEl.value = "";
    setStatus("Model config saved.");
    await refreshMeta();
    await refreshModels();
  } catch (error) {
    setStatus(error.message, true);
  }
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = questionEl.value.trim();
  if (!question) {
    return;
  }

  addMessage("user", question);
  questionEl.value = "";
  questionEl.focus();

  addMessage("assistant", "…");

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || response.statusText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let citations = [];
    let model = null;
    const lastMsg = messagesEl?.lastElementChild;
    const textEl = lastMsg?.querySelector(".message-text");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.t === "chunk" && typeof data.content === "string" && textEl) {
              textEl.textContent = (textEl.textContent || "") + data.content;
              lastMsg?.scrollIntoView?.({ behavior: "smooth", block: "end" });
            } else if (data.t === "done") {
              citations = data.citations || [];
              model = data.model || null;
            } else if (data.t === "error") {
              throw new Error(data.error || "Stream error");
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    }

    if (lastMsg && citations.length) {
      let list = lastMsg.querySelector(".citation-list");
      if (!list) {
        list = document.createElement("ul");
        list.className = "citation-list";
        lastMsg.appendChild(list);
      }
      list.innerHTML = citations
        .map(
          (c) =>
            `<li><button type="button" class="citation-link" data-file="${escapeHtml(c.file)}" data-line="${escapeHtml(String(c.line))}"><code>${escapeHtml(c.file)}:${c.line}</code></button> ${escapeHtml(c.snippet || "")}</li>`,
        )
        .join("");
      if (model) {
        let modelEl = lastMsg.querySelector(".message-model");
        if (!modelEl) {
          modelEl = document.createElement("p");
          modelEl.className = "message-model";
          lastMsg.appendChild(modelEl);
        }
        modelEl.textContent = model.used
          ? `Model: ${model.provider}${model.modelId ? ` (${model.modelId})` : ""}`
          : "Model: retrieval fallback";
      }
    }
    await Promise.all([refreshMeta(), refreshDbStatus()]);
  } catch (error) {
    if (messagesEl.lastElementChild) {
      messagesEl.lastElementChild.remove();
    }
    addMessage("assistant", `Request failed: ${error.message}`);
  }
});

addMessage(
  "assistant",
  "Repo-Sensei is ready. Clone a repository or inspect a GitHub URL above, then ask:\n- Where is auth handled?\n- What are the main code files?\n- Which files connect API routes to DB?",
);

void (async () => {
  try {
    initGraphInteractions();
    initLayoutResizers();
    initFullscreen();
    if (guideOpenEl) {
      guideOpenEl.addEventListener("click", () => showGuide(true));
    }
    if (guideCloseEl) {
      guideCloseEl.addEventListener("click", () => hideGuide());
    }
    if (guideOkEl) {
      guideOkEl.addEventListener("click", () => hideGuide());
    }
    if (guideSkipEl) {
      guideSkipEl.addEventListener("click", () => {
        try {
          window.localStorage.setItem("repo-sensei-guide-skip", "1");
        } catch {
          // ignore
        }
        hideGuide();
      });
    }
    if (openFileWindowEl) {
      openFileWindowEl.addEventListener("click", () => {
        if (!selectedFilePath) {
          return;
        }
        const url = `/file-viewer.html?path=${encodeURIComponent(selectedFilePath)}`;
        window.open(url, "_blank", "noopener");
      });
    }
    if (messagesEl) {
      messagesEl.addEventListener("click", (e) => {
        const link = e.target.closest(".citation-link");
        if (!link) return;
        const file = link.getAttribute("data-file");
        const line = parseInt(link.getAttribute("data-line"), 10);
        if (file) loadFileContent(file, isNaN(line) ? null : line);
      });
    }
    if (exportGraphBtnEl) {
      exportGraphBtnEl.addEventListener("click", () => {
        const svg = document.getElementById("graph");
        if (!svg) return;
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "repo-graph.svg";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
    if (themeToggleEl) {
      const stored = localStorage.getItem("repo-sensei-theme") || "dark";
      document.documentElement.setAttribute("data-theme", stored);
      themeToggleEl.textContent = stored === "light" ? "Dark" : "Light";
      themeToggleEl.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        themeToggleEl.textContent = next === "light" ? "Dark" : "Light";
        try {
          localStorage.setItem("repo-sensei-theme", next);
        } catch (_) {}
      });
    }
    let searchDebounce = null;
    if (searchFilesEl && searchResultsEl) {
      searchFilesEl.addEventListener("input", () => {
        clearTimeout(searchDebounce);
        const q = searchFilesEl.value.trim();
        if (q.length < 2) {
          searchResultsEl.hidden = true;
          searchResultsEl.innerHTML = "";
          return;
        }
        searchDebounce = setTimeout(async () => {
          try {
            const payload = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
            const results = payload.results || [];
            if (results.length === 0) {
              searchResultsEl.innerHTML = '<li class="search-results-empty">No matches</li>';
            } else {
              searchResultsEl.innerHTML = results
                .map(
                  (r) =>
                    `<li data-path="${escapeHtml(r.path)}" data-line="${r.line}"><code>${escapeHtml(r.path)}:${r.line}</code> ${escapeHtml((r.snippet || "").slice(0, 60))}…</li>`,
                )
                .join("");
            }
            searchResultsEl.hidden = false;
          } catch {
            searchResultsEl.innerHTML = '<li class="search-results-empty">Search failed</li>';
            searchResultsEl.hidden = false;
          }
        }, 200);
      });
      searchResultsEl.addEventListener("click", (e) => {
        const li = e.target.closest("li[data-path]");
        if (!li) return;
        const path = li.getAttribute("data-path");
        const line = parseInt(li.getAttribute("data-line"), 10);
        searchResultsEl.hidden = true;
        searchFilesEl.value = "";
        if (path) loadFileContent(path, isNaN(line) ? null : line);
      });
      document.addEventListener("click", (e) => {
        if (!searchFilesEl.contains(e.target) && !searchResultsEl.contains(e.target)) {
          searchResultsEl.hidden = true;
        }
      });
    }
    if (exportChatBtnEl && messagesEl) {
      exportChatBtnEl.addEventListener("click", () => {
        const parts = [];
        messagesEl.querySelectorAll(".message").forEach((msg) => {
          const role = msg.querySelector(".message-role")?.textContent || "";
          const text = msg.querySelector(".message-text")?.textContent || "";
          const cites = msg.querySelectorAll(".citation-list code");
          parts.push(`## ${role}\n\n${text}`);
          if (cites.length) {
            parts.push("\n**Citations:** " + Array.from(cites).map((c) => c.textContent).join(", ") + "\n");
          }
          parts.push("\n");
        });
        const blob = new Blob([parts.join("")], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "repo-sensei-chat.md";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (questionEl) questionEl.focus();
      }
      if (e.key === "Escape") {
        if (graphFullscreenWrapEl && (document.fullscreenElement === graphFullscreenWrapEl || document.webkitFullscreenElement === graphFullscreenWrapEl)) {
          document.exitFullscreen?.() || document.webkitExitFullscreen?.();
        }
        if (searchResultsEl && !searchResultsEl.hidden) searchResultsEl.hidden = true;
      }
    });
    await fullRefresh();
    showGuide(false);
    setStatus(activeRepoPath ? `Ready: ${activeRepoPath}` : "Ready.");
  } catch (error) {
    setStatus(error.message, true);
  }
})();
