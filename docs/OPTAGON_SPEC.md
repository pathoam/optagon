# Optagon Development Server - Technical Specification

> Version: 0.1.0 (Phase 1 Complete)
> Last Updated: January 2026

## Overview

Optagon is a personal software development server that manages isolated development environments called **frames**. Each frame is a containerized workspace with:

- Isolated container (Podman)
- Terminal multiplexing (tmux)
- AI coding agents (OpenCode, Claude Code)
- Browser automation (Playwright)
- Persistent workspace (mounted from host)

The system is designed to run multiple concurrent development projects with AI assistance, where each frame maintains its own context and state.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HOST SYSTEM                                  │
│                                                                      │
│  ┌─────────────────┐     ┌─────────────────────────────────────┐   │
│  │  Optagon CLI    │     │  ~/.optagon/                        │   │
│  │  (bun/ts)       │     │  ├── data/optagon.db  (SQLite)     │   │
│  │                 │     │  ├── config.json      (API keys)    │   │
│  │  Commands:      │     │  └── frames/<id>/     (tmux socks)  │   │
│  │  - init         │     └─────────────────────────────────────┘   │
│  │  - start        │                                                │
│  │  - stop         │                                                │
│  │  - attach       │                                                │
│  │  - build        │                                                │
│  └────────┬────────┘                                                │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    PODMAN CONTAINERS                         │   │
│  │                                                               │   │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │   │
│  │  │ Frame: proj-a   │  │ Frame: proj-b   │  ...              │   │
│  │  │                 │  │                 │                    │   │
│  │  │ /workspace ◄────┼──┼─► ~/proj-a      │ (bind mount)      │   │
│  │  │ Port 33000 ◄────┼──┼─► :3000         │ (port mapping)    │   │
│  │  │                 │  │                 │                    │   │
│  │  │ tmux session    │  │ tmux session    │                   │   │
│  │  │ └─ window 0     │  │ └─ window 0     │                   │   │
│  │  │    └─ shell     │  │    └─ opencode  │                   │   │
│  │  └─────────────────┘  └─────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. CLI (`optagon`)

**Location:** `/home/pta/optagon/optagon-server/src/index.ts`

| Command | Description |
|---------|-------------|
| `optagon init [name]` | Create frame for current directory |
| `optagon start [name]` | Start frame and attach to tmux |
| `optagon stop [name]` | Stop running frame |
| `optagon attach [name]` | Attach to running frame's tmux |
| `optagon list` | List all frames with status |
| `optagon status` | Show system overview |
| `optagon build [--no-cache]` | Build frame container image |
| `optagon config set <key> <val>` | Set global config (API keys) |
| `optagon config get <key>` | Get config value |
| `optagon config list` | List all config |
| `optagon frame create <n> -w <path>` | Create frame (explicit) |
| `optagon frame destroy <name> [-f]` | Destroy frame |
| `optagon frame show <name>` | Show frame details |
| `optagon frame events <name>` | Show frame event log |

**Auto-detection:** When `name` is omitted, CLI checks if current directory is a frame workspace.

### 2. State Store (SQLite)

**Location:** `~/.optagon/data/optagon.db`

**Schema:**
```sql
-- Core frame metadata
CREATE TABLE frames (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT UNIQUE NOT NULL,        -- User-friendly name
    description TEXT,
    status TEXT NOT NULL,             -- created|starting|running|stopping|stopped|error
    workspace_path TEXT NOT NULL,     -- Host path to project
    container_id TEXT,                -- Podman container ID
    tmux_socket TEXT,                 -- Path to tmux socket
    graphiti_group_id TEXT NOT NULL,  -- For future Graphiti integration
    host_port INTEGER,                -- Mapped port (33000-34000)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_active_at INTEGER
);

-- Frame configuration (JSON blob)
CREATE TABLE frame_configs (
    frame_id TEXT PRIMARY KEY REFERENCES frames(id),
    config_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Event log for debugging/audit
CREATE TABLE frame_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id TEXT REFERENCES frames(id),
    event_type TEXT NOT NULL,         -- created|started|stopped|error|destroyed
    details_json TEXT,
    created_at INTEGER NOT NULL
);
```

### 3. Config Manager

**Location:** `~/.optagon/config.json`

```json
{
  "openrouter_api_key": "sk-or-v1-...",
  "anthropic_api_key": "sk-ant-...",
  "openai_api_key": "sk-..."
}
```

API keys are automatically injected as environment variables when containers start.

### 4. Container Runtime

**Supported:** Podman (preferred), Docker (fallback)

**Container naming:** `optagon-frame-<name>`

**Port allocation:** Auto-assigned from range 33000-34000

**Mounts:**
- `<workspace>` → `/workspace` (project files)
- `~/.optagon/frames/<id>/` → `/run/optagon/` (tmux socket)

### 5. Frame Container Image

**Image:** `optagon/frame:latest`

**Base:** Ubuntu 24.04

**Contents:**
| Category | Tools |
|----------|-------|
| Shell | tmux, zsh |
| Node.js | Node 22, npm, pnpm, Bun |
| Python | Python 3, pip3 |
| AI Agents | Claude Code CLI, OpenCode |
| Browser | Playwright, Chromium (headless) |
| MCP | browser-mcp server |
| Utils | git, ripgrep, fd, jq, htop |

**Key paths inside container:**
```
/workspace              # Project files (mounted)
/opt/optagon/           # Optagon resources
  └── AGENT_CONTEXT.md  # Environment guide for agents
/opt/browser-mcp/       # Playwright MCP server
/run/optagon/tmux.sock  # tmux socket (mounted)
```

**Commands available:**
- `frame-context` - Print agent environment guide
- `opencode` - Start OpenCode agent
- `claude` - Start Claude Code agent

### 6. Browser MCP Server

**Location:** `/opt/browser-mcp/`

**Purpose:** Allows AI agents to see rendered web pages, take screenshots, interact with UI.

**Tools exposed:**
| Tool | Description |
|------|-------------|
| `browser_navigate` | Go to URL |
| `browser_screenshot` | Capture PNG (base64) |
| `browser_click` | Click element by selector |
| `browser_type` | Type into input field |
| `browser_scroll` | Scroll page |
| `browser_evaluate` | Execute JavaScript |
| `browser_get_content` | Get text/HTML content |
| `browser_wait` | Wait for element |
| `browser_close` | Close browser |

**Usage:** Agent connects via MCP protocol (stdio transport).

---

## Data Flow

### Frame Lifecycle

```
┌─────────┐     ┌──────────┐     ┌─────────┐     ┌─────────┐
│ created │ ──► │ starting │ ──► │ running │ ──► │ stopped │
└─────────┘     └──────────┘     └─────────┘     └─────────┘
     │                                │               │
     │                                ▼               │
     │                          ┌─────────┐          │
     └─────────────────────────►│  error  │◄─────────┘
                                └─────────┘
```

1. **Create** (`optagon init`):
   - Validate workspace exists
   - Generate UUID and graphiti_group_id
   - Allocate port from pool
   - Create DB entry (status: created)
   - Create frame directory for tmux socket

2. **Start** (`optagon start`):
   - Load config, get API keys
   - Run `podman run` with mounts and env vars
   - Container starts tmux server
   - Update DB (status: running, container_id)
   - Attach to tmux session

3. **Stop** (`optagon stop`):
   - Run `podman stop`
   - Update DB (status: stopped)
   - Container preserved for restart

4. **Destroy** (`optagon frame destroy`):
   - Run `podman rm`
   - Delete DB entry
   - Release port to pool

### Environment Variable Injection

```
~/.optagon/config.json          Container Environment
┌─────────────────────┐         ┌─────────────────────┐
│ openrouter_api_key  │ ──────► │ OPENROUTER_API_KEY  │
│ anthropic_api_key   │ ──────► │ ANTHROPIC_API_KEY   │
│ openai_api_key      │ ──────► │ OPENAI_API_KEY      │
└─────────────────────┘         │ OPTAGON_FRAME_ID    │
                                │ OPTAGON_FRAME_NAME  │
                                └─────────────────────┘
```

---

## File Locations

### Host System
```
~/.optagon/
├── data/
│   └── optagon.db           # SQLite database
├── config.json              # Global config (API keys)
├── frames/
│   └── <frame-id>/
│       └── tmux.sock        # tmux socket for attach
└── logs/                    # Future: frame logs
```

### Project (optagon-server)
```
/home/pta/optagon/optagon-server/
├── src/
│   ├── index.ts             # CLI entry point
│   ├── types/index.ts       # TypeScript types
│   └── services/
│       ├── state-store.ts   # SQLite operations
│       ├── port-allocator.ts
│       ├── container-runtime.ts
│       ├── frame-manager.ts
│       └── config-manager.ts
├── frame-image/
│   ├── browser-mcp/         # Playwright MCP server
│   └── AGENT_CONTEXT.md     # Agent environment guide
├── Dockerfile.frame         # Container image definition
├── tests/                   # Unit + integration tests
└── package.json
```

---

## Security Considerations

1. **API Keys**: Stored in `~/.optagon/config.json` (user-readable only)
2. **Container Isolation**: Podman rootless mode
3. **Network**: Ports bound to 127.0.0.1 only (localhost)
4. **Workspace Mount**: Uses `:Z` SELinux label for proper permissions

---

## Current Limitations

1. **No Graphiti integration** - group_id stored but not used
2. **No manager agent** - No LLM orchestration layer yet
3. **Single image flavor** - No stack-specific images
4. **No remote access** - Local only, no web UI
5. **No auto-context injection** - Agents must manually read context

---

## Future Work (Phases 2-5)

| Phase | Focus | Key Features |
|-------|-------|--------------|
| 2 | Graphiti | Context persistence, episode ingestion, history queries |
| 3 | Manager Agent | LLM orchestrator, task decomposition, quality gates |
| 4 | Guake Integration | D-Bus hooks, TUI dashboard |
| 5 | Remote Access | Web terminal, mobile access, JWT auth |

---

## Appendix: Quick Reference

### Common Workflows

**New project:**
```bash
cd ~/my-project
optagon init
optagon start
# Now in tmux, run: opencode
```

**Resume work:**
```bash
cd ~/my-project
optagon start    # or: optagon attach (if already running)
```

**Check status:**
```bash
optagon list
optagon status
```

**Rebuild after changes:**
```bash
optagon build
optagon stop myproject
optagon frame destroy myproject --force
optagon init
optagon start
```

### tmux Cheatsheet

| Keys | Action |
|------|--------|
| `Ctrl+b c` | New window |
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b 0-9` | Go to window N |
| `Ctrl+b d` | Detach |
| `Ctrl+b x` | Kill pane |
| `Ctrl+b &` | Kill window |
