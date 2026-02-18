const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const envPath = path.join(ROOT, ".env");
const envExamplePath = path.join(ROOT, ".env.example");
const reposPath = path.join(ROOT, "repos");

if (!fs.existsSync(reposPath)) {
  fs.mkdirSync(reposPath, { recursive: true });
}

if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
  process.stdout.write("Created .env from .env.example\n");
} else if (!fs.existsSync(envExamplePath)) {
  process.stdout.write(".env.example not found. Skipping env bootstrap.\n");
}

process.stdout.write("Local setup complete.\n");
process.stdout.write("Next step: run `node server.js` or `npm run dev`\n");
