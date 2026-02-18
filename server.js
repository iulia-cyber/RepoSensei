const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { Pool } = require("pg");

const ROOT_DIR = process.cwd();
const WEB_DIR = path.join(ROOT_DIR, "web");
const CLONES_DIR = path.join(ROOT_DIR, "repos");
fs.mkdirSync(CLONES_DIR, { recursive: true });

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(path.join(ROOT_DIR, ".env"));

const HOST = process.env.HOST || "";
const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const DB_ENABLED = process.env.DB_ENABLED !== "0";
const HF_TIMEOUT_MS = process.env.HF_TIMEOUT_MS ? Number(process.env.HF_TIMEOUT_MS) : 25000;
const OPENAI_TIMEOUT_MS = process.env.OPENAI_TIMEOUT_MS ? Number(process.env.OPENAI_TIMEOUT_MS) : 30000;
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const OPENAI_EMBED_DIMENSIONS = process.env.OPENAI_EMBED_DIMENSIONS
  ? Number(process.env.OPENAI_EMBED_DIMENSIONS)
  : 1536;
const EMBEDDINGS_ENABLED = process.env.EMBEDDINGS_ENABLED !== "0";
const EMBEDDING_CHUNK_LINES = process.env.EMBEDDING_CHUNK_LINES
  ? Number(process.env.EMBEDDING_CHUNK_LINES)
  : 120;
const EMBEDDING_CHUNK_OVERLAP = process.env.EMBEDDING_CHUNK_OVERLAP
  ? Number(process.env.EMBEDDING_CHUNK_OVERLAP)
  : 24;
const EMBEDDING_MAX_CHUNKS_PER_SYNC = process.env.EMBEDDING_MAX_CHUNKS_PER_SYNC
  ? Number(process.env.EMBEDDING_MAX_CHUNKS_PER_SYNC)
  : 1200;
const GITHUB_SNAPSHOT_MAX_FILES = process.env.GITHUB_SNAPSHOT_MAX_FILES
  ? Number(process.env.GITHUB_SNAPSHOT_MAX_FILES)
  : 220;
const GITHUB_SNAPSHOT_MAX_BYTES = process.env.GITHUB_SNAPSHOT_MAX_BYTES
  ? Number(process.env.GITHUB_SNAPSHOT_MAX_BYTES)
  : 18000000;
const GITHUB_SNAPSHOT_CONCURRENCY = process.env.GITHUB_SNAPSHOT_CONCURRENCY
  ? Number(process.env.GITHUB_SNAPSHOT_CONCURRENCY)
  : 8;
const SNAPSHOT_META_FILE = ".repo-sensei.json";
const REPO_FILES_TABLE = "rs_repo_file_snapshots";
const GRAPH_EDGES_TABLE = "rs_graph_edge_snapshots";

// Set PGPASSWORD in .env; fallback below is for local dev only (see .env.example).
const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.PGHOST || "127.0.0.1",
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE || "postgres",
};

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".sql",
  ".txt",
  ".ini",
]);

const LANGUAGE_BY_EXT = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".h": "C/C++ Headers",
  ".hpp": "C++ Headers",
  ".json": "JSON",
  ".md": "Markdown",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".sql": "SQL",
  ".txt": "Text",
  ".ini": "INI/Config",
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode",
  "repos",
]);

const MAX_FILE_BYTES = 350000;
const CACHE_TTL_MS = 15000;

function now() {
  return Date.now();
}

function toPosix(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeWhitespaces(input) {
  return input.replace(/\s+/g, " ").trim();
}

function tokenize(input) {
  return (input.toLowerCase().match(/[a-z0-9_]+/g) || []).filter((token) => token.length > 1);
}

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRequestBody(req);
  return safeJsonParse(raw) || {};
}

function isIgnoredDirectory(entryName) {
  return IGNORED_DIRS.has(entryName) || entryName.startsWith(".");
}

function makeRepoRecord({ rootPath, source, label = null, remoteUrl = null, branch = null, commit = null }) {
  const normalized = path.resolve(rootPath);
  return {
    key: toPosix(path.relative(ROOT_DIR, normalized) || "."),
    rootPath: normalized,
    source,
    label: label || path.basename(normalized),
    remoteUrl,
    branch,
    commit,
  };
}

function toPublicRepo(repo) {
  if (!repo || typeof repo !== "object") {
    return null;
  }
  return {
    key: repo.key,
    rootPath: repo.rootPath,
    source: repo.source,
    label: repo.label,
    remoteUrl: repo.remoteUrl,
    branch: repo.branch || null,
    commit: repo.commit || null,
  };
}

let activeRepo = makeRepoRecord({
  rootPath: ROOT_DIR,
  source: "workspace",
  label: path.basename(ROOT_DIR) || "workspace",
});

const cacheByRepo = new Map();

let modelState = {
  provider: "huggingface",
  modelId: process.env.HF_MODEL || "",
  apiKey: process.env.HF_API_KEY || "",
  openaiModel: process.env.OPENAI_CHAT_MODEL || OPENAI_CHAT_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  lastError: null,
  catalogFetchedAt: 0,
  catalog: [],
  catalogError: null,
};

let embeddingState = {
  enabled: EMBEDDINGS_ENABLED,
  provider: "openai",
  model: process.env.OPENAI_EMBED_MODEL || OPENAI_EMBED_MODEL,
  dimensions: OPENAI_EMBED_DIMENSIONS,
  storageMode: "pgvector",
  ready: false,
  syncing: false,
  vectorExtensionReady: false,
  lastError: null,
  lastSyncAt: null,
  chunkCount: 0,
  lastRepoKey: null,
};

let dbState = {
  pool: null,
  connected: false,
  lastError: null,
  lastWriteAt: null,
  persistedFiles: 0,
  persistedEdges: 0,
  persistedChats: 0,
  writingSnapshot: false,
};

function getModelMeta() {
  return {
    provider: modelState.provider,
    modelId: modelState.modelId || null,
    hasApiKey: Boolean(modelState.apiKey),
    openaiModel: modelState.openaiModel || null,
    hasOpenAIApiKey: Boolean(modelState.openaiApiKey),
    embeddingModel: embeddingState.model || null,
    lastError: modelState.lastError,
  };
}

function getEmbeddingMeta() {
  return {
    enabled: embeddingState.enabled,
    provider: embeddingState.provider,
    model: embeddingState.model,
    dimensions: embeddingState.dimensions,
    storageMode: embeddingState.storageMode,
    ready: embeddingState.ready,
    syncing: embeddingState.syncing,
    vectorExtensionReady: embeddingState.vectorExtensionReady,
    chunkCount: embeddingState.chunkCount,
    lastSyncAt: embeddingState.lastSyncAt,
    lastError: embeddingState.lastError,
    lastRepoKey: embeddingState.lastRepoKey,
  };
}

function getDatabaseMeta() {
  return {
    enabled: DB_ENABLED,
    connected: dbState.connected,
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    database: DB_CONFIG.database,
    lastWriteAt: dbState.lastWriteAt,
    persistedFiles: dbState.persistedFiles,
    persistedEdges: dbState.persistedEdges,
    persistedChats: dbState.persistedChats,
    lastError: dbState.lastError,
  };
}

function isManagedRepoPath(repoPath) {
  const normalized = path.resolve(repoPath);
  const root = path.resolve(ROOT_DIR);
  const clones = path.resolve(CLONES_DIR);
  return normalized === root || normalized.startsWith(`${clones}${path.sep}`);
}

function resolveGitConfigPath(repoPath) {
  const dotGit = path.join(repoPath, ".git");
  if (!fs.existsSync(dotGit)) {
    return null;
  }

  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }

  if (stat.isDirectory()) {
    return path.join(dotGit, "config");
  }

  if (stat.isFile()) {
    try {
      const content = fs.readFileSync(dotGit, "utf8");
      const match = content.match(/gitdir:\s*(.+)$/im);
      if (!match) {
        return null;
      }
      return path.join(path.resolve(repoPath, match[1].trim()), "config");
    } catch {
      return null;
    }
  }

  return null;
}

function readOriginUrl(repoPath) {
  const configPath = resolveGitConfigPath(repoPath);
  if (!configPath || !fs.existsSync(configPath)) {
    return null;
  }

  let content = "";
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }

  const match = content.match(/\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function readSnapshotMeta(repoPath) {
  const metaPath = path.join(repoPath, SNAPSHOT_META_FILE);
  if (!fs.existsSync(metaPath)) {
    return null;
  }

  let raw = "";
  try {
    raw = fs.readFileSync(metaPath, "utf8");
  } catch {
    return null;
  }

  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed;
}

function writeSnapshotMeta(repoPath, meta) {
  const metaPath = path.join(repoPath, SNAPSHOT_META_FILE);
  const payload = {
    ...meta,
    createdAt: meta.createdAt || new Date().toISOString(),
    version: 1,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function listRepos() {
  const repos = [];
  repos.push(
    makeRepoRecord({
      rootPath: ROOT_DIR,
      source: "workspace",
      label: path.basename(ROOT_DIR) || "workspace",
      remoteUrl: readOriginUrl(ROOT_DIR),
    }),
  );

  let entries = [];
  try {
    entries = fs.readdirSync(CLONES_DIR, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const repoPath = path.join(CLONES_DIR, entry.name);
    const hasGit = fs.existsSync(path.join(repoPath, ".git"));
    const snapshotMeta = readSnapshotMeta(repoPath);
    if (!hasGit && !snapshotMeta) {
      continue;
    }

    repos.push(
      makeRepoRecord({
        rootPath: repoPath,
        source: snapshotMeta?.source || "clone",
        label: snapshotMeta?.label || entry.name,
        remoteUrl: snapshotMeta?.remoteUrl || readOriginUrl(repoPath),
        branch: snapshotMeta?.branch || null,
        commit: snapshotMeta?.commit || null,
      }),
    );
  }

  const seen = new Set();
  const deduped = [];
  for (const repo of repos) {
    const key = path.resolve(repo.rootPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(repo);
  }

  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

function switchActiveRepo(repoPath) {
  const normalized = path.resolve(repoPath);
  if (!isManagedRepoPath(normalized)) {
    throw new Error("repo path must be workspace root or inside repos/");
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
    throw new Error("repo path does not exist");
  }

  const known = listRepos();
  const found = known.find((repo) => path.resolve(repo.rootPath) === normalized);
  const snapshotMeta = readSnapshotMeta(normalized);
  activeRepo =
    found ||
    makeRepoRecord({
      rootPath: normalized,
      source: snapshotMeta?.source || "clone",
      label: path.basename(normalized),
      remoteUrl: snapshotMeta?.remoteUrl || readOriginUrl(normalized),
      branch: snapshotMeta?.branch || null,
      commit: snapshotMeta?.commit || null,
    });
  cacheByRepo.delete(path.resolve(activeRepo.rootPath));
  embeddingState.ready = false;
  embeddingState.chunkCount = 0;
  embeddingState.lastRepoKey = activeRepo.key;
  return activeRepo;
}

function runCommand(command, args, options = {}) {
  const { cwd = ROOT_DIR, timeoutMs = 180000 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 40000) {
        stdout = stdout.slice(-40000);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 40000) {
        stderr = stderr.slice(-40000);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`failed to execute ${command}: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`command timed out: ${command}`));
        return;
      }

      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `exit code ${code}`));
    });
  });
}

function isValidRepoUrl(repoUrl) {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(repoUrl.trim());
}

function deriveRepoName(repoUrl) {
  const trimmed = repoUrl.trim().replace(/[\\/]+$/, "");
  let name = trimmed.split("/").pop() || trimmed;
  if (name.includes(":")) {
    name = name.split(":").pop();
  }
  name = (name || "").replace(/\.git$/i, "");
  name = name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  return name || `repo-${Date.now()}`;
}

function allocateClonePath(baseName) {
  for (let i = 0; i < 120; i += 1) {
    const suffix = i === 0 ? "" : `-${i + 1}`;
    const target = path.join(CLONES_DIR, `${baseName}${suffix}`);
    if (!fs.existsSync(target)) {
      return target;
    }
  }
  throw new Error("unable to allocate clone folder");
}

async function readGitHeadInfo(repoPath) {
  let commit = null;
  let branch = null;

  try {
    const result = await runCommand("git", ["-C", repoPath, "rev-parse", "--short", "HEAD"], {
      timeoutMs: 15000,
    });
    commit = result.stdout || null;
  } catch {}

  try {
    const result = await runCommand("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 15000,
    });
    branch = result.stdout || null;
  } catch {}

  return { branch, commit };
}

async function cloneRepo(repoUrl) {
  if (!isValidRepoUrl(repoUrl)) {
    throw new Error("invalid repo url, use SSH or HTTPS git URL");
  }

  const target = allocateClonePath(deriveRepoName(repoUrl));
  await runCommand("git", ["clone", "--depth", "1", repoUrl, target], {
    cwd: ROOT_DIR,
    timeoutMs: 4 * 60 * 1000,
  });

  const head = await readGitHeadInfo(target);
  activeRepo = makeRepoRecord({
    rootPath: target,
    source: "clone",
    label: path.basename(target),
    remoteUrl: readOriginUrl(target) || repoUrl,
    branch: head.branch,
    commit: head.commit,
  });
  cacheByRepo.delete(path.resolve(target));
  embeddingState.ready = false;
  embeddingState.chunkCount = 0;
  embeddingState.lastRepoKey = activeRepo.key;
  return activeRepo;
}

function parseGitHubRepo(repoUrl) {
  const value = String(repoUrl || "").trim();
  if (!value) {
    return null;
  }

  let match = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match) {
    match = value.match(/^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?$/i);
  }
  if (!match) {
    match = value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  }
  if (!match) {
    return null;
  }

  const owner = match[1].trim();
  const repo = match[2].trim().replace(/\.git$/i, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) {
    return null;
  }

  return { owner, repo };
}

function githubRequestHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-sensei-local",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function safeRepoPathJoin(baseDir, relativePath) {
  const cleanRelative = String(relativePath || "").replace(/\\/g, "/");
  const target = path.resolve(baseDir, cleanRelative);
  const root = path.resolve(baseDir);
  if (target === root || target.startsWith(`${root}${path.sep}`)) {
    return target;
  }
  return null;
}

function scoreSnapshotCandidate(entry) {
  const relativePath = String(entry.path || "");
  const base = path.basename(relativePath).toLowerCase();
  const ext = path.extname(relativePath).toLowerCase();
  const segments = relativePath.toLowerCase().split("/");
  const depth = Math.max(0, segments.length - 1);
  const size = Number(entry.size) || 0;

  let score = 0;
  if (depth <= 1) {
    score += 10;
  } else if (depth <= 3) {
    score += 4;
  }

  if (/^(readme|license|contributing|changelog)(\.|$)/i.test(base)) {
    score += 30;
  }
  if (/^(package\.json|pnpm-workspace\.yaml|tsconfig\.json|vite\.config|webpack\.config|dockerfile|docker-compose)/i.test(base)) {
    score += 26;
  }
  if (/^(main|index|app|server|client|router|routes|api|auth|config|model|service|controller|handler|entry)/i.test(base)) {
    score += 18;
  }

  if (segments.includes("src")) {
    score += 12;
  }
  if (segments.includes("api") || segments.includes("routes")) {
    score += 9;
  }
  if (segments.includes("tests") || segments.includes("test") || segments.includes("__tests__")) {
    score += 3;
  }

  if (ext === ".md") {
    score += 4;
  } else if (ext === ".json" || ext === ".yaml" || ext === ".yml" || ext === ".toml") {
    score += 6;
  } else {
    score += 8;
  }

  if (size > 0) {
    score += Math.max(0, 16 - Math.log10(size + 10) * 3);
  }

  return score;
}

async function inspectGitHubRepo(repoUrl) {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) {
    throw new Error("inspect-url currently supports GitHub URLs only (owner/repo)");
  }

  const baseApi = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const headers = githubRequestHeaders();
  const repoMeta = await fetchJsonWithTimeout(`${baseApi}`, { headers }, 15000);
  const defaultBranch =
    typeof repoMeta.default_branch === "string" && repoMeta.default_branch.trim()
      ? repoMeta.default_branch.trim()
      : "main";

  const branchMeta = await fetchJsonWithTimeout(
    `${baseApi}/branches/${encodeURIComponent(defaultBranch)}`,
    { headers },
    15000,
  );
  const branchSha =
    branchMeta && branchMeta.commit && typeof branchMeta.commit.sha === "string"
      ? branchMeta.commit.sha
      : null;
  if (!branchSha) {
    throw new Error("could not resolve default branch commit from GitHub");
  }

  const treePayload = await fetchJsonWithTimeout(
    `${baseApi}/git/trees/${branchSha}?recursive=1`,
    { headers },
    25000,
  );
  const tree = Array.isArray(treePayload.tree) ? treePayload.tree : [];
  if (!tree.length) {
    throw new Error("repository tree is empty");
  }

  const candidates = tree
    .filter((entry) => entry && entry.type === "blob" && typeof entry.path === "string")
    .filter((entry) => {
      const ext = path.extname(entry.path).toLowerCase();
      const size = Number(entry.size) || 0;
      return EXTENSIONS.has(ext) && size > 0 && size <= MAX_FILE_BYTES;
    })
    .map((entry) => ({ ...entry, snapshotScore: scoreSnapshotCandidate(entry) }))
    .sort((a, b) => {
      if (b.snapshotScore !== a.snapshotScore) {
        return b.snapshotScore - a.snapshotScore;
      }
      return (Number(a.size) || 0) - (Number(b.size) || 0);
    })
    .slice(0, Math.max(30, GITHUB_SNAPSHOT_MAX_FILES));

  if (!candidates.length) {
    throw new Error("no supported code/text files found in repository");
  }

  const snapshotBase = `${deriveRepoName(`${parsed.owner}-${parsed.repo}`)}-snapshot`;
  const target = allocateClonePath(snapshotBase);
  fs.mkdirSync(target, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let totalBytes = 0;
  let lastError = null;

  let nextIndex = 0;
  const workers = [];
  const concurrency = Math.max(2, Math.min(12, GITHUB_SNAPSHOT_CONCURRENCY));

  for (let i = 0; i < concurrency; i += 1) {
    workers.push(
      (async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= candidates.length) {
            return;
          }

          const entry = candidates[currentIndex];
          if (totalBytes >= GITHUB_SNAPSHOT_MAX_BYTES) {
            skipped += 1;
            continue;
          }

          const outputPath = safeRepoPathJoin(target, entry.path);
          if (!outputPath) {
            skipped += 1;
            continue;
          }

          const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branchSha}/${entry.path}`;
          try {
            const text = await fetchTextWithTimeout(rawUrl, { headers }, 8000);
            const bytes = Buffer.byteLength(text, "utf8");
            if (!bytes || bytes > MAX_FILE_BYTES || totalBytes + bytes > GITHUB_SNAPSHOT_MAX_BYTES) {
              skipped += 1;
              continue;
            }

            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, text, "utf8");
            downloaded += 1;
            totalBytes += bytes;
          } catch (error) {
            skipped += 1;
            lastError = error instanceof Error ? error.message : "failed to fetch file";
          }
        }
      })(),
    );
  }

  await Promise.all(workers);

  if (!downloaded) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {}
    throw new Error(lastError || "failed to download repository snapshot from GitHub");
  }

  const remoteUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
  const label = `${parsed.repo} (github snapshot)`;
  writeSnapshotMeta(target, {
    source: "github-url",
    owner: parsed.owner,
    repo: parsed.repo,
    remoteUrl,
    label,
    branch: defaultBranch,
    commit: branchSha.slice(0, 10),
    fileCount: downloaded,
    skippedFiles: skipped,
    totalBytes,
  });

  activeRepo = makeRepoRecord({
    rootPath: target,
    source: "github-url",
    label,
    remoteUrl,
    branch: defaultBranch,
    commit: branchSha.slice(0, 10),
  });
  cacheByRepo.delete(path.resolve(target));
  embeddingState.ready = false;
  embeddingState.chunkCount = 0;
  embeddingState.lastRepoKey = activeRepo.key;

  return {
    repo: activeRepo,
    downloadedFiles: downloaded,
    skippedFiles: skipped,
    bytes: totalBytes,
  };
}

function walkFiles(dirPath, output) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (isIgnoredDirectory(entry.name)) {
        continue;
      }
      walkFiles(fullPath, output);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSIONS.has(ext)) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.size > MAX_FILE_BYTES) {
      continue;
    }

    output.push(fullPath);
  }
}

function buildIndex(repoRoot, previousState = null) {
  const files = [];
  walkFiles(repoRoot, files);

  const previousFiles = previousState?.files
    ? new Map(previousState.files.map((f) => [f.relativePath, f]))
    : null;

  const indexed = [];
  for (const fullPath of files) {
    const relativePath = toPosix(path.relative(repoRoot, fullPath));
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    const prev = previousFiles?.get(relativePath);
    if (prev && prev.mtime != null && prev.mtime === stat.mtimeMs) {
      indexed.push(prev);
      continue;
    }

    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    indexed.push({
      fullPath,
      relativePath,
      normalizedPath: relativePath.toLowerCase(),
      lowered: content.toLowerCase(),
      lines: content.split(/\r?\n/),
      bytes: Buffer.byteLength(content, "utf8"),
      mtime: stat.mtimeMs,
    });
  }

  return indexed;
}

function resolveLocalImport(repoRoot, filePath, importValue, indexedByPath) {
  if (!importValue.startsWith(".")) {
    return null;
  }

  const candidate = path.relative(repoRoot, path.resolve(path.dirname(filePath), importValue));
  const exact = toPosix(candidate);
  if (indexedByPath.has(exact)) {
    return exact;
  }

  for (const ext of EXTENSIONS) {
    if (indexedByPath.has(`${exact}${ext}`)) {
      return `${exact}${ext}`;
    }
  }

  for (const ext of EXTENSIONS) {
    const indexCandidate = `${exact}/index${ext}`;
    if (indexedByPath.has(indexCandidate)) {
      return indexCandidate;
    }
  }

  return null;
}

function extractImports(fileInfo) {
  const imports = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(fileInfo.lowered))) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function buildGraph(repoRoot, indexedFiles) {
  const nodes = [];
  const edges = [];
  const indexedByPath = new Set(indexedFiles.map((file) => file.relativePath));

  for (const file of indexedFiles) {
    nodes.push({
      id: file.relativePath,
      label: path.basename(file.relativePath),
      group: file.relativePath.includes("/") ? file.relativePath.split("/")[0] : "root",
    });
  }

  for (const file of indexedFiles) {
    const imports = extractImports(file);
    for (const importValue of imports) {
      const resolved = resolveLocalImport(repoRoot, file.fullPath, importValue, indexedByPath);
      if (!resolved) {
        continue;
      }
      edges.push({ source: file.relativePath, target: resolved });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const edge of edges) {
    const key = `${edge.source}=>${edge.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(edge);
  }

  return {
    nodes: nodes.slice(0, 600),
    edges: deduped.slice(0, 2000),
  };
}

function buildSummary(repo, indexedFiles, graph) {
  const languageMap = new Map();
  const inDegree = new Map();
  const outDegree = new Map();

  for (const edge of graph.edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
  }

  for (const file of indexedFiles) {
    const ext = path.extname(file.relativePath).toLowerCase();
    const language = LANGUAGE_BY_EXT[ext] || `Other (${ext || "none"})`;
    const current = languageMap.get(language) || { language, files: 0, lines: 0, bytes: 0 };
    current.files += 1;
    current.lines += file.lines.length;
    current.bytes += file.bytes;
    languageMap.set(language, current);
  }

  const languages = Array.from(languageMap.values()).sort((a, b) => b.lines - a.lines).slice(0, 10);

  const keyPattern =
    /^(main|index|app|server|client|router|routes|api|auth|config|model|service|controller|handler|entry)/i;
  const configPattern = /^(package\.json|pyproject\.toml|go\.mod|cargo\.toml|requirements\.txt|pom\.xml)$/i;

  const mainFiles = indexedFiles
    .map((file) => {
      const incoming = inDegree.get(file.relativePath) || 0;
      const outgoing = outDegree.get(file.relativePath) || 0;
      const base = path.basename(file.relativePath);
      let score = Math.log10(file.lines.length + 10) + incoming * 1.8 + outgoing * 1.2;
      if (keyPattern.test(base)) {
        score += 8;
      }
      if (configPattern.test(base)) {
        score += 7;
      }
      return {
        file: file.relativePath,
        lineCount: file.lines.length,
        incoming,
        outgoing,
        score: Number(score.toFixed(2)),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const totalLines = indexedFiles.reduce((sum, file) => sum + file.lines.length, 0);
  const readme = indexedFiles.find((file) => /^readme\.md$/i.test(path.basename(file.relativePath)));
  const readmePreview = readme ? readme.lines.slice(0, 10).join("\n").slice(0, 900) : null;

  return {
    repo: toPublicRepo(repo),
    totals: {
      indexedFiles: indexedFiles.length,
      totalLines,
    },
    languages,
    mainFiles,
    readmePreview,
    suggestedQuestions: [
      "Where is authentication implemented?",
      "Which files define API routes?",
      "How does data flow from route to DB?",
      "Where are shared utilities located?",
    ],
  };
}

function buildChunkHash(filePath, startLine, endLine, content) {
  return crypto.createHash("sha1").update(`${filePath}:${startLine}:${endLine}:${content}`).digest("hex");
}

function buildChunksForEmbeddings(state) {
  const chunks = [];
  const windowSize = Math.max(20, EMBEDDING_CHUNK_LINES);
  const overlap = Math.max(0, Math.min(EMBEDDING_CHUNK_OVERLAP, Math.floor(windowSize / 2)));
  const step = Math.max(1, windowSize - overlap);

  for (const file of state.files) {
    const lines = file.lines;
    if (!lines.length) {
      continue;
    }

    for (let start = 0; start < lines.length; start += step) {
      const end = Math.min(lines.length, start + windowSize);
      const content = lines.slice(start, end).join("\n").trim();
      if (!content) {
        if (end >= lines.length) {
          break;
        }
        continue;
      }

      chunks.push({
        repoKey: state.repo.key,
        filePath: file.relativePath,
        startLine: start + 1,
        endLine: end,
        content,
        contentHash: buildChunkHash(file.relativePath, start + 1, end, content),
      });

      if (chunks.length >= EMBEDDING_MAX_CHUNKS_PER_SYNC) {
        return chunks;
      }
      if (end >= lines.length) {
        break;
      }
    }
  }

  return chunks;
}

function toVectorLiteral(values) {
  const sanitized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => value.toFixed(9));
  return `[${sanitized.join(",")}]`;
}

async function getOpenAIEmbeddings(texts) {
  if (!modelState.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const payload = {
    model: embeddingState.model || OPENAI_EMBED_MODEL,
    input: texts,
  };

  if (embeddingState.dimensions) {
    payload.dimensions = embeddingState.dimensions;
  }

  const response = await fetchJsonWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelState.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    OPENAI_TIMEOUT_MS,
  );

  if (!Array.isArray(response.data)) {
    throw new Error("unexpected embeddings response shape");
  }

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding)
    .filter((embedding) => Array.isArray(embedding));
}

async function syncEmbeddingsForState(state) {
  if (!embeddingState.enabled) {
    return;
  }
  if (!dbState.connected || !dbState.pool || embeddingState.syncing) {
    return;
  }
  if (!modelState.openaiApiKey) {
    embeddingState.lastError = "OPENAI_API_KEY is required for vector embeddings";
    return;
  }

  embeddingState.syncing = true;
  embeddingState.lastRepoKey = state.repo.key;

  const chunks = buildChunksForEmbeddings(state);
  const hashes = chunks.map((chunk) => chunk.contentHash);

  const client = await dbState.pool.connect();
  try {
    const tableName = embeddingState.vectorExtensionReady ? "rs_repo_chunks" : "rs_repo_chunks_json";
    const existingRows = await client.query(
      `SELECT content_hash FROM ${tableName} WHERE repo_key = $1;`,
      [state.repo.key],
    );
    const existing = new Set(existingRows.rows.map((row) => row.content_hash));
    const pending = chunks.filter((chunk) => !existing.has(chunk.contentHash));

    const batchSize = 16;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const embeddings = await getOpenAIEmbeddings(batch.map((item) => item.content));
      if (embeddings.length !== batch.length) {
        throw new Error("embedding batch size mismatch");
      }

      for (let j = 0; j < batch.length; j += 1) {
        const item = batch[j];
        if (embeddingState.vectorExtensionReady) {
          const vectorLiteral = toVectorLiteral(embeddings[j]);
          await client.query(
            `
              INSERT INTO rs_repo_chunks
                (repo_key, file_path, start_line, end_line, content, content_hash, embedding, updated_at)
              VALUES
                ($1, $2, $3, $4, $5, $6, $7::vector, NOW())
              ON CONFLICT (repo_key, content_hash)
              DO UPDATE SET
                file_path = EXCLUDED.file_path,
                start_line = EXCLUDED.start_line,
                end_line = EXCLUDED.end_line,
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW();
            `,
            [
              item.repoKey,
              item.filePath,
              item.startLine,
              item.endLine,
              item.content,
              item.contentHash,
              vectorLiteral,
            ],
          );
        } else {
          await client.query(
            `
              INSERT INTO rs_repo_chunks_json
                (repo_key, file_path, start_line, end_line, content, content_hash, embedding_json, updated_at)
              VALUES
                ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
              ON CONFLICT (repo_key, content_hash)
              DO UPDATE SET
                file_path = EXCLUDED.file_path,
                start_line = EXCLUDED.start_line,
                end_line = EXCLUDED.end_line,
                content = EXCLUDED.content,
                embedding_json = EXCLUDED.embedding_json,
                updated_at = NOW();
            `,
            [
              item.repoKey,
              item.filePath,
              item.startLine,
              item.endLine,
              item.content,
              item.contentHash,
              JSON.stringify(embeddings[j]),
            ],
          );
        }
      }
    }

    if (hashes.length) {
      await client.query(
        `
          DELETE FROM ${tableName}
          WHERE repo_key = $1
          AND NOT (content_hash = ANY($2::text[]));
        `,
        [state.repo.key, hashes],
      );
    } else {
      await client.query(`DELETE FROM ${tableName} WHERE repo_key = $1;`, [state.repo.key]);
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE repo_key = $1;`,
      [state.repo.key],
    );
    embeddingState.chunkCount = countResult.rows?.[0]?.count || 0;
    embeddingState.lastSyncAt = new Date().toISOString();
    embeddingState.ready = true;
    embeddingState.storageMode = embeddingState.vectorExtensionReady ? "pgvector" : "json";
    embeddingState.lastError = null;
  } catch (error) {
    embeddingState.lastError = error instanceof Error ? error.message : "embedding sync failed";
  } finally {
    client.release();
    embeddingState.syncing = false;
  }
}

function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function vectorCitations(question, state, limit = 10) {
  if (!embeddingState.enabled || !embeddingState.ready) {
  return [];
  }
  if (!dbState.connected || !dbState.pool || !modelState.openaiApiKey) {
    return [];
  }

  try {
    const queryEmbedding = await getOpenAIEmbeddings([question]);
    if (!queryEmbedding.length) {
      return [];
    }

    const vectorLiteral = toVectorLiteral(queryEmbedding[0]);
    if (embeddingState.vectorExtensionReady) {
      const result = await dbState.pool.query(
        `
          SELECT
            file_path,
            start_line,
            end_line,
            content,
            (1 - (embedding <=> $2::vector)) AS similarity
          FROM rs_repo_chunks
          WHERE repo_key = $1
          ORDER BY embedding <=> $2::vector
          LIMIT $3;
        `,
        [state.repo.key, vectorLiteral, limit],
      );

      return result.rows.map((row) => ({
        file: row.file_path,
        line: row.start_line,
        endLine: row.end_line,
        snippet: normalizeWhitespaces((row.content || "").split(/\r?\n/)[0] || "").slice(0, 240),
        score: Number(row.similarity) || 0,
        source: "vector",
      }));
    }

    const result = await dbState.pool.query(
      `
        SELECT
          file_path,
          start_line,
          end_line,
          content,
          embedding_json
        FROM rs_repo_chunks_json
        WHERE repo_key = $1;
      `,
      [state.repo.key],
    );

    const query = queryEmbedding[0];
    return result.rows
      .map((row) => ({
        file: row.file_path,
        line: row.start_line,
        endLine: row.end_line,
        snippet: normalizeWhitespaces((row.content || "").split(/\r?\n/)[0] || "").slice(0, 240),
        score: cosineSimilarity(query, row.embedding_json || []),
        source: "vector-json",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    embeddingState.lastError = error instanceof Error ? error.message : "vector retrieval failed";
    return [];
  }
}

function scoreLine(lineLower, tokens) {
  let score = 0;
  for (const token of tokens) {
    if (lineLower.includes(token)) {
      score += token.length > 4 ? 2 : 1;
    }
  }
  return score;
}

function bestMatches(question, indexedFiles) {
  const tokens = Array.from(new Set(tokenize(question))).slice(0, 14);
  if (!tokens.length) {
    return [];
  }

  const ranked = [];
  for (const file of indexedFiles) {
    let score = 0;
    for (const token of tokens) {
      if (file.normalizedPath.includes(token)) {
        score += 4;
      }
      if (file.lowered.includes(token)) {
        score += token.length > 4 ? 2 : 1;
      }
    }

    if (score <= 0) {
      continue;
    }

    const citations = [];
    for (let i = 0; i < file.lines.length; i += 1) {
      const lineScore = scoreLine(file.lines[i].toLowerCase(), tokens);
      if (lineScore <= 0) {
        continue;
      }

      citations.push({
        file: file.relativePath,
        line: i + 1,
        snippet: normalizeWhitespaces(file.lines[i]).slice(0, 240),
        score: lineScore,
      });

      if (citations.length >= 5) {
        break;
      }
    }

    ranked.push({
      file: file.relativePath,
      score,
      citations: citations.sort((a, b) => b.score - a.score).slice(0, 3),
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 8);
}

function ensureCacheFresh(force = false) {
  const repoKey = path.resolve(activeRepo.rootPath);
  const existing = cacheByRepo.get(repoKey);
  if (!force && existing && now() - existing.indexedAt < CACHE_TTL_MS) {
    return existing;
  }

  const files = buildIndex(activeRepo.rootPath, existing);
  const graph = buildGraph(activeRepo.rootPath, files);
  const summary = buildSummary(activeRepo, files, graph);
  const state = {
    repo: activeRepo,
    indexedAt: now(),
    files,
    graph,
    summary,
  };

  cacheByRepo.set(repoKey, state);
  void persistSnapshotToDatabase(state);
  void syncEmbeddingsForState(state);
  return state;
}

async function initDatabase() {
  if (!DB_ENABLED) {
    return;
  }

  let pool;
  try {
    pool = new Pool(DB_CONFIG.connectionString ? { connectionString: DB_CONFIG.connectionString } : DB_CONFIG);
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${REPO_FILES_TABLE} (
        repo_key TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        line_count INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (repo_key, relative_path)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${REPO_FILES_TABLE}_repo_key_idx ON ${REPO_FILES_TABLE} (repo_key);`,
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${GRAPH_EDGES_TABLE} (
        repo_key TEXT NOT NULL,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (repo_key, source_path, target_path)
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${GRAPH_EDGES_TABLE}_repo_key_idx ON ${GRAPH_EDGES_TABLE} (repo_key);`,
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rs_chat_history (
        id BIGSERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    if (embeddingState.enabled) {
      try {
        await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS rs_repo_chunks (
            id BIGSERIAL PRIMARY KEY,
            repo_key TEXT NOT NULL,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            embedding vector(${OPENAI_EMBED_DIMENSIONS}) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (repo_key, content_hash)
          );
        `);
        await pool.query(
          `CREATE INDEX IF NOT EXISTS rs_repo_chunks_repo_key_idx ON rs_repo_chunks (repo_key);`,
        );
        embeddingState.vectorExtensionReady = true;
        embeddingState.storageMode = "pgvector";
        embeddingState.lastError = null;
      } catch (error) {
        embeddingState.vectorExtensionReady = false;
        embeddingState.storageMode = "json";
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS rs_repo_chunks_json (
              id BIGSERIAL PRIMARY KEY,
              repo_key TEXT NOT NULL,
              file_path TEXT NOT NULL,
              start_line INTEGER NOT NULL,
              end_line INTEGER NOT NULL,
              content TEXT NOT NULL,
              content_hash TEXT NOT NULL,
              embedding_json JSONB NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              UNIQUE (repo_key, content_hash)
            );
          `);
          await pool.query(
            `CREATE INDEX IF NOT EXISTS rs_repo_chunks_json_repo_key_idx ON rs_repo_chunks_json (repo_key);`,
          );
          embeddingState.lastError =
            error instanceof Error
              ? `pgvector unavailable, using json fallback: ${error.message}`
              : "pgvector unavailable, using json fallback";
        } catch (fallbackError) {
          embeddingState.ready = false;
          embeddingState.lastError =
            fallbackError instanceof Error
              ? `embedding storage unavailable: ${fallbackError.message}`
              : "embedding storage unavailable";
        }
      }
    }

    dbState.pool = pool;
    dbState.connected = true;
    dbState.lastError = null;
  } catch (error) {
    dbState.connected = false;
    dbState.lastError = error instanceof Error ? error.message : "unknown database error";
    if (pool) {
      try {
        await pool.end();
      } catch {}
    }
  }
}

async function persistSnapshotToDatabase(state) {
  if (!dbState.connected || !dbState.pool || dbState.writingSnapshot) {
    return;
  }

  dbState.writingSnapshot = true;
  const repoKey = state.repo.key;
  const client = await dbState.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${REPO_FILES_TABLE} WHERE repo_key = $1;`, [repoKey]);
    await client.query(`DELETE FROM ${GRAPH_EDGES_TABLE} WHERE repo_key = $1;`, [repoKey]);

    for (const file of state.files) {
      await client.query(
        `
          INSERT INTO ${REPO_FILES_TABLE} (repo_key, relative_path, line_count, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (repo_key, relative_path)
          DO UPDATE SET
            line_count = EXCLUDED.line_count,
            updated_at = NOW();
        `,
        [repoKey, file.relativePath, file.lines.length],
      );
    }

    for (const edge of state.graph.edges) {
      await client.query(
        `
          INSERT INTO ${GRAPH_EDGES_TABLE} (repo_key, source_path, target_path, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (repo_key, source_path, target_path)
          DO UPDATE SET
            updated_at = NOW();
        `,
        [repoKey, edge.source, edge.target],
      );
    }

    await client.query("COMMIT");
    dbState.lastWriteAt = new Date().toISOString();
    dbState.persistedFiles = state.files.length;
    dbState.persistedEdges = state.graph.edges.length;
    dbState.lastError = null;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    dbState.lastError = error instanceof Error ? error.message : "failed to persist snapshot";
  } finally {
    client.release();
    dbState.writingSnapshot = false;
  }
}

async function persistChatTurn(question, response) {
  if (!dbState.connected || !dbState.pool) {
    return;
  }

  try {
    await dbState.pool.query(
      `INSERT INTO rs_chat_history (question, answer, citations) VALUES ($1, $2, $3::jsonb);`,
      [question, response.answer, JSON.stringify(response.citations || [])],
    );
    dbState.persistedChats += 1;
  } catch (error) {
    dbState.lastError = error instanceof Error ? error.message : "failed to persist chat";
  }
}

async function loadRecentChats(limit = 12) {
  if (!dbState.connected || !dbState.pool) {
    return [];
  }

  try {
    const result = await dbState.pool.query(
      `SELECT id, question, answer, citations, created_at FROM rs_chat_history ORDER BY id DESC LIMIT $1;`,
      [limit],
    );
    return result.rows;
  } catch (error) {
    dbState.lastError = error instanceof Error ? error.message : "failed to load chat history";
    return [];
  }
}

async function loadSnapshotStats(repoKey) {
  if (!dbState.connected || !dbState.pool || !repoKey) {
    return null;
  }

  try {
    const fileCount = await dbState.pool.query(
      `SELECT COUNT(*)::int AS count FROM ${REPO_FILES_TABLE} WHERE repo_key = $1;`,
      [repoKey],
    );
    const edgeCount = await dbState.pool.query(
      `SELECT COUNT(*)::int AS count FROM ${GRAPH_EDGES_TABLE} WHERE repo_key = $1;`,
      [repoKey],
    );

    return {
      repoKey,
      files: fileCount.rows?.[0]?.count || 0,
      edges: edgeCount.rows?.[0]?.count || 0,
    };
  } catch (error) {
    dbState.lastError = error instanceof Error ? error.message : "failed to load snapshot stats";
    return null;
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 220)}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

const REPO_SENSEI_SYSTEM =
  "You are Repo-Sensei, a professional codebase assistant. " +
  "Give concrete, detailed answers using the provided context. " +
  "Always cite file paths and line numbers (e.g. path/to/file.js:42). " +
  "When asked what the app does, for an overview, or to inspect the codebase: provide a structured answer (purpose, main features, tech stack, key entry points) based on the context; do not hedge with phrases like 'without a comprehensive review' or 'high-level overview'—answer confidently from the evidence given. " +
  "Stay factual and avoid filler; if the context does not support something, say so briefly and point to what is present.";

function buildModelPrompt(question, citations, summary) {
  const languages = summary && Array.isArray(summary.languages) ? summary.languages : [];
  const languageHint = languages
    .slice(0, 4)
    .map((language) => `${language.language} (${language.lines} lines)`)
    .join(", ");

  const mainFiles = (summary.mainFiles || []).slice(0, 12).join(", ");
  const context = citations
    .slice(0, 12)
    .map((citation, index) => `${index + 1}. ${citation.file}:${citation.line} ${citation.snippet}`)
    .join("\n");

  return [
    `Question: ${question}`,
    languageHint ? `Languages in repo: ${languageHint}` : "",
    mainFiles ? `Notable files: ${mainFiles}` : "",
    "Relevant code excerpts (cite these file:line in your answer):",
    context || "(none)",
    "",
    "Answer in detail, citing file:line from the context above:",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractGeneratedText(payload) {
  if (Array.isArray(payload) && payload[0]) {
    if (typeof payload[0].generated_text === "string") {
      return payload[0].generated_text;
    }
    if (typeof payload[0].summary_text === "string") {
      return payload[0].summary_text;
    }
  }

  if (payload && typeof payload === "object") {
    if (typeof payload.generated_text === "string") {
      return payload.generated_text;
    }
    if (typeof payload.error === "string") {
      throw new Error(payload.error);
    }
  }

  return "";
}

function extractRouterText(payload) {
  if (payload && typeof payload === "object") {
    if (typeof payload.error === "string") {
      throw new Error(payload.error);
    }

    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    if (choice && choice.message) {
      const content = choice.message.content;
      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        const merged = content
          .map((part) => {
            if (typeof part === "string") {
              return part;
            }
            if (part && typeof part === "object" && typeof part.text === "string") {
              return part.text;
            }
            return "";
          })
          .join("")
          .trim();
        if (merged) {
          return merged;
        }
      }
    }
  }

  return "";
}

async function runHuggingFace(question, citations, summary) {
  if (!modelState.apiKey || !modelState.modelId) {
    return "";
  }

  const prompt = buildModelPrompt(question, citations, summary);
  const url = "https://router.huggingface.co/v1/chat/completions";
  const payload = await fetchJsonWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelState.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelState.modelId,
        messages: [
          { role: "system", content: REPO_SENSEI_SYSTEM },
          { role: "user", content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      }),
    },
    HF_TIMEOUT_MS,
  );

  const routerText = extractRouterText(payload);
  if (routerText) {
    return routerText.trim();
  }

  return extractGeneratedText(payload).trim();
}

async function runOpenAIChat(question, citations, summary) {
  if (!modelState.openaiApiKey) {
    return "";
  }

  const payload = await fetchJsonWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${modelState.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelState.openaiModel || OPENAI_CHAT_MODEL,
        messages: [
          { role: "system", content: REPO_SENSEI_SYSTEM },
          { role: "user", content: buildModelPrompt(question, citations, summary) },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    },
    OPENAI_TIMEOUT_MS,
  );

  const text = extractRouterText(payload);
  if (text) {
    return text.trim();
  }
  return extractGeneratedText(payload).trim();
}

async function streamOpenAIChat(question, citations, summary, onChunk) {
  if (!modelState.openaiApiKey) {
    return "";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${modelState.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: modelState.openaiModel || OPENAI_CHAT_MODEL,
      messages: [
        { role: "system", content: REPO_SENSEI_SYSTEM },
        { role: "user", content: buildModelPrompt(question, citations, summary) },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      stream: true,
    }),
  });

  clearTimeout(timeout);
  if (!response.ok) {
    const t = await response.text();
    throw new Error(`OpenAI: ${response.status} ${t.slice(0, 200)}`);
  }

  let full = "";
  const reader = response.body;
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        try {
          const json = JSON.parse(line.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (typeof content === "string") {
            full += content;
            onChunk(content);
          }
        } catch (_) {}
      }
    }
  }
  return full.trim();
}

async function refreshModelCatalog(forceRefresh = false) {
  const cacheAge = now() - modelState.catalogFetchedAt;
  if (!forceRefresh && modelState.catalogFetchedAt && cacheAge < 60 * 60 * 1000) {
    return;
  }

  try {
    const raw = await fetchJsonWithTimeout(
      "https://huggingface.co/api/models?pipeline_tag=text-generation&sort=downloads&direction=-1&limit=40",
      {},
      12000,
    );

    modelState.catalog = Array.isArray(raw)
      ? raw
          .filter((item) => item && typeof item.id === "string")
          .map((item) => ({
            id: item.id,
            downloads: item.downloads || 0,
            lastModified: item.lastModified || null,
            tags: Array.isArray(item.tags) ? item.tags : [],
          }))
      : [];

    modelState.catalogFetchedAt = now();
    modelState.catalogError = null;
  } catch (error) {
    modelState.catalog = [];
    modelState.catalogFetchedAt = now();
    modelState.catalogError = error instanceof Error ? error.message : "failed to fetch model catalog";
  }
}

function getRecommendedModels() {
  const ids = [
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "Qwen/Qwen2.5-Coder-14B-Instruct",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
    "meta-llama/Llama-3.1-8B-Instruct",
    "mistralai/Mistral-Nemo-Instruct-2407",
    "microsoft/Phi-4-mini-instruct",
  ];

  const lookup = new Map(modelState.catalog.map((model) => [model.id, model]));
  return ids.map((id) => {
    const found = lookup.get(id);
    return {
      id,
      foundInTopList: Boolean(found),
      downloads: found ? found.downloads : null,
      lastModified: found ? found.lastModified : null,
    };
  });
}

function buildFallbackAnswer(question, matches, summary) {
  if (!matches.length) {
    const summaryLangs = summary && Array.isArray(summary.languages) ? summary.languages : [];
    const langs = summaryLangs.slice(0, 3).map((language) => language.language).join(", ");
    return [
      `I could not find strong direct matches for: "${question}"`,
      langs ? `Dominant languages: ${langs}` : "No language metadata available yet.",
      "Try adding concrete symbols like function names, class names, route paths, or error strings.",
    ].join("\n");
  }

  const topFiles = matches.slice(0, 4).map((match) => match.file).join(", ");
  return [
    `Likely locations for: "${question}"`,
    `Top files: ${topFiles}`,
    "Use the citations below to jump to exact lines.",
  ].join("\n");
}

async function answerQuestion(question, state) {
  const matches = bestMatches(question, state.files);
  const lexicalCitations = matches.flatMap((match) => match.citations).slice(0, 12);
  const semanticCitations = await vectorCitations(question, state, 10);

  const dedupe = new Set();
  const mergedCitations = [];
  for (const citation of [...semanticCitations, ...lexicalCitations]) {
    const key = `${citation.file}:${citation.line}:${citation.snippet}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    mergedCitations.push(citation);
    if (mergedCitations.length >= 12) {
      break;
    }
  }

  let answer = buildFallbackAnswer(question, matches, state.summary);
  const model = {
    provider: semanticCitations.length ? "retrieval+vector" : "retrieval",
    modelId: null,
    used: false,
    error: null,
  };

  if (semanticCitations.length) {
    const semanticFiles = semanticCitations.slice(0, 4).map((item) => item.file);
    answer = [
      `Vector search found relevant chunks for: "${question}"`,
      `Top semantic files: ${semanticFiles.join(", ")}`,
      "Citations below include semantic and lexical matches.",
    ].join("\n");
  }

  if (modelState.apiKey && modelState.modelId && mergedCitations.length) {
    try {
      const generated = await runHuggingFace(question, mergedCitations, state.summary);
      if (generated) {
        answer = generated;
        model.provider = "huggingface";
        model.modelId = modelState.modelId;
        model.used = true;
      }
      modelState.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "model request failed";
      modelState.lastError = message;
      model.provider = "huggingface";
      model.modelId = modelState.modelId;
      model.error = message;
    }
  }

  if (!model.used && modelState.openaiApiKey && mergedCitations.length) {
    try {
      const generated = await runOpenAIChat(question, mergedCitations, state.summary);
      if (generated) {
        answer = generated;
        model.provider = "openai";
        model.modelId = modelState.openaiModel || OPENAI_CHAT_MODEL;
        model.used = true;
        model.error = null;
      }
      modelState.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "openai request failed";
      modelState.lastError = message;
      model.error = model.error ? `${model.error} | OpenAI fallback: ${message}` : message;
      if (!model.modelId) {
        model.modelId = modelState.openaiModel || OPENAI_CHAT_MODEL;
      }
    }
  }

  return {
    answer,
    citations: mergedCitations,
    model,
  };
}

function buildMeta(state) {
  return {
    repoPath: state.repo.rootPath,
    activeRepo: toPublicRepo(state.repo),
    indexedFiles: state.files.length,
    graphNodes: state.graph.nodes.length,
    graphEdges: state.graph.edges.length,
    indexedAt: new Date(state.indexedAt).toISOString(),
    database: getDatabaseMeta(),
    model: getModelMeta(),
    embeddings: getEmbeddingMeta(),
  };
}

function serveStatic(reqPath, res) {
  const requestedPath = reqPath === "/" ? "/index.html" : reqPath;
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(WEB_DIR, normalized);

  if (!filePath.startsWith(WEB_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = STATIC_MIME[ext] || "application/octet-stream";

  let body;
  try {
    body = fs.readFileSync(filePath);
  } catch {
    sendText(res, 500, "failed to read static file");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;

    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, service: "repo-sensei", activeRepo: toPublicRepo(activeRepo) });
      return;
    }

    if (pathname === "/api/meta" && req.method === "GET") {
      const state = ensureCacheFresh();
      sendJson(res, 200, buildMeta(state));
      return;
    }

    if (pathname === "/api/repos" && req.method === "GET") {
      sendJson(res, 200, {
        activeRepo: toPublicRepo(activeRepo),
        repos: listRepos().map(toPublicRepo),
        cloneBasePath: CLONES_DIR,
      });
      return;
    }

    if (pathname === "/api/repo/use" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const repoPath = typeof payload.repoPath === "string" ? payload.repoPath.trim() : "";
      if (!repoPath) {
        sendJson(res, 400, { error: "repoPath is required" });
        return;
      }

      try {
        switchActiveRepo(repoPath);
        const state = ensureCacheFresh(true);
        sendJson(res, 200, { activeRepo: toPublicRepo(activeRepo), summary: state.summary, meta: buildMeta(state) });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : "failed to switch repo" });
      }
      return;
    }

    if (pathname === "/api/repo/clone" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const repoUrl = typeof payload.repoUrl === "string" ? payload.repoUrl.trim() : "";
      if (!repoUrl) {
        sendJson(res, 400, { error: "repoUrl is required" });
        return;
      }

      try {
        const repo = await cloneRepo(repoUrl);
        const state = ensureCacheFresh(true);
        sendJson(res, 200, { activeRepo: toPublicRepo(repo), summary: state.summary, meta: buildMeta(state) });
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : "failed to clone repo" });
      }
      return;
    }

    if (pathname === "/api/repo/inspect-url" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const repoUrl = typeof payload.repoUrl === "string" ? payload.repoUrl.trim() : "";
      if (!repoUrl) {
        sendJson(res, 400, { error: "repoUrl is required" });
        return;
      }

      try {
        const inspected = await inspectGitHubRepo(repoUrl);
        const state = ensureCacheFresh(true);
        sendJson(res, 200, {
          activeRepo: toPublicRepo(inspected.repo),
          downloadedFiles: inspected.downloadedFiles,
          skippedFiles: inspected.skippedFiles,
          downloadedBytes: inspected.bytes,
          summary: state.summary,
          meta: buildMeta(state),
        });
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : "failed to inspect repository URL",
        });
      }
      return;
    }

    if (pathname === "/api/repo/summary" && req.method === "GET") {
      sendJson(res, 200, ensureCacheFresh().summary);
      return;
    }

    if (pathname === "/api/reindex" && req.method === "POST") {
      const state = ensureCacheFresh(true);
      sendJson(res, 200, { ok: true, meta: buildMeta(state) });
      return;
    }

    if (pathname === "/api/embeddings/sync" && req.method === "POST") {
      const state = ensureCacheFresh(true);
      await syncEmbeddingsForState(state);
      sendJson(res, 200, {
        ok: true,
        embeddings: getEmbeddingMeta(),
        meta: buildMeta(state),
      });
      return;
    }

    if (pathname === "/api/search" && req.method === "GET") {
      const q = (requestUrl.searchParams.get("q") || "").trim().toLowerCase();
      const state = ensureCacheFresh();
      const results = [];
      if (q.length >= 2) {
        const limit = 30;
        for (const file of state.files) {
          if (results.length >= limit) break;
          const pathMatch = file.relativePath.toLowerCase().includes(q);
          if (pathMatch) {
            results.push({ path: file.relativePath, line: 1, snippet: file.lines[0]?.slice(0, 120) || "" });
            continue;
          }
          for (let i = 0; i < file.lines.length && results.length < limit; i++) {
            if (file.lines[i].toLowerCase().includes(q)) {
              results.push({
                path: file.relativePath,
                line: i + 1,
                snippet: file.lines[i].slice(0, 120),
              });
              break;
            }
          }
        }
      }
      sendJson(res, 200, { results });
      return;
    }

    if (pathname === "/api/graph" && req.method === "GET") {
      sendJson(res, 200, ensureCacheFresh().graph);
      return;
    }

    if (pathname === "/api/file" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const relativePath = typeof payload.path === "string" ? payload.path.trim() : "";
      if (!relativePath) {
        sendJson(res, 400, { error: "path is required" });
        return;
      }

      const state = ensureCacheFresh();
      const file = state.files.find((item) => item.relativePath === relativePath);
      if (!file) {
        sendJson(res, 404, { error: "file not found in active repo index" });
        return;
      }

      sendJson(res, 200, {
        file: file.relativePath,
        lineCount: file.lines.length,
        content: file.lines.join("\n"),
      });
      return;
    }

    if (pathname === "/api/models" && req.method === "GET") {
      await refreshModelCatalog(requestUrl.searchParams.get("refresh") === "1");
      sendJson(res, 200, {
        configured: getModelMeta(),
        embeddings: getEmbeddingMeta(),
        recommended: getRecommendedModels(),
        popular: modelState.catalog.slice(0, 15),
        fetchedAt: modelState.catalogFetchedAt ? new Date(modelState.catalogFetchedAt).toISOString() : null,
        discoveryError: modelState.catalogError,
      });
      return;
    }

    if (pathname === "/api/model/config" && req.method === "POST") {
      const payload = await readJsonBody(req);
      const modelId = typeof payload.modelId === "string" ? payload.modelId.trim() : null;
      const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : null;
      const openaiModel =
        typeof payload.openaiModel === "string" ? payload.openaiModel.trim() : null;
      const openaiApiKey =
        typeof payload.openaiApiKey === "string" ? payload.openaiApiKey.trim() : null;
      const embeddingModel =
        typeof payload.embeddingModel === "string" ? payload.embeddingModel.trim() : null;

      if (modelId !== null) {
        if (modelId && (modelId.length > 160 || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(modelId))) {
          sendJson(res, 400, { error: "modelId must look like owner/model-name" });
          return;
        }
        modelState.modelId = modelId;
      }

      if (apiKey !== null) {
        modelState.apiKey = apiKey;
      }

      if (openaiModel !== null) {
        modelState.openaiModel = openaiModel || OPENAI_CHAT_MODEL;
      }

      if (openaiApiKey !== null) {
        modelState.openaiApiKey = openaiApiKey;
      }

      if (embeddingModel !== null) {
        embeddingState.model = embeddingModel || OPENAI_EMBED_MODEL;
        embeddingState.ready = false;
      }

      modelState.lastError = null;
      sendJson(res, 200, {
        ok: true,
        configured: getModelMeta(),
        embeddings: getEmbeddingMeta(),
      });
      return;
    }

    if (pathname === "/api/db-status" && req.method === "GET") {
      const state = ensureCacheFresh();
      sendJson(res, 200, {
        database: getDatabaseMeta(),
        snapshots: (await loadSnapshotStats(state.repo.key)) || {
          repoKey: state.repo.key,
          files: dbState.persistedFiles,
          edges: dbState.persistedEdges,
        },
        recentChats: await loadRecentChats(),
      });
      return;
    }

    if (pathname === "/api/chat/stream" && req.method === "POST") {
      const chatRateLimitWindowMs = 60 * 1000;
      const chatRateLimitMax = 20;
      const now = Date.now();
      if (!global.chatRequestTimes) global.chatRequestTimes = [];
      global.chatRequestTimes = global.chatRequestTimes.filter((t) => now - t < chatRateLimitWindowMs);
      if (global.chatRequestTimes.length >= chatRateLimitMax) {
        sendJson(res, 429, { error: "Too many chat requests; try again in a minute." });
        return;
      }
      global.chatRequestTimes.push(now);

      const payload = await readJsonBody(req);
      const question = typeof payload.question === "string" ? payload.question.trim() : "";
      if (!question) {
        sendJson(res, 400, { error: "question is required" });
        return;
      }

      const state = ensureCacheFresh();
      const matches = bestMatches(question, state.files);
      const lexicalCitations = matches.flatMap((m) => m.citations).slice(0, 12);
      const semanticCitations = await vectorCitations(question, state, 10);
      const dedupe = new Set();
      const mergedCitations = [];
      for (const c of [...semanticCitations, ...lexicalCitations]) {
        const key = `${c.file}:${c.line}:${c.snippet}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        mergedCitations.push(c);
        if (mergedCitations.length >= 12) break;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (obj) => {
        res.write("data: " + JSON.stringify(obj) + "\n\n");
      };

      try {
        if (modelState.openaiApiKey && mergedCitations.length) {
          const fullAnswer = await streamOpenAIChat(question, mergedCitations, state.summary, (chunk) => {
            sendEvent({ t: "chunk", content: chunk });
          });
          sendEvent({
            t: "done",
            citations: mergedCitations,
            model: { provider: "openai", modelId: modelState.openaiModel || OPENAI_CHAT_MODEL, used: true },
          });
          void persistChatTurn(question, {
            answer: fullAnswer,
            citations: mergedCitations,
            model: { provider: "openai", modelId: modelState.openaiModel || OPENAI_CHAT_MODEL, used: true },
          });
        } else {
          const response = await answerQuestion(question, state);
          sendEvent({ t: "chunk", content: response.answer });
          sendEvent({ t: "done", citations: response.citations || [], model: response.model || null });
          void persistChatTurn(question, response);
        }
      } catch (err) {
        sendEvent({ t: "error", error: err instanceof Error ? err.message : "Stream failed" });
      }
      res.end();
      return;
    }

    if (pathname === "/api/chat" && req.method === "POST") {
      const chatRateLimitWindowMs = 60 * 1000;
      const chatRateLimitMax = 20;
      const now = Date.now();
      if (!global.chatRequestTimes) global.chatRequestTimes = [];
      global.chatRequestTimes = global.chatRequestTimes.filter((t) => now - t < chatRateLimitWindowMs);
      if (global.chatRequestTimes.length >= chatRateLimitMax) {
        sendJson(res, 429, { error: "Too many chat requests; try again in a minute." });
        return;
      }
      global.chatRequestTimes.push(now);

      const payload = await readJsonBody(req);
      const question = typeof payload.question === "string" ? payload.question.trim() : "";
      if (!question) {
        sendJson(res, 400, { error: "question is required" });
        return;
      }

      const state = ensureCacheFresh();
      const response = await answerQuestion(question, state);
      sendJson(res, 200, response);
      void persistChatTurn(question, response);
      return;
    }

    if (req.method === "GET") {
      serveStatic(pathname, res);
      return;
    }

    sendText(res, 404, "Not Found");
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal server error" });
    }
  }
});

function attachServerErrorHandler(serverInstance, tryNextPort) {
  serverInstance.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      tryNextPort();
      return;
    }

    process.stderr.write(`Server startup error: ${error?.message || String(error)}\n`);
    process.exit(1);
  });
}

function attachShutdownHandlers() {
  const stop = async () => {
    if (dbState.pool) {
      try {
        await dbState.pool.end();
      } catch {}
    }
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function startServer() {
  await initDatabase();
  attachShutdownHandlers();

  const onListening = (port) => {
    process.stdout.write("Repo-Sensei running at:\n");
    process.stdout.write(`- http://localhost:${port}\n`);
    process.stdout.write(`- http://127.0.0.1:${port}\n`);
    process.stdout.write(`Active repo: ${activeRepo.rootPath}\n`);
    setImmediate(() => {
      try {
        ensureCacheFresh();
      } catch (e) {
        process.stderr.write(`Background index: ${e?.message || e}\n`);
      }
    });

    const db = getDatabaseMeta();
    if (db.enabled && db.connected) {
      process.stdout.write(
        `Database connected: postgres://${db.user}@${db.host}:${db.port}/${db.database}\n`,
      );
    } else if (db.enabled) {
      process.stdout.write(`Database unavailable: ${db.lastError || "unknown error"}\n`);
    } else {
      process.stdout.write("Database disabled by DB_ENABLED=0\n");
    }

    const embeddings = getEmbeddingMeta();
    if (!embeddings.enabled) {
      process.stdout.write("Embeddings: disabled\n");
    } else if (!embeddings.vectorExtensionReady) {
      process.stdout.write(
        `Embeddings unavailable: ${embeddings.lastError || "pgvector extension not ready"}\n`,
      );
    } else {
      process.stdout.write(
        `Embeddings ready: ${embeddings.provider}/${embeddings.model} (dim=${embeddings.dimensions})\n`,
      );
    }
  };

  const maxAttempts = 10;
  let attempts = 0;

  const listenOn = (port) => {
    attempts += 1;
    if (attempts > maxAttempts) {
      process.stderr.write(`Could not bind server after ${maxAttempts} attempts.\n`);
      process.exit(1);
      return;
    }

    server.removeAllListeners("error");
    attachServerErrorHandler(server, () => listenOn(port + 1));

    if (HOST) {
      server.listen(port, HOST, () => onListening(port));
    } else {
      server.listen(port, () => onListening(port));
    }
  };

  listenOn(DEFAULT_PORT);
}

void startServer();
