Param(
    [switch]$SkipInstall,
    [switch]$SkipTests
)

Write-Host "LOON first-deploy helper" -ForegroundColor Cyan
Write-Host "This script prepares local dev prerequisites and guides initial deployment steps." -ForegroundColor DarkGray

function Assert-Command($name, $installHint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Host "Missing required command: $name" -ForegroundColor Red
        Write-Host $installHint -ForegroundColor Yellow
        exit 1
    }
}

Assert-Command "node" "Install Node.js from https://nodejs.org/"
Assert-Command "npm" "Install Node.js (npm is included) from https://nodejs.org/"

if (-not (Get-Command "wrangler" -ErrorAction SilentlyContinue)) {
    Write-Host "Wrangler not found. Install it with: npm install -g wrangler" -ForegroundColor Yellow
}

if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.example" ".env.local"
    Write-Host "Created .env.local from .env.example" -ForegroundColor Green
    Write-Host "Edit .env.local with your GITHUB_REPO and GITHUB_TOKEN." -ForegroundColor Yellow
}

if (-not $SkipInstall) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}

if (-not $SkipTests) {
    Write-Host "Running tests..." -ForegroundColor Cyan
    npm test
}

if (Get-Command "wrangler" -ErrorAction SilentlyContinue) {
    Write-Host "Setting up KV namespaces and binding..." -ForegroundColor Cyan
    try {
        npm run setup:kv
        Write-Host "KV setup complete." -ForegroundColor Green
    } catch {
        Write-Host "KV setup skipped (wrangler auth/account may be missing)." -ForegroundColor Yellow
        Write-Host "Run 'npm run setup:kv' after 'wrangler login'." -ForegroundColor Yellow
    }
}

Write-Host "" 
Write-Host "Next steps (Cloudflare Pages):" -ForegroundColor Cyan
Write-Host "1) Set environment variables in Pages > Settings > Environment Variables:" -ForegroundColor Gray
Write-Host "   - GITHUB_REPO (owner/repo)" -ForegroundColor Gray
Write-Host "   - GITHUB_TOKEN (secret)" -ForegroundColor Gray
Write-Host "   - SETUP_TOKEN (secret, one-time setup token)" -ForegroundColor Gray
Write-Host "   - (Optional) CF_ACCOUNT_ID, CF_IMAGES_TOKEN for uploads" -ForegroundColor Gray
Write-Host "2) Deploy (push to main for Pages auto-deploy, or run 'wrangler pages deploy .')." -ForegroundColor Gray
Write-Host "3) Open /admin.html and complete Initial Setup with SETUP_TOKEN." -ForegroundColor Gray
Write-Host "4) Remove or rotate SETUP_TOKEN after first admin is created." -ForegroundColor Gray
Write-Host "5) Confirm health at /api/health." -ForegroundColor Gray
