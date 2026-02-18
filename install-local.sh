#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Installing Repo-Sensei dependencies..."
npm install --cache .npm-cache

echo "Running local setup..."
node scripts/setup-local.js

echo
echo "Installation complete."
echo "Start with: node server.js"
echo "Or: npm run dev"
