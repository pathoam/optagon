# Agent Onboarding Prompt

> Copy and paste this into your agent session to orient it to the Optagon environment.

---

## Quick Onboarding (Copy This)

```
You are working inside an Optagon development frame - an isolated Ubuntu container with pre-installed development tools.

IMPORTANT - Before doing anything:
1. Run `frame-context` to see all available tools and environment details
2. Run `ls -la /workspace` to see the project structure
3. Note: Only files in /workspace persist. Everything else is ephemeral.

Key tools available:
- Node.js 22, Bun, Python 3
- ripgrep (rg) for fast code search
- Playwright for browser screenshots
- opencode/claude for nested AI assistance

You're inside tmux. Use Ctrl+b then c/n/p/d for window management.

Now, please run frame-context and explore the workspace before we begin.
```

---

## Full Onboarding (For Complex Tasks)

```
# ENVIRONMENT CONTEXT

You are an AI coding agent operating inside an Optagon frame - a containerized development environment designed for AI-assisted software development.

## Your Environment

- **OS**: Ubuntu 24.04 (container)
- **Shell**: zsh inside tmux
- **Working directory**: /workspace (mounted from host, this persists)
- **Non-persistent areas**: Everything outside /workspace is lost on restart

## Pre-installed Tools

Languages: Node.js 22, Bun, Python 3, npm, pnpm, pip3
Search: ripgrep (rg), fd (use these instead of grep/find)
Browser: Playwright + Chromium for visual verification
AI: opencode, claude CLI
Utils: git, jq, curl, wget, htop

## Critical Rules

1. ALWAYS work in /workspace - files elsewhere don't persist
2. Use `rg` for searching (faster, auto-ignores node_modules)
3. Use `fd` for finding files (faster than find)
4. Verify UI changes with browser_screenshot() when applicable
5. Check what's installed before trying to install (`which <tool>`)

## First Actions Required

Before starting any task, execute these commands and share the output:

```bash
frame-context                    # Full environment guide
ls -la /workspace                # Project structure
cat /workspace/package.json 2>/dev/null || cat /workspace/requirements.txt 2>/dev/null || echo "Check project type"
```

## tmux Window Management

You're in a tmux session. Key bindings (prefix: Ctrl+b):
- Ctrl+b c = New window
- Ctrl+b n/p = Next/previous window
- Ctrl+b 0-9 = Go to window number
- Ctrl+b d = Detach (leaves container running)

## Browser Automation

If you need to see rendered web pages:
1. Start dev server: `npm run dev` (or equivalent)
2. Navigate: `browser_navigate("http://localhost:3000")`
3. Screenshot: `browser_screenshot()`

Now run the first actions above and tell me what you see.
```

---

## Task-Specific Onboarding

### For Web Development Tasks

```
You're in an Optagon frame for web development.

Environment: Ubuntu container with Node.js 22, Bun, and Playwright.
Project location: /workspace

First, explore the project:
1. Run `frame-context` for full tool list
2. Run `ls /workspace && cat /workspace/package.json`
3. Tell me what framework/stack this uses

For UI work, you can verify changes visually:
- Start dev server in one tmux window (Ctrl+b c, then npm run dev)
- Use browser_screenshot() to see the result

What would you like to work on?
```

### For Bug Fixing Tasks

```
You're in an Optagon frame debugging an issue.

Environment setup:
- Run `frame-context` for available tools
- Run `ls /workspace` to see project structure
- Use `rg "pattern"` to search code (faster than grep)

Bug details:
[DESCRIBE THE BUG HERE]

Your approach should be:
1. Reproduce the issue
2. Search codebase for relevant code
3. Identify root cause
4. Implement fix
5. Verify fix works

Start by exploring the codebase related to this bug.
```

### For Greenfield Projects

```
You're in an Optagon frame starting a new project.

Environment: Ubuntu with Node.js 22, Bun, Python 3, and common tools.
Working directory: /workspace (empty or has starter files)

Run `frame-context` to see all available tools.

Project requirements:
[DESCRIBE WHAT TO BUILD]

Suggested approach:
1. Choose appropriate framework/tools from what's available
2. Initialize project structure in /workspace
3. Build incrementally, testing as you go
4. Use browser_screenshot() to verify UI if applicable

What stack do you recommend for this project?
```

---

## Minimal Reminder (For Returning to a Session)

```
You're in an Optagon frame. Quick reminder:
- Project is in /workspace
- Run `frame-context` if you need environment details
- Use rg/fd for searching
- Ctrl+b d to detach from tmux

What shall we work on?
```

---

## Troubleshooting Prompt

```
If something isn't working, run these diagnostics:

# Check current location
pwd

# Check what's available
which node bun python3 rg fd git

# Check environment
echo $OPTAGON_FRAME_NAME
echo $OPENROUTER_API_KEY | head -c 10

# Check project
ls -la /workspace

# Check running processes
ps aux | head -20

# Check ports
ss -tlnp

Share the output and describe what's not working.
```
