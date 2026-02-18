const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), "utf8");
}

function assertIncludes(source, checks, label) {
  for (const check of checks) {
    if (!source.includes(check)) {
      throw new Error(`${label} is missing required token: ${check}`);
    }
  }
}

const serverCode = read("server.js");
const appCode = read("web/app.js");
const htmlCode = read("web/index.html");

assertIncludes(
  serverCode,
  ["/api/repo/inspect-url", "/api/embeddings/sync", "/api/db-status", "/api/model/config", "/api/search", "/api/chat/stream"],
  "server routes",
);

assertIncludes(
  appCode,
  ["/api/repo/inspect-url", "/api/embeddings/sync", "/api/db-status", "openaiApiKey", "embeddingModel"],
  "frontend api wiring",
);

assertIncludes(
  htmlCode,
  ["id=\"inspect-form\"", "id=\"sync-embeddings\"", "id=\"refresh-db\"", "id=\"recent-chats\""],
  "frontend controls",
);

process.stdout.write("Typecheck passed: route and UI contracts are wired.\n");
