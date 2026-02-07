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
    [int]$MaxDiffSize = 5000
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
    
    # Truncate diff if too large
    if ($Diff.Length -gt $MaxDiffSize) {
        $Diff = $Diff.Substring(0, $MaxDiffSize)
        Write-Host "Diff truncated to $MaxDiffSize characters" -ForegroundColor DarkGray
    }
    
    # Read copilot-instructions.md if available
    $instructions = ""
    if (Test-Path "copilot-instructions.md") {
        $instructions = Get-Content "copilot-instructions.md" -Raw
        Write-Host "Using copilot-instructions.md for context" -ForegroundColor DarkGray
    }
    
    # Build file summary
    $fileSummary = ($StagedFiles | ForEach-Object { "- $_" }) -join "`n"
    
    # Construct detailed prompt following your copilot-instructions.md
    $prompt = @"
Write a git commit message following Conventional Commits specification.

PROJECT COMMIT GUIDELINES:
$instructions

FILES CHANGED ($($StagedFiles.Count) files):
$fileSummary

GIT DIFF:
$Diff

Generate a commit message with:
1. Header: <type>: <summary> (under 72 chars)
2. Body: Detailed explanation of what and why
3. Use types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
4. Be specific about components/files changed
5. Explain the purpose and benefits

Output ONLY the commit message (no markdown fences, no explanations).
"@

    try {
        Write-Host "Calling GitHub Copilot CLI..." -ForegroundColor DarkGray
        
        # Simple approach: Write prompt to temp file, pipe it to copilot via stdin
        $promptFile = [System.IO.Path]::GetTempFileName()
        $outputFile = [System.IO.Path]::GetTempFileName()
        
        try {
            # Write the prompt to file
            Set-Content -Path $promptFile -Value $prompt -Encoding UTF8
            
            # Use copilot in a simpler way - just pipe the file content
            # The -p flag might be the issue, let's try interactive mode with input redirect
            Write-Host "Executing: Get-Content prompt | copilot --silent --allow-all-tools" -ForegroundColor DarkGray
            
            # Method: Use PowerShell pipeline which handles this cleanly
            $copilotOutput = Get-Content $promptFile -Raw | & copilot --silent --allow-all-tools 2>&1
            
            # Alternative: If that doesn't work, save to output file using redirection
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($copilotOutput -join ""))) {
                Write-Host "Trying alternative invocation method..." -ForegroundColor DarkGray
                
                # Create a batch script to handle the execution
                $batchFile = [System.IO.Path]::GetTempFileName() + ".bat"
                $batchContent = @"
@echo off
copilot -p "@$promptFile" --silent --allow-all-tools > "$outputFile" 2>&1
"@
                Set-Content -Path $batchFile -Value $batchContent -Encoding ASCII
                
                # Execute the batch file
                $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$batchFile`"" -Wait -PassThru -NoNewWindow
                
                if ($process.ExitCode -eq 0 -and (Test-Path $outputFile)) {
                    $copilotOutput = Get-Content $outputFile -Raw
                } else {
                    throw "Batch invocation failed with exit code $($process.ExitCode)"
                }
                
                Remove-Item $batchFile -Force -ErrorAction SilentlyContinue
            }
            
            # Process output
            $rawString = if ($copilotOutput -is [array]) { $copilotOutput -join "`n" } else { $copilotOutput }
            
            Write-Host "Copilot response received (length: $($rawString.Length) chars)" -ForegroundColor DarkGray
            
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
                Write-Host "Warning: Response may not follow Conventional Commit format" -ForegroundColor Yellow
                Write-Host "First line: $firstLine" -ForegroundColor DarkGray
            }
            
            Write-Success "[OK] Commit message generated by GitHub Copilot"
            return $commitMessage
            
        } finally {
            # Clean up temp files
            Remove-Item $promptFile -Force -ErrorAction SilentlyContinue
            Remove-Item $outputFile -Force -ErrorAction SilentlyContinue
        }
        
    } catch {
        Write-Host "GitHub Copilot generation failed: $_" -ForegroundColor Red
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
    $useGitHubCopilot = Test-GitHubCopilotCLI
    if (-not $useGitHubCopilot) {
        Write-Host "`nGitHub Copilot CLI not available - will use smart fallback" -ForegroundColor Yellow
    }
}

# Check for existing changes
$hasInitialChanges = git status --porcelain

# Pull latest changes
Invoke-SafePull -HasChanges ($null -ne $hasInitialChanges)

# Format code
Invoke-CodeFormat

# Stage and get files
$stagedFiles = Get-StagedFiles

# Generate commit message
if ($CustomMessage) {
    $commitMessage = $CustomMessage
    Write-Info "`nUsing custom commit message:"
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $commitMessage -ForegroundColor White
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
} else {
    # Get diff for analysis
    $diff = git diff --cached
    
    # Generate commit message
    if ($useGitHubCopilot) {
        $commitMessage = Get-GitHubCopilotCommitMessage -Diff $diff -StagedFiles $stagedFiles
    } else {
        $commitMessage = Get-FallbackCommitMessage -Files $stagedFiles -Diff $diff
    }
    
    Write-Host "`nGenerated commit message:" -ForegroundColor Green
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    Write-Host $commitMessage -ForegroundColor White
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
    
    # Allow user to confirm or edit
    if (-not $DryRun) {
        Write-Host "`nPress Enter to use this message, 'e' to edit, or Ctrl+C to abort..." -ForegroundColor DarkGray
        $response = Read-Host
        if ($response -eq 'e' -or $response -eq 'E') {
            Write-Host "`nEnter your custom commit message:" -ForegroundColor Yellow
            Write-Host "(Type your message and press Enter twice when done)" -ForegroundColor DarkGray
            $customLines = @()
            $emptyLineCount = 0
            do {
                $line = Read-Host
                if ([string]::IsNullOrWhiteSpace($line)) {
                    $emptyLineCount++
                } else {
                    $emptyLineCount = 0
                    $customLines += $line
                }
            } while ($emptyLineCount -lt 2)
            
            if ($customLines.Count -gt 0) {
                $commitMessage = $customLines -join "`n"
            }
        }
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