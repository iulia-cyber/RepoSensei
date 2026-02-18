# Repo-Sensei

A **local-first** web dashboard that combines **RAG-powered Q&A**, an **interactive dependency graph**, and **search** so you can explore any repo without leaving your browser. Clone via Git or inspect GitHub URLs with no clone. Your code and API keys stay on your machine.

**What makes it different**

- **One app, one place:** Chat with citations, zoom/pan dependency graph, file tree, code preview, and full-text search live in a single dashboard—no switching between tools.
- **Interactive code map:** The graph is built from real `import`/`require` links. Filter by folder, switch layouts (radial, grid, by folder), and click nodes to open files. Export the graph as SVG.
- **RAG + your choice of LLM:** Semantic search (pgvector) plus lexical match feed the context; you can use Hugging Face or OpenAI (or retrieval-only). Citations are clickable and open the file at the right line.
- **Runs entirely locally:** No SaaS, no sending code to third parties. Optional PostgreSQL and API keys for embeddings/LLM; everything else works offline.

## Features

- Clone repositories from HTTPS/SSH git URLs.
- Inspect a GitHub repo by URL without using `git clone`.
- Switch between cloned repos and your workspace repo.
- Ask code questions with line-level citations.
- See dominant languages and main code files.
- View a visual dependency graph.
- Optional LLM answers via Hugging Face or OpenAI.
- Full-text search over file paths and content; click a result to open the file at the matching line.
- Line numbers in the code preview; click a citation in chat to jump to that file and line.
- Export the dependency graph as SVG and the chat as Markdown.
- Light/dark theme toggle and keyboard shortcuts (`/` to focus chat, `Escape` to exit fullscreen).
- Rate limiting on chat to avoid runaway API usage.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (optional but recommended)
- Git (only needed for clone mode; URL inspect mode does not require git)

## Quick start (from GitHub)

If you forked or renamed the repo, change the clone URL below:

```bash
git clone https://github.com/simam/RepoSensei.git
cd RepoSensei
cp .env.example .env
# Edit .env and set PGPASSWORD (and optional API keys).
npm install && npm run setup
npm run dev
```

Then open **http://localhost:4173** (or the port printed in the terminal).

## Install on a local computer

Windows:

```powershell
.\install-local.cmd
```

macOS/Linux:

```bash
chmod +x ./install-local.sh
./install-local.sh
```

Manual install (all platforms):

```bash
npm install --cache .npm-cache
npm run setup
```

## Run locally

1. Open a terminal in this folder.
2. Start the app:

```powershell
node server.js
```

Windows shortcut:

```powershell
.\run-localhost.cmd
```

If the page does not open, run diagnostics:

```powershell
.\diagnose-localhost.cmd
```

3. Open your browser at:

```text
http://127.0.0.1:4173
http://localhost:4173
```

If port `4173` is already occupied, Repo-Sensei automatically tries the next free ports (`4174`, `4175`, ...).

## What this starter includes

- Local web dashboard with a modern UI.
- `POST /api/repo/clone` for cloning a repo from URL/SSH.
- `POST /api/repo/inspect-url` to inspect a GitHub URL snapshot (no clone).
- `GET /api/repos` and `POST /api/repo/use` for repository switching.
- `GET /api/repo/summary` for language stats + main files.
- `POST /api/chat` endpoint for Q&A with line-level citations.
- Vector-embedding RAG with PostgreSQL `pgvector` (semantic chunk retrieval).
- `GET /api/graph` endpoint that builds a visual graph from local import/require links.
- `GET /api/meta` endpoint showing index and graph stats.
- `GET /api/models` and `POST /api/model/config` for HF/OpenAI/embedding model setup.
- `POST /api/embeddings/sync` to force embedding sync.
- PostgreSQL persistence for indexed files, graph edges, and chat history.
- `GET /api/db-status` endpoint with DB status, snapshot stats, and recent chats.

## Terminal scripts

If you want npm scripts instead of a direct node command:

```powershell
npm.cmd run dev
```

Quality checks:

```powershell
npm.cmd run check
```

Individual commands:

- `npm run lint`
- `npm run typecheck`
- `npm run test`

## PostgreSQL quick config

Copy `.env.example` to `.env` and set your PostgreSQL credentials:

- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Do not commit `.env`; it is listed in `.gitignore`.

## Hugging Face model config

In `.env`:

- `HF_MODEL=owner/model`
- `HF_API_KEY=your_token`
- `HF_TIMEOUT_MS=25000`

You can also set/update these from the UI via the model config form.

## OpenAI fallback + embeddings

In `.env`:

- `OPENAI_API_KEY=...`
- `OPENAI_CHAT_MODEL=gpt-4o-mini`
- `OPENAI_EMBED_MODEL=text-embedding-3-small`
- `OPENAI_EMBED_DIMENSIONS=1536`

Embeddings config:

- `EMBEDDINGS_ENABLED=1`
- `EMBEDDING_CHUNK_LINES=120`
- `EMBEDDING_CHUNK_OVERLAP=24`
- `EMBEDDING_MAX_CHUNKS_PER_SYNC=1200`

This is used for semantic retrieval (`pgvector`) and OpenAI fallback when Hugging Face is unavailable.

## GitHub URL inspect mode

In the UI, use **Inspect URL** and paste:

- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`

Optional `.env` settings:

- `GITHUB_TOKEN=` (recommended for higher rate limits / private repos)
- `GITHUB_SNAPSHOT_MAX_FILES=220`
- `GITHUB_SNAPSHOT_MAX_BYTES=18000000`
- `GITHUB_SNAPSHOT_CONCURRENCY=8`

## Security and privacy

- **Do not commit `.env`.** It is listed in `.gitignore`. Use `.env.example` as a template and set your own PostgreSQL password and API keys locally.
- **Bind to localhost only.** Keep `HOST=` or `HOST=127.0.0.1` in `.env` so the server is not exposed on your network. Do not bind to `0.0.0.0` unless you add authentication.
- The app runs locally; repository data and API keys stay on your machine unless you use optional GitHub URL inspect (which fetches file listings and content via GitHub API).

## Publishing this repo to GitHub

1. Create a new repository on GitHub (do not initialize with a README if you already have one).
2. Update the `repository` URL in `package.json` to your repo (e.g. `https://github.com/simam/RepoSensei.git`).
3. Ensure `.env` is never committed (it is in `.gitignore`). Only `.env.example` should be in the repo.

## License

MIT. See [LICENSE](LICENSE).
