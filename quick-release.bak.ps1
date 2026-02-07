# Fully Automatic Release Script with GitHub Copilot CLI
# Stages, auto-generates detailed Conventional Commit message using GitHub Copilot CLI, commits, and pushes
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
    
    [Parameter(HelpMessage = "Maximum diff size for Copilot (default: 5000)")]
    [int]$MaxDiffSize = 5000,
    
    [Parameter(HelpMessage = "Wait for semantic-release-bot commit after pushing (default: true)")]
    [bool]$WaitForRelease = $true,
    
    [Parameter(HelpMessage = "Maximum time to wait for semantic-release-bot in seconds (default: 120)")]
    [int]$ReleaseWaitTimeout = 120
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

function Get-CurrentBranch {
    return git rev-parse --abbrev-ref HEAD
}

function Test-GitHubCopilotCLI {
    # Check if the new GitHub Copilot CLI is installed (@github/copilot)
    try {
        $copilotVersion = & copilot --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "GitHub Copilot CLI detected: $copilotVersion" -ForegroundColor DarkGray
            return $true
        }
    } catch {
        Write-Host "GitHub Copilot CLI not found" -ForegroundColor Yellow
        Write-Host "Install with: npm install -g @github/copilot" -ForegroundColor Yellow
        Write-Host "Then authenticate with: copilot auth" -ForegroundColor Yellow
        return $false
    }
    return $false
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
    $hasCode = $Files -match '\.(ts|js|jsx|tsx|py|java|cs|go|rs|c|cpp)$'
    $hasDocs = $Files -match '\.(md|txt|rst|adoc)$'
    $hasConfig = $Files -match '\.(json|yaml|yml|toml|ini|config)$'
    $hasTests = $Files -match '\.(test|spec)\.(ts|js|jsx|tsx|py)$'
    $hasStyles = $Files -match '\.(css|scss|sass|less)$'
    $hasBuild = $Files -match 'package\.json|package-lock\.json'
    
    if ($hasTests) { return "test" }
    if ($hasDocs -and -not $hasCode) { return "docs" }
    if ($hasBuild -and -not $hasCode) { return "build" }
    if ($hasConfig -and -not $hasCode) { return "chore" }
    if ($hasStyles -and -not $hasCode) { return "style" }
    if ($hasCode) { return "feat" }
    
    return "chore"
}

function Get-GitHubCopilotCommitMessage {
    param(
        [string]$Diff,
        [string[]]$StagedFiles
    )
    
    Write-Step "Generating commit message with GitHub Copilot CLI..."
    
    # Smart truncation - keep important parts
    $originalLength = $Diff.Length
    if ($Diff.Length -gt $MaxDiffSize) {
        # Try to keep complete hunks rather than cutting mid-line
        $truncated = $Diff.Substring(0, $MaxDiffSize)
        $lastNewline = $truncated.LastIndexOf("`n@@")
        if ($lastNewline -gt ($MaxDiffSize * 0.8)) {
            $Diff = $truncated.Substring(0, $lastNewline)
        } else {
            $Diff = $truncated
        }
        Write-Host "Diff truncated from $originalLength to $($Diff.Length) chars (kept complete hunks)" -ForegroundColor DarkGray
    }
    
    # Read copilot-instructions.md if available
    $instructions = ""
    if (Test-Path "copilot-instructions.md") {
        $instructions = Get-Content "copilot-instructions.md" -Raw
        Write-Host "Using copilot-instructions.md for context" -ForegroundColor DarkGray
    }
    
    # Build file summary with change stats
    $fileSummary = @()
    foreach ($file in $StagedFiles) {
        $stats = git diff --cached --numstat -- $file
        if ($stats) {
            $parts = $stats -split "`t"
            $added = $parts[0]
            $removed = $parts[1]
            $fileSummary += "- $file (+$added/-$removed)"
        } else {
            $fileSummary += "- $file"
        }
    }
    $fileSummaryText = $fileSummary -join "`n"
    
    # Construct detailed prompt following your copilot-instructions.md
    # $prompt = "simple prompt"
    $prompt = "Write a simple commit message"

    try {
        Write-Host "Calling GitHub Copilot CLI..." -ForegroundColor Cyan
        
        # Simple approach: Write prompt to temp file, pipe it to copilot via stdin
        $promptFile = [System.IO.Path]::GetTempFileName()
        
        try {
            # Write the prompt to file
            Set-Content -Path $promptFile -Value $prompt -Encoding UTF8
            
            # Use copilot without --silent to see usage stats
            Write-Host "Executing: Get-Content prompt | copilot --allow-all-tools" -ForegroundColor DarkGray
            
            # Use PowerShell pipeline which handles this cleanly
            $copilotOutput = Get-Content $promptFile -Raw | & copilot --allow-all-tools 2>&1
            
            if ($LASTEXITCODE -ne 0) {
                throw "Copilot failed with exit code $LASTEXITCODE"
            }
            
            # Process output
            $rawString = if ($copilotOutput -is [array]) { $copilotOutput -join "`n" } else { $copilotOutput }
            
            # Split response from stats
            # Stats typically appear at the end after the response
            $lines = $rawString -split "`n"
            
            # Find where stats begin (usually "Total usage est:" or similar)
            $statsStartIndex = -1
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($lines[$i] -match "(Total usage|Breakdown by|Model:|Request)") {
                    $statsStartIndex = $i
                    break
                }
            }
            
            if ($statsStartIndex -gt 0) {
                # Extract message and stats separately
                $messageLines = $lines[0..($statsStartIndex - 1)]
                $statsLines = $lines[$statsStartIndex..($lines.Count - 1)]
                
                $rawString = $messageLines -join "`n"
                $stats = $statsLines -join "`n"
                
                # Display stats
                Write-Host "`nCopilot Usage Stats:" -ForegroundColor Cyan
                $statsLines | ForEach-Object { 
                    if ($_ -match "Model:") {
                        Write-Host "  $_" -ForegroundColor Yellow
                    } else {
                        Write-Host "  $_" -ForegroundColor DarkGray
                    }
                }
            }
            
            Write-Host "`nCopilot response received (length: $($rawString.Length) chars)" -ForegroundColor DarkGray
            
            # Clean up the response
            $cleaned = $rawString `
                -replace '^```[^\n]*\n', '' `
                -replace '\n```$', '' `
                -replace '```', ''
            
            $commitMessage = $cleaned.Trim()
            
            # Validate we got something useful
            if ([string]::IsNullOrWhiteSpace($commitMessage) -or $commitMessage.Length -lt 15) {
                throw "Invalid or empty Copilot response. Output: '$commitMessage'"
            }
            
            # Check if it follows conventional commit format
            $firstLine = ($commitMessage -split "`n")[0]
            if ($commitMessage -notmatch '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+?\))?:\s') {
                Write-Host "`nWarning: Response may not follow Conventional Commit format" -ForegroundColor Yellow
                Write-Host "First line: $firstLine" -ForegroundColor DarkGray
            }
            
            Write-Success "`n[OK] Commit message generated by GitHub Copilot"
            return $commitMessage
            
        } finally {
            # Clean up temp files
            Remove-Item $promptFile -Force -ErrorAction SilentlyContinue
        }
        
    } catch {
        Write-Host "`nGitHub Copilot generation failed: $_" -ForegroundColor Red
        Write-Host "Error details: $($_.Exception.Message)" -ForegroundColor DarkGray
        Write-Host "Falling back to smart generation..." -ForegroundColor Yellow
        return Get-FallbackCommitMessage -Files $StagedFiles -Diff $Diff
    }
}

function Get-FallbackCommitMessage {
    param(
        [string[]]$Files,
        [string]$Diff
    )
    
    $commitType = Get-ConventionalCommitType -Files $Files
    $count = $Files.Count
    
    # Analyze what changed
    $changes = @()
    if ($Files -match '\.ps1$') { $changes += "PowerShell scripts" }
    if ($Files -match '\.(ts|tsx)$') { $changes += "TypeScript files" }
    if ($Files -match '\.(js|jsx)$') { $changes += "JavaScript files" }
    if ($Files -match '\.py$') { $changes += "Python files" }
    if ($Files -match '\.(css|scss)$') { $changes += "stylesheets" }
    if ($Files -match '\.md$') { $changes += "documentation" }
    if ($Files -match 'package.*\.json$') { $changes += "dependencies" }
    
    # Build header
    $header = if ($changes.Count -gt 0) {
        "${commitType}: update $($changes -join ', ')"
    } else {
        "${commitType}: update $count $(if ($count -eq 1) { 'file' } else { 'files' })"
    }
    
    # Keep header under 72 characters
    if ($header.Length -gt 72) {
        $header = "${commitType}: update $count $(if ($count -eq 1) { 'file' } else { 'files' })"
    }
    
    # Build body
    $body = "`nModified files:"
    $Files | ForEach-Object { $body += "`n- $_" }
    $body += "`n`nAuto-generated commit message (Copilot CLI unavailable)"
    
    return $header + $body
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

function Wait-ForSemanticRelease {
    param(
        [string]$Branch,
        [int]$MaxWaitTime = 120
    )
    
    Write-Step "Waiting for semantic-release-bot to finish..."
    Write-Host "Checking for automated release commit..." -ForegroundColor DarkGray
    
    $pollInterval = 3  # Check every 3 seconds
    $elapsed = 0
    $lastCommitBefore = git rev-parse HEAD
    
    while ($elapsed -lt $MaxWaitTime) {
        Start-Sleep -Seconds $pollInterval
        $elapsed += $pollInterval
        
        # Fetch latest from remote
        git fetch origin $Branch 2>&1 | Out-Null
        
        # Check if there are new commits from semantic-release-bot
        $remoteCommit = git rev-parse origin/$Branch
        
        if ($remoteCommit -ne $lastCommitBefore) {
            # Check if the new commit is from semantic-release-bot
            $commitAuthor = git log -1 --format="%an" origin/$Branch
            $commitMessage = git log -1 --format="%s" origin/$Branch
            
            if ($commitAuthor -match "semantic-release-bot" -or $commitMessage -match "^(chore\(release\)|Release)") {
                Write-Success "`n[OK] Semantic release detected!"
                Write-Host "  Author: $commitAuthor" -ForegroundColor DarkGray
                Write-Host "  Message: $commitMessage" -ForegroundColor DarkGray
                
                # Pull the release commit
                Write-Host "`nPulling release commit..." -ForegroundColor Yellow
                git pull --rebase origin $Branch 2>&1 | Out-Null
                
                if ($LASTEXITCODE -eq 0) {
                    Write-Success "[OK] Release commit pulled successfully"
                    
                    # Show the release info if available
                    $releaseTag = git describe --tags --abbrev=0 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "`n🎉 New version released: $releaseTag" -ForegroundColor Cyan
                    }
                    return $true
                } else {
                    Write-Host "Warning: Failed to pull release commit" -ForegroundColor Yellow
                    return $false
                }
            } else {
                Write-Host "`nNew commit detected but not from semantic-release-bot" -ForegroundColor Yellow
                Write-Host "  Author: $commitAuthor" -ForegroundColor DarkGray
                Write-Host "Continuing to wait..." -ForegroundColor DarkGray
                $lastCommitBefore = $remoteCommit
            }
        }
        
        # Show progress indicator
        $dots = "." * (($elapsed / $pollInterval) % 4)
        Write-Host "`rWaiting for semantic-release-bot$dots    " -NoNewline -ForegroundColor DarkGray
    }
    
    Write-Host "`n" # Clear the waiting line
    Write-Host "No semantic-release-bot commit detected after ${MaxWaitTime}s" -ForegroundColor Yellow
    Write-Host "You can manually pull later with: git pull" -ForegroundColor DarkGray
    return $false
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

# Check for GitHub Copilot CLI if needed
$useGitHubCopilot = $false
if (-not $CustomMessage) {
    Write-Host "DEBUG: Copilot check (DUMMY)"
}

Write-Host "Debug: Copilot check done"

# $stagedFiles = Get-StagedFiles

Write-Host "DEBUG: Skipping generation logic"

# Commit
Invoke-Commit -Message $commitMessage

# Push
Invoke-Push -Branch $currentBranch

# Wait for semantic-release-bot if enabled
if ($WaitForRelease -and -not $DryRun) {
    if (Test-Path ".releaserc.json" -PathType Leaf) {
        $releaseDetected = Wait-ForSemanticRelease -Branch $currentBranch -MaxWaitTime $ReleaseWaitTimeout
        
        if ($releaseDetected) {
            Write-Host "`nYour working directory is now up-to-date with the latest release!" -ForegroundColor Green
        }
    } else {
        Write-Info "Skipping wait for release (no .releaserc.json found)"
    }
}

# Summary
Write-Host "`n╔════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                           Done!                                    ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
exit 0