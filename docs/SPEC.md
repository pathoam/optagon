# Optagon Development Server - Specification

## Vision
A personal software development server that manages multiple isolated development environments ("frames"), each with its own:
- Containerized workspace (Podman)
- Terminal access via tmux (for agents)
- Graphiti context store (per-frame knowledge graph)
- Manager agent (LLM orchestrator for Claude Code/OpenCode instances)

User interacts via Guake (their daily terminal) which can attach to frame tmux sessions or run a TUI dashboard.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                               │
│   Guake (guake-opt) - User's daily terminal                         │
│   - Tab per frame: `tmux attach -t frame-xyz`                       │
│   - Dashboard tab: TUI control center (future)                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────┐
│                      OPTAGON SERVER (new)                            │
│   - Frame lifecycle management                                       │
│   - Container orchestration (Podman)                                 │
│   - Graphiti client                                                  │
│   - REST API + WebSocket for UI                                      │
│   - CLI: `optagon frame create/start/stop/list/attach`              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────┐
│                         FRAME POOL                                   │
│  ┌──────────────────────┐  ┌──────────────────────┐                 │
│  │  Frame: project-a    │  │  Frame: project-b    │  ...            │
│  │  ┌────────────────┐  │  │  ┌────────────────┐  │                 │
│  │  │ Podman Container│  │  │  │ Podman Container│  │                │
│  │  │  - tmux server  │  │  │  │  - tmux server  │  │                │
│  │  │  - Claude Code  │  │  │  │  - Claude Code  │  │                │
│  │  │  - Manager Agent│  │  │  │  - Manager Agent│  │                │
│  │  │  - /workspace   │  │  │  │  - /workspace   │  │                │
│  │  └────────────────┘  │  │  └────────────────┘  │                 │
│  │  Graphiti: group-a   │  │  Graphiti: group-b   │                 │
│  └──────────────────────┘  └──────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE                             │
│   - Graphiti (FalkorDB) - single instance, namespaced by group_id   │
│   - MCP servers (graphiti-mcp, context-feed)                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Frame Lifecycle (MVP)

### Goal
Create, start, stop, and attach to containerized frames with tmux inside.

### Deliverables

1. **New project: `optagon-server/`**
   - TypeScript + Bun runtime
   - Hono for HTTP API
   - SQLite for frame metadata

2. **CLI commands**
   ```bash
   optagon frame create <name> --workspace /path/to/project
   optagon frame start <name>
   optagon frame stop <name>
   optagon frame list
   optagon frame attach <name>   # prints: tmux attach -t frame-<id>
   optagon frame destroy <name>
   ```

3. **Container setup**
   - Base image: `optagon/frame:latest` (Dockerfile)
   - Contains: tmux, zsh, Claude Code CLI, Python, Node.js
   - Playwright + Chromium for browser vision
   - Browser MCP server for agent visual feedback
   - Mounts workspace directory from host
   - Exposes tmux socket for external attach
   - Auto-assigned host port (33000-34000) mapped to container:3000

4. **Frame data model**
   ```typescript
   interface Frame {
     id: string;
     name: string;
     status: 'created' | 'running' | 'stopped';
     workspacePath: string;
     containerId?: string;
     tmuxSocket?: string;
     graphitiGroupId: string;
     createdAt: Date;
   }
   ```

### Key Files to Create

| Path | Purpose |
|------|---------|
| `optagon-server/package.json` | Bun/npm project config |
| `optagon-server/src/index.ts` | CLI entry point |
| `optagon-server/src/daemon.ts` | Server daemon |
| `optagon-server/src/services/frame-manager.ts` | Frame lifecycle |
| `optagon-server/src/services/container-runtime.ts` | Podman integration |
| `optagon-server/src/services/state-store.ts` | SQLite persistence |
| `optagon-server/src/services/port-allocator.ts` | Auto-assign ports 33000-34000 |
| `optagon-server/Dockerfile.frame` | Frame container image |
| `optagon-server/frame-image/browser-mcp/` | Playwright MCP server for visual feedback |

### Implementation Steps

1. **Project scaffolding**
   - Initialize Bun project with TypeScript
   - Add dependencies: hono, better-sqlite3, commander
   - Set up build scripts

2. **State store**
   - SQLite database at `~/.optagon/data/optagon.db`
   - Full schema (frames, frame_configs, frame_events, access_tokens, sessions, system_config)
   - CRUD operations for frames

3. **Port allocator**
   - Track used ports in frames table
   - Allocate next available in 33000-34000 range
   - Release port when frame destroyed

4. **Container runtime**
   - Wrapper around `podman` CLI (spawn child processes)
   - `createContainer(frame)` - podman run with mounts + port mapping
   - `startContainer(id)` - podman start
   - `stopContainer(id)` - podman stop
   - `removeContainer(id)` - podman rm

5. **Frame manager**
   - `createFrame(config)` - validate, allocate port, store in DB
   - `startFrame(id)` - create container, start tmux
   - `stopFrame(id)` - stop container, preserve state
   - `destroyFrame(id)` - remove container, release port, delete from DB

6. **tmux integration**
   - Container runs tmux server on startup
   - Socket exposed at `/tmp/optagon/frames/<id>/tmux.sock`
   - Host can attach: `tmux -S /tmp/optagon/frames/<id>/tmux.sock attach`

7. **Dockerfile.frame**
   - Base: Ubuntu or Alpine
   - Install: tmux, zsh, Node.js, Python, Claude Code CLI
   - Install: Playwright + Chromium (for browser vision)
   - Include: browser-mcp server
   - Entrypoint: start tmux server

8. **CLI**
   - Commander.js for argument parsing
   - Calls frame manager methods
   - Pretty output with status colors

---

## Phase 2: Graphiti Integration (Context Persistence)

### Goal
Each frame maintains persistent context in Graphiti. Agents can query past work, decisions, and relationships.

### How Graphiti Works
Graphiti is a temporal knowledge graph that:
- Ingests **episodes** (conversation turns, code changes, events)
- Extracts **entities** (files, functions, tasks, decisions)
- Creates **relationships** (edges) between entities
- Enables hybrid search (semantic + keyword + graph traversal)

### Per-Frame Namespacing
Each frame gets a unique `group_id` in Graphiti:
```
frame:abc123  → Project A's context
frame:def456  → Project B's context
shared:global → Cross-frame shared knowledge
```

### What Gets Stored
1. **Agent conversations** - Summaries of Claude Code sessions
2. **Code changes** - Commits, file modifications with rationale
3. **Decisions** - Architecture choices, trade-offs discussed
4. **Tasks** - What was requested, what was done
5. **Errors** - Bugs encountered, how they were fixed

### Context Injection Flow
```
Task assigned to agent
        ↓
Manager queries Graphiti: "What's relevant to this task?"
        ↓
Graphiti returns: related entities, past decisions, similar work
        ↓
Manager injects context into agent's system prompt
        ↓
Agent works with full historical awareness
```

### Integration Points

1. **Episode ingestion** - After each agent session, summarize and store
2. **Entity extraction** - LLM identifies entities from session content
3. **Query before task** - Fetch relevant context before assigning work
4. **Cross-frame queries** - Optional: search other frames for related work

### Key Files to Create

| Path | Purpose |
|------|---------|
| `optagon-server/src/services/graphiti-client.ts` | Graphiti API client |
| `optagon-server/src/services/context-curator.ts` | Query and rank relevant context |
| `optagon-server/src/services/episode-ingester.ts` | Store sessions to Graphiti |

### Configuration
```yaml
graphiti:
  provider: falkordb  # or neo4j
  host: localhost
  port: 6379

  # Per-frame settings
  frames:
    context_budget_tokens: 8000  # Max context injected per task
    auto_ingest: true            # Store sessions automatically
    cross_frame_search: false    # Allow searching other frames
```

---

## Phase 3: Manager Agent

### Goal
LLM-powered orchestrator that manages Claude Code instances within each frame.

### Responsibilities
1. **Task decomposition** - Break user requests into sub-tasks
2. **Agent spawning** - Launch Claude Code instances in tmux windows
3. **Quality gates** - Review outputs, request corrections
4. **Context curation** - Query Graphiti, inject relevant history
5. **Coordination** - Prevent conflicts between concurrent agents

### LLM Provider Abstraction
```typescript
interface LLMProvider {
  chat(messages: Message[]): Promise<string>;
  stream(messages: Message[]): AsyncIterable<string>;
  estimateTokens(text: string): number;
}

// Implementations
const providers = {
  anthropic: AnthropicProvider,  // Claude API
  openai: OpenAIProvider,        // GPT-4/5
  ollama: OllamaProvider,        // Local models
  vllm: VLLMProvider,            // High-throughput local
};
```

### Manager-Child Communication
Manager controls Claude Code via tmux:
```bash
# Send task to Claude Code in window 1
tmux send-keys -t frame-abc:1 "Implement the login form" Enter

# Read output
tmux capture-pane -t frame-abc:1 -p
```

### Frame Configuration
```yaml
name: project-a
workspace: /home/pta/projects/my-app

manager:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  temperature: 0.3

  behavior:
    auto_spawn_agents: true
    max_concurrent_agents: 3
    quality_gate_enabled: true

  # Cost optimization: use local models for simple tasks
  routing:
    - condition: "task.type == 'summarize'"
      provider: ollama
      model: mistral
    - condition: "task.complexity > 0.7"
      provider: anthropic
      model: claude-sonnet-4-5
    - condition: "default"
      provider: anthropic
      model: claude-3-5-haiku
```

### Key Files to Create

| Path | Purpose |
|------|---------|
| `optagon-server/src/agents/manager-agent.ts` | Manager orchestrator |
| `optagon-server/src/agents/llm-provider.ts` | LLM abstraction |
| `optagon-server/src/agents/claude-code-controller.ts` | Claude Code spawning |
| `optagon-server/src/agents/task-router.ts` | Route tasks to appropriate model |

---

## Phase 4: Guake Integration + TUI

### Goal
Seamless user experience from Guake terminal.

### Deliverables

1. **Guake-opt enhancements**
   - New D-Bus method: `open_frame(frame_name)` - creates tab attached to frame tmux
   - Keyboard shortcut: `Ctrl+Alt+F` to open frame picker

2. **TUI Dashboard**
   - Built with `textual` (Python) or similar
   - Shows all frames with status
   - Quick actions: start/stop/attach
   - Live log tailing

3. **MCP server for Guake**
   - Tool: `guake_open_frame` - open frame in Guake tab
   - Allows agents to request user attention

---

## Phase 5: Remote Access + Web UI

### Goal
Access frames from mobile/laptop via web browser.

### Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                    REMOTE CLIENT                                 │
│   Browser (mobile/laptop)                                       │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  xterm.js (WebGL terminal)                              │   │
│   │  - Full terminal emulation                              │   │
│   │  - Touch keyboard (mobile)                              │   │
│   │  - Copy/paste support                                   │   │
│   └─────────────────────────┬───────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────┘
                              │ WSS (TLS + JWT)
┌─────────────────────────────┴───────────────────────────────────┐
│                    OPTAGON SERVER                                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  WebSocket Gateway                                       │   │
│   │  - JWT validation                                        │   │
│   │  - Frame permission checks                               │   │
│   │  - Session multiplexing                                  │   │
│   └─────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│   ┌─────────────────────────┴───────────────────────────────┐   │
│   │  Terminal Proxy (node-pty)                               │   │
│   │  - Attaches to frame tmux sockets                        │   │
│   │  - Bidirectional I/O streaming                           │   │
│   │  - Resize handling                                       │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication
```typescript
interface AuthConfig {
  // Single-user mode (default)
  local: {
    password_hash: string;  // bcrypt
    require_otp?: boolean;  // TOTP support
  };

  // Multi-device tokens
  tokens: {
    name: string;           // "laptop", "phone"
    permissions: string[];  // ["read", "write", "manage"]
    expires_at?: Date;
  }[];

  // TLS
  tls: {
    enabled: true;
    auto_generate: true;    // Self-signed for local
    cert_path?: string;
    key_path?: string;
  };
}
```

### WebSocket Protocol
```typescript
// Client → Server
type ClientMessage =
  | { type: "auth"; token: string }
  | { type: "attach"; frameId: string; windowId?: string }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "detach" };

// Server → Client
type ServerMessage =
  | { type: "authenticated"; user: string }
  | { type: "attached"; frameId: string; windowId: string }
  | { type: "output"; data: string }
  | { type: "frame_event"; event: FrameEvent }
  | { type: "error"; code: string; message: string };
```

### Web Dashboard Features
1. **Frame list** - Status, port, last activity
2. **Terminal embed** - Click to open terminal in browser
3. **Quick actions** - Start/stop/restart frames
4. **Logs viewer** - Live-tail frame logs
5. **Resource monitor** - CPU/memory per frame
6. **Mobile-optimized** - Touch-friendly controls

### Key Files to Create

| Path | Purpose |
|------|---------|
| `optagon-server/src/web/websocket-gateway.ts` | WebSocket handling |
| `optagon-server/src/web/terminal-proxy.ts` | tmux attachment proxy |
| `optagon-server/src/web/auth.ts` | JWT + token auth |
| `optagon-web/` | React/Solid.js frontend |
| `optagon-web/src/components/Terminal.tsx` | xterm.js wrapper |
| `optagon-web/src/components/FrameList.tsx` | Frame dashboard |

### Accessing Remotely
```bash
# Local network access
https://192.168.1.100:8443

# Over internet (with Tailscale/Cloudflare Tunnel)
https://optagon.your-tailnet.ts.net
```

---

## Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Fast, TypeScript-native, good DX |
| HTTP | Hono | Lightweight, fast, good WebSocket support |
| Database | SQLite | Embedded, simple, sufficient for single-user |
| Containers | Podman | Rootless, daemonless, Docker-compatible |
| Terminal mux | tmux | Proven, scriptable, agent-friendly |
| LLM clients | Anthropic SDK, OpenAI SDK, Ollama | Cover all provider needs |
| Graph DB | Graphiti (FalkorDB) | Already integrated, temporal support |

---

## Directory Structure

```
/home/pta/optagon/
├── optagon-server/          # NEW - main server
│   ├── src/
│   │   ├── index.ts         # CLI entry
│   │   ├── daemon.ts        # Server process
│   │   ├── services/
│   │   │   ├── frame-manager.ts
│   │   │   ├── container-runtime.ts
│   │   │   ├── state-store.ts
│   │   │   └── graphiti-client.ts
│   │   └── agents/
│   │       ├── manager-agent.ts
│   │       └── llm-provider.ts
│   ├── Dockerfile.frame
│   └── package.json
├── guake-opt/               # EXISTING - enhanced Guake fork
├── graphiti/                # EXISTING - knowledge graph
└── optagon-core/            # EXISTING - keep for reference
```

---

## Database Schema (SQLite)

```sql
-- Core frame metadata
CREATE TABLE frames (
    id TEXT PRIMARY KEY,           -- UUID
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    status TEXT NOT NULL,          -- created|starting|running|paused|stopped|error
    workspace_path TEXT NOT NULL,
    container_id TEXT,
    tmux_socket TEXT,
    graphiti_group_id TEXT NOT NULL,
    host_port INTEGER,             -- Auto-assigned from 33000-34000 range
    created_at INTEGER NOT NULL,   -- Unix timestamp
    updated_at INTEGER NOT NULL,
    last_active_at INTEGER
);

-- Frame configuration (JSON blob for flexibility)
CREATE TABLE frame_configs (
    frame_id TEXT PRIMARY KEY REFERENCES frames(id),
    config_json TEXT NOT NULL,     -- Full config as JSON
    updated_at INTEGER NOT NULL
);

-- Frame lifecycle events (audit log)
CREATE TABLE frame_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id TEXT REFERENCES frames(id),
    event_type TEXT NOT NULL,      -- created|started|stopped|error|config_changed
    details_json TEXT,             -- Event-specific data
    created_at INTEGER NOT NULL
);

-- Access tokens for remote/API access
CREATE TABLE access_tokens (
    id TEXT PRIMARY KEY,
    name TEXT,                     -- e.g., "laptop", "mobile"
    token_hash TEXT NOT NULL,      -- bcrypt hash
    permissions_json TEXT,         -- Which frames, what access level
    last_used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
);

-- Active sessions (for WebSocket connections)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    token_id TEXT REFERENCES access_tokens(id),
    frame_id TEXT REFERENCES frames(id),
    client_info_json TEXT,         -- IP, user agent, etc.
    connected_at INTEGER NOT NULL,
    last_activity_at INTEGER
);

-- System configuration (key-value)
CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

---

## Port Mapping

Each frame auto-assigns a host port from range 33000-34000:
```
Frame 1: localhost:33000 → container:3000
Frame 2: localhost:33001 → container:3000
Frame 3: localhost:33002 → container:3000
```

User browses `localhost:33001` to see Frame 2's dev server.

---

## Browser Vision (Agent Visual Feedback)

Agents need to see what they're building. Solution: **Playwright MCP tool** inside each container.

**How it works:**
1. Container includes Playwright + Chromium (headless)
2. MCP server exposes browser tools
3. Agent calls `browser_screenshot("http://localhost:3000")`
4. Playwright renders page with real Chromium engine
5. Returns PNG screenshot to agent's context

**MCP Tools:**
```
browser_navigate(url) → Opens URL in headless Chromium
browser_screenshot() → Returns PNG of current page
browser_click(selector) → Clicks element
browser_type(selector, text) → Types into input
browser_scroll(direction, amount) → Scrolls page
browser_evaluate(js) → Runs JavaScript, returns result
```

**Rendering fidelity**: Same Chromium engine = same pixels as user's browser.

---

## State Persistence

```
~/.optagon/
├── config.yaml              # Global config
├── data/
│   └── optagon.db           # SQLite (frames table)
├── frames/
│   └── <frame-id>/
│       ├── config.yaml      # Frame-specific config
│       └── session.json     # Last session state
└── logs/
    └── frames/
        └── <frame-id>.log
```

---

## Roadmap Summary

| Phase | Focus | Key Deliverable |
|-------|-------|-----------------|
| 1 | Frame Lifecycle | Create/start/stop frames in Podman containers |
| 2 | Graphiti | Per-frame context persistence, query before tasks |
| 3 | Manager Agent | LLM orchestrator, Claude Code spawning, quality gates |
| 4 | Guake + TUI | D-Bus integration, dashboard for frame management |
| 5 | Remote Access | Web terminal, mobile access, JWT auth |

---

## Design Decisions

- **tmux vs Guake**: tmux for agents inside frames, Guake for user UI
- **Containerization**: Podman by default for isolation (port conflicts, process isolation)
- **Manager LLM**: Configurable per-frame (Claude, OpenAI, Ollama) with routing rules
- **New codebase**: Fresh `optagon-server` in TypeScript (Bun runtime)
- **Database**: SQLite for system state, Graphiti for frame context
- **Port mapping**: Auto-assign from 33000-34000 range
- **Browser vision**: Playwright + Chromium inside containers, MCP tool for screenshots
- **Frame config storage**: JSON blob in SQLite (flexible, evolvable)
