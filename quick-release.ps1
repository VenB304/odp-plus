# Fully Automatic Release Script
# Stages, auto-generates detailed Conventional Commit message using Copilot CLI, commits, and pushes
# Usage: .\quick-release.ps1
# Or with custom message: .\quick-release.ps1 -CustomMessage "add new sync feature"
# Or skip formatting: .\quick-release.ps1 -SkipFormat
# Or dry run: .\quick-release.ps1 -DryRun

[CmdletBinding()]
param(
    [Parameter(HelpMessage = "Custom commit message (skips Copilot generation)")]
    [string]$CustomMessage = "",
    
    [Parameter(HelpMessage = "Skip code formatting step")]
    [switch]$SkipFormat,
    
    [Parameter(HelpMessage = "Preview changes without committing/pushing")]
    [switch]$DryRun,
    
    [Parameter(HelpMessage = "Maximum diff size for Copilot (default: 3500)")]
    [int]$MaxDiffSize = 3500
)

$ErrorActionPreference = "Stop"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Step {
    param([string]$Message)
    Write-Host "`n$Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "Error: $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Test-GitRepository {
    if (-not (Test-Path ".git")) {
        Write-Error "Not a Git repository. Run this script from the repository root."
        exit 1
    }
}

function Test-GitClean {
    # Check for uncommitted changes before we start
    $status = git status --porcelain
    return [string]::IsNullOrEmpty($status)
}

function Get-CurrentBranch {
    return git rev-parse --abbrev-ref HEAD
}

function Test-CopilotCLI {
    if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
        Write-Error "'copilot' CLI not found in PATH."
        Write-Host "Install it with: npm install -g @githubnext/github-copilot-cli" -ForegroundColor Yellow
        return $false
    }
    return $true
}

function Invoke-SafePull {
    param([bool]$HasChanges)
    
    Write-Step "Pulling latest changes..."
    
    # Stash changes if any
    $stashCreated = $false
    if ($HasChanges) {
        Write-Host "Stashing local changes..." -ForegroundColor DarkGray
        git stash push -u -m "Auto-release stash $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        $stashCreated = ($LASTEXITCODE -eq 0)
        
        if (-not $stashCreated) {
            Write-Error "Failed to stash changes"
            exit 1
        }
    }
    
    # Pull with rebase
    git pull --rebase 2>&1 | Out-Null
    $pullSuccess = ($LASTEXITCODE -eq 0)
    
    # Pop stash if we created one
    if ($stashCreated) {
        Write-Host "Restoring local changes..." -ForegroundColor DarkGray
        git stash pop 2>&1 | Out-Null
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to restore stashed changes. Run 'git stash pop' manually."
            exit 1
        }
    }
    
    if (-not $pullSuccess) {
        Write-Error "Pull failed! Please resolve conflicts manually."
        exit 1
    }
    
    Write-Success "[OK] Repository updated"
}

function Invoke-CodeFormat {
    if ($SkipFormat) {
        Write-Info "Skipping format step (-SkipFormat flag used)"
        return
    }
    
    Write-Step "Formatting code..."
    
    # Check if package.json exists and has format script
    if (-not (Test-Path "package.json")) {
        Write-Info "No package.json found, skipping format"
        return
    }
    
    $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
    if (-not $packageJson.scripts.format) {
        Write-Info "No 'format' script in package.json, skipping"
        return
    }
    
    npm run format 2>&1 | Out-Null
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Format failed!"
        
        # Ask user if they want to continue
        $response = Read-Host "Continue anyway? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            exit 1
        }
    } else {
        Write-Success "[OK] Code formatted"
    }
}

function Get-StagedFiles {
    Write-Step "Staging changes..."
    git add .
    
    $stagedFiles = @(git diff --cached --name-only)
    
    if ($stagedFiles.Count -eq 0) {
        Write-Info "No changes to commit."
        exit 0
    }
    
    Write-Host "`nStaged files ($($stagedFiles.Count)):" -ForegroundColor Yellow
    $stagedFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    
    return $stagedFiles
}

function Get-ConventionalCommitType {
    param([string[]]$Files)
    
    # Heuristics for commit type
    $hasCode = $Files -match '\.(ts|js|jsx|tsx|py|java|cs|go|rs)$'
    $hasDocs = $Files -match '\.(md|txt|rst)$'
    $hasConfig = $Files -match '\.(json|yaml|yml|toml|ini|config)$'
    $hasTests = $Files -match '\.(test|spec)\.(ts|js|jsx|tsx|py)$'
    $hasStyles = $Files -match '\.(css|scss|sass|less)$'
    
    if ($hasTests) { return "test" }
    if ($hasDocs -and -not $hasCode) { return "docs" }
    if ($hasConfig -and -not $hasCode) { return "chore" }
    if ($hasStyles -and -not $hasCode) { return "style" }
    if ($hasCode) { return "feat" }
    
    return "chore"
}

function Get-CopilotCommitMessage {
    param(
        [string]$Diff,
        [string[]]$StagedFiles
    )
    
    Write-Step "Generating commit message with Copilot..."
    
    # Truncate diff if too large
    if ($Diff.Length -gt $MaxDiffSize) {
        $Diff = $Diff.Substring(0, $MaxDiffSize) + "`n...(truncated for length)"
        Write-Host "Diff truncated to $MaxDiffSize characters" -ForegroundColor DarkGray
    }
    
    # Read instructions if available
    $instructions = ""
    if (Test-Path "copilot-instructions.md") {
        $instructions = Get-Content "copilot-instructions.md" -Raw
    }
    
    # Build file summary
    $fileSummary = "Files changed: $($StagedFiles.Count)`n" + ($StagedFiles -join "`n")
    
    # Construct prompt
    $prompt = @"
Context: $instructions

Files Modified:
$fileSummary

Diff:
$Diff

Task: Generate a single detailed Conventional Commit message for these changes.

Requirements:
1. MUST start with a semantic prefix (feat:, fix:, docs:, chore:, refactor:, test:, style:, perf:, ci:, build:)
2. Header line format: "type(scope): brief summary" or "type: brief summary"
3. Include a body with bullet points explaining key changes
4. Keep header under 72 characters
5. Output ONLY the raw commit message (no markdown fences, no explanations)
"@
    
    try {
        # Call Copilot CLI
        $copilotOutput = & copilot -p $prompt 2>&1
        
        # Process output
        $rawString = $copilotOutput -join "`n"
        
        # Clean up the response
        $cleaned = $rawString `
            -replace '(?s)(Total usage est:|Breakdown by AI model:).*$', '' `
            -replace '(?i)^(Here is|Sure|Noted|Okay|Here.s).*?:', '' `
            -replace '^```[^\n]*\n', '' `
            -replace '\n```$', '' `
            -replace '```', ''
        
        $commitMessage = $cleaned.Trim().Trim('"').Trim("'")
        
        # Validate we got something useful
        if ([string]::IsNullOrWhiteSpace($commitMessage)) {
            throw "Empty response from Copilot"
        }
        
        # Check if it looks like a conventional commit
        if ($commitMessage -notmatch '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:') {
            Write-Host "Warning: Generated message may not follow Conventional Commit format" -ForegroundColor Yellow
        }
        
        Write-Success "[OK] Commit message generated"
        return $commitMessage
        
    } catch {
        Write-Host "Copilot generation failed: $_" -ForegroundColor Red
        Write-Host "Falling back to heuristic generation..." -ForegroundColor Yellow
        
        # Fallback
        $commitType = Get-ConventionalCommitType -Files $StagedFiles
        $count = $StagedFiles.Count
        $fileWord = if ($count -eq 1) { "file" } else { "files" }
        
        return "${commitType}: update $count ${fileWord}`n`nAuto-generated commit message"
    }
}

function Invoke-Commit {
    param([string]$Message)
    
    if ($DryRun) {
        Write-Info "`n[DRY RUN] Would commit with message:"
        Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
        Write-Host $Message -ForegroundColor White
        Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
        return
    }
    
    Write-Step "Committing..."
    git commit -m $Message
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Commit failed!"
        exit 1
    }
    
    Write-Success "[OK] Changes committed"
}

function Invoke-Push {
    param([string]$Branch)
    
    if ($DryRun) {
        Write-Info "[DRY RUN] Would push to origin/$Branch"
        return
    }
    
    Write-Step "Pushing to origin/$Branch..."
    git push
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Push failed!"
        Write-Host "Your commit is saved locally. Try pushing manually with 'git push'" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Success "[OK] Changes pushed"
}

# ============================================================================
# Main Script
# ============================================================================

Write-Host "`n=== ODP+ Auto Release ===" -ForegroundColor Cyan

# Validate environment
Test-GitRepository

$currentBranch = Get-CurrentBranch
Write-Info "Current branch: $currentBranch"

# Check for Copilot if we need it
if (-not $CustomMessage) {
    if (-not (Test-CopilotCLI)) {
        Write-Host "`nFalling back to simple commit messages..." -ForegroundColor Yellow
        $CustomMessage = "auto"  # Trigger fallback
    }
}

# Check for existing changes
$hasInitialChanges = -not (Test-GitClean)

# Pull latest changes
Invoke-SafePull -HasChanges $hasInitialChanges

# Format code
Invoke-CodeFormat

# Stage and get files
$stagedFiles = Get-StagedFiles

# Generate commit message
if ($CustomMessage -and $CustomMessage -ne "auto") {
    $commitMessage = $CustomMessage
    Write-Info "`nUsing custom commit message:"
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $commitMessage -ForegroundColor White
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
} else {
    # Get diff for Copilot
    $diff = git diff --cached
    $commitMessage = Get-CopilotCommitMessage -Diff $diff -StagedFiles $stagedFiles
    
    Write-Host "`nGenerated commit message:" -ForegroundColor Green
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $commitMessage -ForegroundColor White
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    
    # Allow user to abort
    if (-not $DryRun) {
        Write-Host "`nPress Enter to continue, or Ctrl+C to abort..." -ForegroundColor DarkGray
        Read-Host
    }
}

# Commit
Invoke-Commit -Message $commitMessage

# Push
Invoke-Push -Branch $currentBranch

# Summary
Write-Host "`n=== Done! ===" -ForegroundColor Green

if (-not $DryRun) {
    Write-Info "Check GitHub Actions: https://github.com/VenB304/odp-plus/actions"
}

exit 0