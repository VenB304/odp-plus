# Fully Automatic Release Script
# Stages, auto-generates detailed Conventional Commit message using Copilot CLI, commits, and pushes
# Usage: .\quick-release.ps1
# Or with custom message: .\quick-release.ps1 -CustomMessage "add new sync feature"

param(
    [string]$CustomMessage = ""
)

Write-Host "=== ODP+ Auto Release ===" -ForegroundColor Cyan

# Check if Copilot CLI is available
if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'copilot' CLI not found in PATH." -ForegroundColor Red
    Write-Host "Please install it: npm install -g @githubnext/github-copilot-cli" -ForegroundColor Yellow
    exit 1
}

# Pull latest changes first (rebase to avoid merge commits)
Write-Host "`nPulling latest changes..." -ForegroundColor Yellow

# Stash changes if any
$hasChanges = $false
if (git status --porcelain) {
    $hasChanges = $true
    Write-Host "Stashing local changes..." -ForegroundColor DarkGray
    git stash push -u -m "Auto-release stash"
}

git pull --rebase
$pullExitCode = $LASTEXITCODE

# Pop stash if we stashed
if ($hasChanges) {
    Write-Host "Restoring local changes..." -ForegroundColor DarkGray
    git stash pop
}

if ($pullExitCode -ne 0) {
    Write-Host "Pull failed! Please resolve conflicts manually." -ForegroundColor Red
    exit 1
}

# Run format (auto-fixes issues)
Write-Host "`nFormatting code..." -ForegroundColor Yellow
npm run format
if ($LASTEXITCODE -ne 0) {
    Write-Host "Format failed!" -ForegroundColor Red
    exit 1
}

# Stage all changes
Write-Host "`nStaging changes..." -ForegroundColor Yellow
git add .

# Get staged files
$stagedFiles = git diff --cached --name-only
if (-not $stagedFiles) {
    Write-Host "No changes to commit." -ForegroundColor Red
    exit 0
}

Write-Host "Staged files:" -ForegroundColor Yellow
$stagedFiles | ForEach-Object { Write-Host "  $_" }

# Generate commit message
if ($CustomMessage) {
    $commitMessage = $CustomMessage
} else {
    Write-Host "`nGenerating detailed commit message with Copilot..." -ForegroundColor Cyan
    
    # 1. Capture Diff (truncate if too large)
    $diff = git diff --cached
    if ($diff.Length -gt 6000) {
        $diff = git diff --cached --stat
        Write-Host "Diff too large, using --stat for context." -ForegroundColor DarkGray
    }
    
    # 2. Read copilot-instructions.md
    $instructions = ""
    if (Test-Path "copilot-instructions.md") {
        $instructions = Get-Content "copilot-instructions.md" -Raw
    }
    
    # 3. Construct Prompt
    $prompt = "Context: $instructions`n`nChanges:`n$diff`n`nTask: Generate a single detailed Conventional Commit message for these changes. The message MUST start with a semantic prefix (feat:, fix:, docs:, chore:, etc.). It MUST have a header line (type: summary) and a body with bullet points explaining the changes. Do not use markdown fences. Output ONLY the raw message."
    
    # 4. Call Copilot
    # Note: copilot CLI might not support -p directly depending on version, checking help output earlier suggested interactive.
    # We'll try piping or argument if supported, but typically 'copilot' CLI is interactive.
    # However, 'copilot' CLI (GitHub Copilot CLI) usually supports 'suggest' or 'explain' with query.
    # Wait, user checking 'copilot --help' showed it is interactive mainly.
    # Let's try 'copilot -s "command"' or similar if it's the GitHubNext one?
    # Actually, the user's output for `copilot --help` showed `copilot init`, `copilot --allow-all-urls` etc.
    # This looks like the specialized agent CLI or similar.
    # If standard non-interactive is tricky, we can use the `gh copilot suggest` (which is deprecated but user has `copilot` standalone).
    # Let's try a direct query execution if possible.
    # If not, we'll fall back to simple heuristic if copilot fails.
    
    # Validating usage from previous turns: 'copilot "hello"' failed with "Did you mean: copilot -i?" and mentioned -p.
    # Users output: "For non-interactive mode, use the -p or --prompt option."
    # So -p IS supported! Great.
    
    try {
        # Using cmd /c to ensure proper execution of the batch/cmd wrapper if on Windows
        $commitMessageRaw = cmd /c copilot -p "$prompt" 2>$null
        
        # Clean up output (sometimes returns quotes or wrappers)
        $commitMessage = $commitMessageRaw -replace '^[`"''\s]+|[`"''\s]+$', ''
        
        if (-not $commitMessage) { throw "Empty response" }
    } catch {
        Write-Host "Copilot generation failed or returned empty. Falling back to heuristic." -ForegroundColor Red
        # Fallback to simple generation
        $commitType = "chore"
        if ($stagedFiles -match '\.(ts|js|jsx|tsx)$') { $commitType = "feat" }
        $count = ($stagedFiles | Measure-Object).Count
        $commitMessage = "{0}: update {1} files" -f $commitType, $count
    }
}

Write-Host "`nCommit message:" -ForegroundColor Green
Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
Write-Host "$commitMessage" -ForegroundColor White
Write-Host "--------------------------------------------------" -ForegroundColor DarkGray

# Commit
Write-Host "`nCommitting..." -ForegroundColor Yellow
git commit -m $commitMessage

# Push
Write-Host "`nPushing to origin..." -ForegroundColor Yellow
git push

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Check GitHub Actions: https://github.com/VenB304/odp-plus/actions" -ForegroundColor Cyan
