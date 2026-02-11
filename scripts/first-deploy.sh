#!/bin/bash
set -euo pipefail

printf "\nLOON first-deploy helper\n"
printf "This script prepares local dev prerequisites and guides initial deployment steps.\n\n"

command -v node >/dev/null 2>&1 || { echo "Missing node. Install from https://nodejs.org/"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Missing npm. Install from https://nodejs.org/"; exit 1; }

if ! command -v wrangler >/dev/null 2>&1; then
  echo "Wrangler not found. Install it with: npm install -g wrangler"
fi

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example"
  echo "Edit .env.local with your GITHUB_REPO and GITHUB_TOKEN."
fi

SKIP_INSTALL=${SKIP_INSTALL:-false}
SKIP_TESTS=${SKIP_TESTS:-false}

if [ "$SKIP_INSTALL" = "false" ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ "$SKIP_TESTS" = "false" ]; then
  echo "Running tests..."
  npm test
fi

if command -v wrangler >/dev/null 2>&1; then
  echo "Setting up KV namespaces and binding..."
  if npm run setup:kv; then
    echo "KV setup complete."
  else
    echo "KV setup skipped (wrangler auth/account may be missing)."
    echo "Run 'npm run setup:kv' after 'wrangler login'."
  fi
fi

echo ""
echo "Next steps (Cloudflare Pages):"
echo "1) Set environment variables in Pages > Settings > Environment Variables:"
echo "   - GITHUB_REPO (owner/repo)"
echo "   - GITHUB_TOKEN (secret)"
echo "   - SETUP_TOKEN (secret, one-time setup token)"
echo "   - (Optional) CF_ACCOUNT_ID, CF_IMAGES_TOKEN for uploads"
echo "2) Deploy (push to main for Pages auto-deploy, or run 'wrangler pages deploy .')."
echo "3) Open /admin.html and complete Initial Setup with SETUP_TOKEN."
echo "4) Remove or rotate SETUP_TOKEN after first admin is created."
echo "5) Confirm health at /api/health."
