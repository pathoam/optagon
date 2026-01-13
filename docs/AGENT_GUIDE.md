# Optagon Agent Guide

> How to effectively operate AI coding agents within Optagon frames

---

## Understanding the Environment

When an AI agent (OpenCode, Claude Code, etc.) starts inside an Optagon frame, it needs to understand:

1. **Where it is** - A containerized Ubuntu environment
2. **What it has access to** - Tools, languages, browser automation
3. **Where files persist** - Only `/workspace` survives container restarts
4. **How to see its work** - Browser MCP for visual feedback

---

## Agent Onboarding Flow

When starting a new agent session, use this sequence:

### Step 1: Orient the Agent

Paste this prompt or have the agent run `frame-context`:

```
You are working inside an Optagon development frame - an isolated containerized environment.

Before starting any work:
1. Run `frame-context` to see available tools and environment details
2. Run `ls -la /workspace` to see the project structure
3. Run `pwd` to confirm you're in /workspace

Key facts:
- Your project files are in /workspace (this persists)
- You have Node.js 22, Bun, Python 3 available
- You can use Playwright for browser screenshots
- Your API keys are pre-configured as environment variables
```

### Step 2: Project Discovery

Have the agent explore the workspace:

```
Explore this project:
1. Check for package.json, requirements.txt, Cargo.toml, etc.
2. Look for README.md or documentation
3. Identify the tech stack and entry points
4. Note any existing tests or build scripts
```

### Step 3: Task Assignment

Now give the actual task with context:

```
Task: [Your specific task]

Context:
- This is a [Next.js/Python/etc.] project
- The main entry point is [file]
- We're working on [feature/bug/etc.]

Constraints:
- Only modify files in /workspace
- Run tests before considering work complete
- Use the browser MCP if you need to see rendered output
```

---

## Agent Capabilities Matrix

| Capability | How to Use | Notes |
|------------|------------|-------|
| **Read/write files** | Standard file operations | Only `/workspace` persists |
| **Run shell commands** | bash/zsh | Full Linux environment |
| **Node.js development** | `node`, `npm`, `bun` | v22 LTS installed |
| **Python development** | `python3`, `pip3` | System Python 3 |
| **Git operations** | `git` | Full git available |
| **Search code** | `rg` (ripgrep) | Faster than grep |
| **Find files** | `fd` | Faster than find |
| **Browser preview** | browser-mcp tools | See "Visual Feedback" below |
| **Package management** | npm, pnpm, bun, pip | All available |

---

## Visual Feedback with Browser MCP

Agents can see rendered web pages using the browser-mcp server:

### Starting a Dev Server

```bash
# In one tmux window, start the server
npm run dev
# or
bun run dev
# or
python -m http.server 3000
```

### Taking Screenshots

The agent can use browser MCP tools:

```
1. Navigate to the page:
   browser_navigate("http://localhost:3000")

2. Take a screenshot:
   browser_screenshot()

3. Interact with elements:
   browser_click("#submit-button")
   browser_type("#email-input", "test@example.com")

4. Check content:
   browser_get_content("#result-div")
```

### Accessing from Host

The dev server is accessible from your host machine:

```
Container port 3000 → Host port <assigned>
Check with: optagon frame show <name>
Browse to: http://localhost:<host-port>
```

---

## tmux Window Management

Agents should understand they're in tmux:

### Recommended Window Layout

```
Window 0: Shell (main work)
Window 1: Dev server (npm run dev)
Window 2: Agent (opencode/claude)
Window 3: Tests (npm test --watch)
```

### Creating Windows

```bash
# Create new window
tmux new-window -n "dev-server"

# Run command in new window
tmux new-window -n "tests" "npm test --watch"
```

### Switching Context

```
Ctrl+b 0  → Go to shell
Ctrl+b 1  → Go to dev server
Ctrl+b 2  → Go to agent
```

---

## Common Agent Mistakes

### 1. Writing Files Outside /workspace

**Wrong:**
```bash
# Files here are lost on restart
echo "data" > /tmp/myfile.txt
```

**Right:**
```bash
# Files here persist
echo "data" > /workspace/myfile.txt
```

### 2. Not Checking Environment First

**Wrong:**
```
Let me install Node.js first...
```

**Right:**
```
Let me check what's available:
$ node --version  # v22.x.x
$ which bun       # /root/.bun/bin/bun
```

### 3. Ignoring Browser Preview

**Wrong:**
```
The CSS should be correct, I'll assume it looks right.
```

**Right:**
```
Let me verify the visual output:
$ browser_navigate("http://localhost:3000")
$ browser_screenshot()
# [Views actual rendered page]
```

### 4. Not Using Available Tools

**Wrong:**
```bash
grep -r "function" . | grep -v node_modules
```

**Right:**
```bash
rg "function" --type js  # Much faster, auto-ignores node_modules
```

---

## Agent Session Templates

### Template 1: New Feature Development

```
# Session Start Prompt

You're in an Optagon frame working on [PROJECT_NAME].

Environment check:
1. Run `frame-context` for capabilities
2. Run `ls /workspace` to see project

Your task: Implement [FEATURE]

Requirements:
- [Requirement 1]
- [Requirement 2]

When done:
- Run existing tests
- Use browser_screenshot to verify UI (if applicable)
- Summarize changes made
```

### Template 2: Bug Fix

```
# Bug Fix Session

Project: [PROJECT_NAME]
Bug: [DESCRIPTION]
Reproduction: [STEPS]

Your approach:
1. First, reproduce the bug
2. Identify root cause
3. Implement fix
4. Verify fix works
5. Check for regressions

Available tools:
- Full dev environment (run `frame-context`)
- Browser preview for visual bugs
- Git for checking history
```

### Template 3: Code Review / Refactor

```
# Refactoring Session

Target: [FILE or MODULE]
Goal: [IMPROVEMENT]

Constraints:
- Maintain existing behavior
- Don't break tests
- Keep changes focused

Process:
1. Read and understand current code
2. Identify improvement opportunities
3. Make incremental changes
4. Test after each change
```

---

## Environment Variables Available

| Variable | Purpose |
|----------|---------|
| `OPTAGON_FRAME_ID` | Unique frame identifier |
| `OPTAGON_FRAME_NAME` | Human-readable frame name |
| `OPENROUTER_API_KEY` | OpenRouter API access |
| `ANTHROPIC_API_KEY` | Anthropic API access |
| `OPENAI_API_KEY` | OpenAI API access |

---

## Troubleshooting for Agents

### "Command not found"

Check what's available:
```bash
which node bun python3 git rg
```

### "Permission denied"

Usually means trying to write outside /workspace:
```bash
pwd  # Should be /workspace
```

### "Port already in use"

Another process using the port:
```bash
lsof -i :3000
kill <PID>
```

### "Can't see browser output"

Start the browser MCP or use screenshot tools:
```bash
cd /opt/browser-mcp
bun run src/index.ts  # Start MCP server
```

---

## Best Practices Summary

1. **Always orient first** - Run `frame-context`, check project structure
2. **Use the right tools** - ripgrep > grep, fd > find
3. **Verify visually** - Use browser screenshots for UI work
4. **Stay in /workspace** - Everything else is ephemeral
5. **Leverage tmux** - Multiple windows for different tasks
6. **Check your work** - Run tests, verify output
7. **Summarize changes** - Help the human understand what was done
