#!/usr/bin/env python3
import argparse
import subprocess
import sys
import os
import time
import json
import shutil
import tempfile
import re

# ============================================================================
# Configuration & Constants
# ============================================================================

COLORS = {
    "HEADER": "\033[95m",
    "BLUE": "\033[94m",
    "CYAN": "\033[96m",
    "GREEN": "\033[92m",
    "YELLOW": "\033[93m",
    "RED": "\033[91m",
    "RESET": "\033[0m",
    "BOLD": "\033[1m",
    "DIM": "\033[2m"
}

def print_color(message, color="RESET", end="\n"):
    """Print message in color."""
    print(f"{COLORS.get(color, COLORS['RESET'])}{message}{COLORS['RESET']}", end=end)

def run_command(command, shell=True, capture_output=True, text=True, check=False):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(
            command,
            shell=shell,
            capture_output=capture_output,
            text=text,
            check=check,
            encoding='utf-8', 
            errors='replace'
        )
        return result
    except subprocess.CalledProcessError as e:
        return e

def check_git_repo():
    """Ensure we are in a git repository."""
    if not os.path.exists(".git"):
        print_color("Error: Not a Git repository. Run this script from the repository root.", "RED")
        sys.exit(1)

def get_current_branch():
    """Get the current active git branch."""
    res = run_command("git rev-parse --abbrev-ref HEAD")
    if res.returncode == 0:
        return res.stdout.strip()
    return "unknown"

def check_copilot_cli():
    """Check if GitHub Copilot CLI is installed."""
    # Try 'copilot --version'
    res = run_command("copilot --version")
    if res.returncode == 0:
        print_color(f"GitHub Copilot CLI detected: {res.stdout.strip()}", "DIM")
        return True
    
    print_color("GitHub Copilot CLI not found", "YELLOW")
    print_color("Install with: npm install -g @github/copilot", "YELLOW")
    print_color("Then authenticate with: copilot auth", "YELLOW")
    return False

def invoke_safe_pull(has_changes):
    """Stash changes (if any), pull --rebase, then pop stash."""
    print_color("\nPulling latest changes...", "YELLOW")
    
    stash_created = False
    if has_changes:
        print_color("Stashing local changes...", "DIM")
        res = run_command(f'git stash push -u -m "Auto-release stash {time.strftime("%Y-%m-%d %H:%M:%S")}"')
        if res.returncode == 0:
            stash_created = True
        else:
            print_color("Error: Failed to stash changes", "RED")
            sys.exit(1)
            
    # Pull with rebase
    res = run_command("git pull --rebase")
    pull_success = (res.returncode == 0)
    
    if stash_created:
        print_color("Restoring local changes...", "DIM")
        pop_res = run_command("git stash pop")
        if pop_res.returncode != 0:
            print_color("Error: Failed to restore stashed changes. Run 'git stash pop' manually.", "RED")
            sys.exit(1)
            
    if not pull_success:
        print_color("Error: Pull failed! Please resolve conflicts manually.", "RED")
        sys.exit(1)
        
    print_color("[OK] Repository updated", "GREEN")

def invoke_code_format(skip_format):
    """Run npm run format if available."""
    if skip_format:
        print_color("Skipping format step (--skip-format flag used)", "CYAN")
        return

    print_color("\nFormatting code...", "YELLOW")
    
    if not os.path.exists("package.json"):
        print_color("No package.json found, skipping format", "CYAN")
        return

    try:
        with open("package.json", "r") as f:
            package_json = json.load(f)
    except Exception:
        print_color("Failed to parse package.json, skipping format", "CYAN")
        return

    if "scripts" not in package_json or "format" not in package_json["scripts"]:
        print_color("No 'format' script in package.json, skipping", "CYAN")
        return

    res = run_command("npm run format")
    if res.returncode != 0:
        print_color("Format failed!", "RED")
        response = input("Continue anyway? (y/N) ")
        if response.lower() != 'y':
            sys.exit(1)
    else:
        print_color("[OK] Code formatted", "GREEN")

def get_staged_files():
    """Stage all files and return the list."""
    print_color("\nStaging changes...", "YELLOW")
    run_command("git add .")
    
    res = run_command("git diff --cached --name-only")
    files = [f for f in res.stdout.split('\n') if f.strip()]
    
    if not files:
        print_color("No changes to commit.", "CYAN")
        sys.exit(0)
        
    print_color(f"\nStaged files ({len(files)}):", "YELLOW")
    for f in files:
        print_color(f"  {f}", "RESET")
        
    return files

def get_fallback_commit_message(files, diff):
    """Generate a basic commit message when Copilot is unavailable."""
    print_color("Using smart fallback generation...", "YELLOW")
    
    types = {
        "test": [r"\.(test|spec)\.(ts|js|py)$"],
        "docs": [r"\.(md|txt|rst)$"],
        "build": [r"package\.json", r"package-lock\.json", r"requirements\.txt"],
        "style": [r"\.(css|scss|less)$"],
        "feat": [r"\.(ts|js|py|java|cs|cpp|c|go|rs)$"]
    }
    
    commit_type = "chore"
    
    # Simple heuristic
    for t, patterns in types.items():
        for f in files:
            for p in patterns:
                if re.search(p, f, re.IGNORECASE):
                    commit_type = t
                    break
            if commit_type != "chore":
                break
        if commit_type != "chore":
            break
            
    summary = f"update {len(files)} files"
    if len(files) == 1:
        summary = f"update {files[0]}"
        
    msg = f"{commit_type}: {summary}\n\nModified files:\n" + "\n".join([f"- {f}" for f in files])
    msg += "\n\nAuto-generated commit message (Copilot CLI unavailable)"
    return msg

def get_copilot_commit_message(diff, files, max_diff_size=5000):
    """Generate commit message using GitHub Copilot CLI."""
    print_color("\nGenerating commit message with GitHub Copilot CLI...", "YELLOW")
    
    # Truncate diff if too large
    original_len = len(diff)
    if original_len > max_diff_size:
        diff = diff[:max_diff_size]
        last_hunk = diff.rfind("\n@@")
        if last_hunk > max_diff_size * 0.8:
            diff = diff[:last_hunk]
        print_color(f"Diff truncated from {original_len} to {len(diff)} chars", "DIM")

    # Read instructions
    instructions = ""
    if os.path.exists("copilot-instructions.md"):
        try:
            with open("copilot-instructions.md", "r", encoding='utf-8') as f:
                instructions = f.read()
            print_color("Using copilot-instructions.md for context", "DIM")
        except:
            pass
            
    # File summary stats
    file_summary = []
    for f in files:
        res = run_command(f"git diff --cached --numstat -- \"{f}\"")
        if res.stdout.strip():
            parts = res.stdout.strip().split("\t")
            if len(parts) >= 2:
                file_summary.append(f"- {f} (+{parts[0]}/-{parts[1]})")
            else:
                file_summary.append(f"- {f}")
        else:
            file_summary.append(f"- {f}")
    
    file_summary_text = "\n".join(file_summary)
    
    prompt = f"""Write a git commit message for ODP+ following Conventional Commits specification.

GUIDELINES FROM copilot-instructions.md:
{instructions}

FILES CHANGED ({len(files)} files):
{file_summary_text}

GIT DIFF:
{diff}

REQUIREMENTS:
1. Header: <type>: <summary> (under 72 chars)
2. Body: Detailed explanation of WHAT changed and WHY.
3. Use bullet points in body for clarity.
4. BE DESCRIPTIVE: Do NOT just copy the header into the body.
5. TECHNICAL DETAILS: Explain technical changes, not just "updated files".
6. RELEASE NOTES STYLE: Write the body as if it were for a GitHub Release description.

IMPORTANT:
- Output ONLY the commit message (no markdown fences, no explanations)
- First line is header, blank line, then body
- If breaking changes, include 'BREAKING CHANGE:' section
"""
    
    try:
        print_color("Calling GitHub Copilot CLI...", "CYAN")
        
        # Write prompt to temp file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8') as f:
            f.write(prompt)
            prompt_file = f.name
            
        try:
            # Run copilot
            # In PowerShell: Get-Content prompt | copilot --allow-all-tools
            # In Python subprocess, we can pipe input
            print_color("Executing copilot...", "DIM")
            
            with open(prompt_file, 'r', encoding='utf-8') as pf:
                res = subprocess.run(
                    ["copilot", "--allow-all-tools"],
                    stdin=pf,
                    capture_output=True,
                    text=True,
                    shell=True
                )
            
            if res.returncode != 0:
                raise Exception(f"Copilot failed with code {res.returncode}: {res.stderr}")
                
            raw_output = res.stdout
            
            # Basic cleanup of markdown block
            cleaned = re.sub(r'^```.*?\n', '', raw_output, flags=re.MULTILINE)
            cleaned = re.sub(r'\n```$', '', cleaned)
            cleaned = cleaned.replace('```', '').strip()
            
            # Copilot CLI normally outputs stats at the end or as separate messages
            # We'll just take the cleaned output.
            
            if not cleaned or len(cleaned) < 10:
                raise Exception(f"Invalid output: {cleaned}")
                
            print_color(f"\n[OK] Commit message generated ({len(cleaned)} chars)", "GREEN")
            return cleaned
            
        finally:
            if os.path.exists(prompt_file):
                os.remove(prompt_file)
                
    except Exception as e:
        print_color(f"\nGitHub Copilot generation failed: {e}", "RED")
        return get_fallback_commit_message(files, diff)

def invoke_commit(message):
    """Commit changes."""
    # Write message to temp file to handle quotes/newlines safely
    with tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8') as f:
        f.write(message)
        msg_file = f.name
        
    try:
        res = run_command(f"git commit -F \"{msg_file}\"")
        if res.returncode != 0:
            print_color("Commit failed!", "RED")
            print(res.stderr)
            sys.exit(1)
        print_color("[OK] Changes committed", "GREEN")
    finally:
        if os.path.exists(msg_file):
            os.remove(msg_file)

def invoke_push(branch, dry_run=False):
    """Push changes."""
    if dry_run:
        print_color(f"[DRY RUN] Would push to origin/{branch}", "CYAN")
        return

    print_color(f"\nPushing to origin/{branch}...", "YELLOW")
    res = run_command("git push")
    if res.returncode != 0:
        print_color("Push failed! Commit saved locally.", "RED")
        sys.exit(1)
    
    print_color("[OK] Changes pushed", "GREEN")

def wait_for_release(branch, max_wait_time, dry_run=False):
    """Wait for semantic-release-bot."""
    if dry_run:
        return

    if not os.path.exists(".releaserc.json"):
        print_color("Skipping wait (no .releaserc.json)", "DIM")
        return

    print_color("\nWaiting for semantic-release-bot...", "YELLOW")
    print_color("Checking for automated release commit...", "DIM")
    
    start_time = time.time()
    last_commit_hash = run_command("git rev-parse HEAD").stdout.strip()
    
    poll_interval = 5
    
    while (time.time() - start_time) < max_wait_time:
        time.sleep(poll_interval)
        
        # Fetch tags specifically to ensure latest version is visible
        run_command("git fetch --tags origin")
        run_command(f"git fetch origin {branch}")
        
        remote_commit = run_command(f"git rev-parse origin/{branch}").stdout.strip()
        
        if remote_commit != last_commit_hash:
            # Check author/message
            author = run_command(f"git log -1 --format=\"%an\" origin/{branch}").stdout.strip()
            msg = run_command(f"git log -1 --format=\"%s\" origin/{branch}").stdout.strip()
            
            if "semantic-release-bot" in author or re.match(r"^(chore\(release\)|Release)", msg):
                print_color("\n[OK] Semantic release detected!", "GREEN")
                print_color(f"  Author: {author}", "DIM")
                
                print_color("\nPulling release commit...", "YELLOW")
                res = run_command(f"git pull --rebase origin {branch}")
                
                if res.returncode == 0:
                    # Get the absolute newest tag by date
                    tag_res = run_command("git describe --tags $(git rev-list --tags --max-count=1)")
                    tag = tag_res.stdout.strip()
                    print_color(f"[OK] Release commit pulled. New version: {tag}", "GREEN")
                    return
                else:
                    print_color("Warning: Failed to pull release commit", "YELLOW")
                    return
            else:
                print_color("\nNew commit detected but not from release bot", "YELLOW")
                last_commit_hash = remote_commit
        
        # Simple progress
        sys.stdout.write(".")
        sys.stdout.flush()
        
    print_color(f"\nTimeout waiting for release ({max_wait_time}s)", "YELLOW")

def main():
    parser = argparse.ArgumentParser(description="ODP+ Auto Release Script")
    parser.add_argument("--custom-message", "-m", help="Custom commit message")
    parser.add_argument("--skip-format", action="store_true", help="Skip format step")
    parser.add_argument("--dry-run", action="store_true", help="Preview but do not commit/push")
    parser.add_argument("--max-diff-size", type=int, default=5000, help="Max diff size for Copilot")
    parser.add_argument("--wait", dest="wait_for_release", action="store_true", default=True, help="Wait for release (default)")
    parser.add_argument("--no-wait", dest="wait_for_release", action="store_false", help="Do not wait for release")
    parser.add_argument("--timeout", type=int, default=120, help="Wait timeout in seconds")
    
    args = parser.parse_args()
    
    print_color("\n=== ODP+ Auto Release (Python) ===", "CYAN")
    
    check_git_repo()
    current_branch = get_current_branch()
    print_color(f"Current branch: {current_branch}", "CYAN")
    
    use_copilot = False
    if not args.custom_message:
        use_copilot = check_copilot_cli()
        
    # Check status
    res = run_command("git status --porcelain")
    has_changes = bool(res.stdout.strip())
    
    # Operations
    invoke_safe_pull(has_changes)
    invoke_code_format(args.skip_format)
    staged_files = get_staged_files()
    
    commit_message = ""
    
    if args.custom_message:
        commit_message = args.custom_message
        print_color("\nUsing custom commit message:", "YELLOW")
        print(f"--------------------------------------------------\n{commit_message}\n--------------------------------------------------")
    else:
        # Generate
        print_color(f"\nPreparing diff for analysis...", "DIM")
        res = run_command("git diff --cached") # diff of staged files
        diff = res.stdout
        
        if use_copilot:
            commit_message = get_copilot_commit_message(diff, staged_files, args.max_diff_size)
        else:
            commit_message = get_fallback_commit_message(staged_files, diff)
            
        print_color("\n╔════════════════════════════════════════════════════════════════════╗", "GREEN")
        print_color("║                    Generated Commit Message                        ║", "GREEN")
        print_color("╚════════════════════════════════════════════════════════════════════╝", "GREEN")
        print(commit_message)
        print_color("──────────────────────────────────────────────────────────────────────", "DIM")
        
        # User Confirmation
        if not args.dry_run:
            print_color("\nOptions:", "CYAN")
            print("  [Enter]  Use this message")
            print("  e        Edit message")
            print("  r        Regenerate with Copilot")
            print("  Ctrl+C   Abort")
            
            choice = input("\nChoice: ").strip().lower()
            
            if choice == 'e':
                print_color("\nEnter your custom commit message (press Enter twice to finish):", "YELLOW")
                lines = []
                empty_lines = 0
                while empty_lines < 2:
                    line = input()
                    if not line.strip():
                        empty_lines += 1
                    else:
                        empty_lines = 0
                        lines.append(line)
                
                if lines:
                    commit_message = "\n".join(lines)
            elif choice == 'r':
                 if use_copilot:
                    commit_message = get_copilot_commit_message(diff, staged_files, args.max_diff_size)
                    print(f"\n{commit_message}")
                 else:
                     print_color("Cannot regenerate: Copilot not available", "RED")

    # Commit
    if args.dry_run:
        print_color("\n[DRY RUN] Would commit with message:", "CYAN")
        print(commit_message)
    else:
        invoke_commit(commit_message)
        
    # Push
    invoke_push(current_branch, args.dry_run)
    
    # Wait
    if args.wait_for_release:
        wait_for_release(current_branch, args.timeout, args.dry_run)
        
    print_color("\nDone!", "GREEN")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print_color("\nAborted by user.", "RED")
        sys.exit(1)
