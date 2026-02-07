# Fully Automatic Release Script
# Runs checks, formats, stages, auto-generates commit message, commits, and pushes
# Usage: .\quick-release.ps1
# Or with custom message: .\quick-release.ps1 -CustomMessage "add new sync feature"

param(
    [string]$CustomMessage = ""
)

Write-Host "=== ODP+ Auto Release ===" -ForegroundColor Cyan

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

# Auto-detect commit type based on changed files
function Get-CommitType {
    param($files)
    
    $hasCode = $false
    $hasDocs = $false
    $hasConfig = $false
    $hasTests = $false
    $hasCI = $false
    
    foreach ($file in $files) {
        if ($file -match '\.(ts|js|tsx|jsx|css|html)$' -and $file -notmatch '\.config\.' -and $file -notmatch 'test') {
            $hasCode = $true
        }
        if ($file -match '\.(md|txt)$' -or $file -match 'README|CHANGELOG|docs/') {
            $hasDocs = $true
        }
        if ($file -match '(package\.json|\.json$|\.yaml$|\.yml$|\.config\.)' -and $file -notmatch 'workflows/') {
            $hasConfig = $true
        }
        if ($file -match 'test|spec') {
            $hasTests = $true
        }
        if ($file -match '\.github/workflows/|\.github/actions/') {
            $hasCI = $true
        }
    }
    
    # Priority order for determining type
    if ($hasCI) { return "ci" }
    if ($hasTests -and -not $hasCode) { return "test" }
    if ($hasDocs -and -not $hasCode) { return "docs" }
    if ($hasConfig -and -not $hasCode) { return "chore" }
    if ($hasCode) { return "feat" }
    
    return "chore"
}

# Generate commit message
$commitType = Get-CommitType -files $stagedFiles

# Create a summary of changes
$fileCount = ($stagedFiles | Measure-Object).Count
$summary = if ($CustomMessage) {
    $CustomMessage
} else {
    # Auto-generate summary based on files
    $dirs = $stagedFiles | ForEach-Object { Split-Path $_ -Parent } | Where-Object { $_ } | Select-Object -Unique
    
    if ($fileCount -eq 1) {
        "update $($stagedFiles[0])"
    } elseif ($dirs.Count -eq 1 -and $dirs[0]) {
        "update $($dirs[0]) ($fileCount files)"
    } else {
        "update $fileCount files"
    }
}

$commitMessage = "${commitType}: ${summary}"

Write-Host "`nCommit message:" -ForegroundColor Green
Write-Host "  $commitMessage" -ForegroundColor White

# Commit
Write-Host "`nCommitting..." -ForegroundColor Yellow
git commit -m $commitMessage

# Push
Write-Host "`nPushing to origin..." -ForegroundColor Yellow
git push

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Check GitHub Actions for the automatic release: https://github.com/VenB304/odp-plus/actions" -ForegroundColor Cyan
