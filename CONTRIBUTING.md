# Contributing to RepoSensei

Thanks for your interest in RepoSensei. Here’s how you can help.

## How to contribute

- **Report bugs** – Open an [issue](https://github.com/iulia-cyber/RepoSensei/issues) and use the bug report template. Include steps to reproduce and your environment (OS, Node version).
- **Suggest features** – Open an [issue](https://github.com/iulia-cyber/RepoSensei/issues) with the feature request template. Describe the use case and why it would help.
- **Submit code** – Fork the repo, create a branch, make your changes, then open a pull request. See below.

## Development setup

```bash
git clone https://github.com/iulia-cyber/RepoSensei.git
cd RepoSensei
cp .env.example .env
# Edit .env with your PostgreSQL password (and optional API keys)
npm install && npm run setup
npm run dev
```

Run checks before submitting a PR:

```bash
npm run check
```

(This runs lint, typecheck, and tests.)

## Pull request guidelines

- Use a descriptive branch name (e.g. `fix/chat-citation-link`, `feat/search-shortcut`).
- Keep PRs focused; one feature or fix per PR when possible.
- Ensure `npm run check` passes.
- Update the README or docs if you change behavior or add options.

## Code of conduct

Be respectful and constructive. We want RepoSensei to be a welcoming project for everyone.
