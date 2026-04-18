# GitHub setup — one-time walkthrough

This is the human side of pushing this repo to GitHub: creating the empty remote repo, choosing an auth method, and running the first push.

## 1. Create the empty repo on GitHub

1. Go to https://github.com/new while logged in as `creativeoutletcoding-lang` (or whichever account should own the repo — if the owner differs, update the remote URL in `scripts/init-repo.ps1` first).
2. Fill in:
   - **Owner:** `creativeoutletcoding-lang`
   - **Repository name:** `household-ai`
   - **Visibility:** Private. This repo will never contain real secrets, but it does disclose your architecture, domain, and firewall rules — private is the safer default for a family system.
   - **Initialize this repository with:** leave ALL boxes unchecked. No README, no .gitignore, no license. You already have those locally.
3. Click **Create repository**. You'll land on an empty-repo page with setup instructions — ignore those; you've already run the equivalent locally.

If you'd prefer the `gh` CLI:

```powershell
gh repo create creativeoutletcoding-lang/household-ai --private --source=. --remote=origin
```

(That replaces both step 1 and step 4 below — skip straight to the push in step 5.)

## 2. Run the local init script

From the project folder in PowerShell:

```powershell
cd "C:\Users\jake.johnson\OneDrive - Foundation Insurance Group\Documents\Claude\Projects\Household AI"
.\scripts\init-repo.ps1
```

That script runs `git init`, stages everything, verifies `.env` and `docker-compose.override.yml` are not about to be committed, creates the initial commit, and adds `origin`.

## 3. Pick an auth method

GitHub stopped accepting account passwords for HTTPS git operations in 2021. You need either (a) a Personal Access Token used as a password, or (b) an SSH key.

### Option A — Personal Access Token (HTTPS, simplest)

Best if you only push from this one Windows machine and don't feel like dealing with SSH.

1. https://github.com/settings/tokens?type=beta → **Generate new token (fine-grained)**.
2. **Token name:** `household-ai-push-<machine-name>`.
3. **Expiration:** 90 days is the GitHub default; 1 year is fine for a personal machine. Don't pick "No expiration."
4. **Repository access:** "Only select repositories" → pick `creativeoutletcoding-lang/household-ai`.
5. **Repository permissions:**
   - **Contents:** Read and write
   - **Metadata:** Read-only (automatic)
   - Everything else: No access
6. **Generate token.** Copy it immediately — GitHub won't show it again.

Tell Windows to remember it so you don't paste it on every push:

```powershell
git config --global credential.helper manager
```

The Git Credential Manager ships with Git for Windows; it stores the token in the Windows Credential Vault after your first successful push. On that first push (`git push -u origin main`), a browser window will pop up asking you to sign in — sign in and paste the PAT when it asks for a password.

### Option B — SSH key (longer to set up, never expires)

Best if you already use SSH for other GitHub repos or you want machine-bound auth with no tokens to rotate.

```powershell
# Generate a key (press Enter at every prompt to accept defaults; optionally set a passphrase)
ssh-keygen -t ed25519 -C "creativeoutletclothing@gmail.com"

# Make sure the ssh-agent is running and add the key
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add $env:USERPROFILE\.ssh\id_ed25519

# Copy the PUBLIC key to your clipboard (the .pub file, NEVER the private one)
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
```

Then go to https://github.com/settings/keys → **New SSH key**, title it `household-ai - <machine>`, paste, and save.

Verify:

```powershell
ssh -T git@github.com
# Expect: "Hi creativeoutletcoding-lang! You've successfully authenticated..."
```

Finally, switch this repo's remote from HTTPS to SSH:

```powershell
git remote set-url origin git@github.com:creativeoutletcoding-lang/household-ai.git
```

## 4. Push

```powershell
git push -u origin main
```

- PAT path: browser pop-up on first push, paste token, done. Subsequent pushes are silent.
- SSH path: passphrase prompt (if you set one), then done.

## 5. Confirm on GitHub

Refresh the repo page. You should see the README rendering as the landing page, and 8 files in the root (`docker-compose.yml`, `install.sh`, `runbook.md`, `.env.example`, `.gitignore`, `README.md`, plus the `docs/` and `postgres/` subfolders).

Double-check: click `.env.example` and confirm it opens. Search the repo (`.` anywhere on the page, then type `sk-ant`) and confirm there are zero matches. That is your last defense against accidentally committing a real key.

## Day-to-day from here

```powershell
# Make changes, then:
git add -A
git commit -m "short description"
git push
```

If you ever edit `.env` on the droplet and forget which values you set, pull the droplet copy over — but do not ever `git add` it. The template in `.env.example` is the only env file that lives in git.
