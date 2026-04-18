# Household AI — one-shot repo init for Windows / PowerShell.
# Run from the project root:
#   pwsh ./scripts/init-repo.ps1
# Or from cmd:
#   powershell -ExecutionPolicy Bypass -File .\scripts\init-repo.ps1

$ErrorActionPreference = "Stop"

# --- locate repo root (parent of /scripts) ---
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
Write-Host "==> Initializing git in $repo" -ForegroundColor Cyan

# --- guard: refuse to proceed if .env exists and is tracked-looking ---
if (Test-Path ".env") {
    Write-Warning ".env is present in the working tree. It WILL be ignored by .gitignore, but double-check it never ends up staged."
}

# --- git init (idempotent) ---
if (-not (Test-Path ".git")) {
    git init -b main | Out-Null
} else {
    Write-Host "    .git already exists — continuing" -ForegroundColor DarkGray
}

# --- user identity (only set if not already configured locally or globally) ---
$email = (git config user.email) 2>$null
if (-not $email) {
    git config user.email "creativeoutletclothing@gmail.com"
    git config user.name  "Jake Johnson"
    Write-Host "    Set local user.email / user.name" -ForegroundColor DarkGray
}

# --- stage & show what will be committed ---
git add .
Write-Host ""
Write-Host "==> Files staged for the initial commit:" -ForegroundColor Cyan
git status --short

# --- last-line safety net: refuse to commit if .env slipped in ---
$staged = git diff --cached --name-only
if ($staged -match '(^|/)\.env$') {
    Write-Error ".env is staged. Aborting. Check .gitignore and remove it from the index: git rm --cached .env"
    exit 1
}
if ($staged -match 'docker-compose\.override\.yml') {
    Write-Error "docker-compose.override.yml is staged. It's meant to be generated per-host. Aborting."
    exit 1
}

# --- commit (only if there is anything to commit) ---
$head = (git rev-parse --verify HEAD) 2>$null
if (-not $head) {
    git commit -m "Initial commit: cloud-hosted household AI stack"
} else {
    Write-Host "    HEAD already exists — skipping initial commit" -ForegroundColor DarkGray
}

# --- remote ---
$remoteUrl = "https://github.com/creativeoutletcoding-lang/household-ai.git"
$existing  = (git remote get-url origin) 2>$null
if (-not $existing) {
    git remote add origin $remoteUrl
    Write-Host "    Added remote origin -> $remoteUrl" -ForegroundColor DarkGray
} elseif ($existing -ne $remoteUrl) {
    Write-Host "    Remote 'origin' exists but points elsewhere ($existing). Leaving as-is." -ForegroundColor Yellow
} else {
    Write-Host "    Remote origin already set" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "==> Done. To push:" -ForegroundColor Green
Write-Host "      git push -u origin main"
Write-Host ""
Write-Host "    You'll be prompted for GitHub credentials on first push."
Write-Host "    See docs/github-setup.md for auth options."
