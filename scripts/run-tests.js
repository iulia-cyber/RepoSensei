const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), "utf8");
}

let failures = 0;

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${name}: ${error.message}\n`);
  }
}

run("server routes include required endpoints", () => {
  const server = read("server.js");
  const routes = [
    "/api/repo/clone",
    "/api/repo/inspect-url",
    "/api/embeddings/sync",
    "/api/db-status",
    "/api/model/config",
    "/api/search",
    "/api/chat/stream",
  ];
  for (const route of routes) {
    assert.equal(server.includes(route), true, `missing route ${route}`);
  }
});

run("server has incremental index and streaming", () => {
  const server = read("server.js");
  assert.equal(server.includes("buildIndex(repoRoot, previousState"), true, "incremental index");
  assert.equal(server.includes("streamOpenAIChat"), true, "streaming chat");
});

run("frontend has inspect/db/model controls", () => {
  const html = read("web/index.html");
  const app = read("web/app.js");
  const htmlIds = ["inspect-form", "sync-embeddings", "refresh-db", "recent-chats"];
  for (const id of htmlIds) {
    assert.equal(html.includes(`id="${id}"`), true, `missing id ${id}`);
  }

  const appTokens = ["/api/repo/inspect-url", "/api/embeddings/sync", "/api/db-status", "openaiApiKey", "/api/chat/stream", "/api/search"];
  for (const token of appTokens) {
    assert.equal(app.includes(token), true, `missing app token ${token}`);
  }
});

run("chat citations are clickable", () => {
  const app = read("web/app.js");
  assert.equal(app.includes("citation-link"), true, "citation-link class");
  assert.equal(app.includes("data-file"), true, "data-file attribute");
});

if (failures > 0) {
  process.exit(1);
}
