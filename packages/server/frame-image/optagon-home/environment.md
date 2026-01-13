# Environment Details

Complete reference for this Optagon frame.

## System

| Property | Value |
|----------|-------|
| OS | Ubuntu 24.04 |
| Shell | zsh |
| Terminal | tmux |
| Container | Podman |

## Directory Map

```
/
├── workspace/              # YOUR PROJECT (persists on host)
│   └── ...                 # Your code lives here
│
├── opt/
│   ├── optagon/            # This documentation
│   │   ├── README.md       # Start here
│   │   ├── tools/          # Tool documentation
│   │   └── environment.md  # You are here
│   │
│   └── browser-tool/       # Browser automation
│       └── browser-tool.ts # CLI source
│
├── root/                   # Home directory
│   ├── .bun/               # Bun installation
│   ├── .opencode/          # OpenCode installation
│   └── .tmux.conf          # tmux configuration
│
└── usr/local/bin/          # Custom commands
    ├── browser-tool        # Browser automation CLI
    └── frame-context       # Prints quick reference
```

## Persistence

| Path | Persists? | Notes |
|------|-----------|-------|
| `/workspace` | Yes | Mounted from host |
| `/workspace/.agent-data/` | Yes | Agent sessions, history |
| `/opt/*` | No | Part of image |
| `/root/*` | No | Symlinked where needed |
| `/tmp/*` | No | Temporary |

**Agent data persists automatically:**
- OpenCode sessions → `/workspace/.agent-data/opencode/`
- Claude Code data → `/workspace/.agent-data/claude/`

Use `/sessions` in OpenCode to restore previous conversations.

## Environment Variables

Set by Optagon:
```bash
OPTAGON_FRAME_ID        # UUID of this frame
OPTAGON_FRAME_NAME      # Name you gave the frame
```

API keys (if configured):
```bash
OPENROUTER_API_KEY      # For OpenCode/OpenRouter
ANTHROPIC_API_KEY       # For Claude
OPENAI_API_KEY          # For OpenAI
```

## Installed Software

### Node.js Ecosystem
- Node.js 22.x (`node`)
- npm (`npm`, `npx`)
- pnpm (`pnpm`)
- Bun (`bun`)
- Claude Code CLI (`claude`)
- OpenCode (`opencode`)

### Python
- Python 3.x (`python3`)
- pip (`pip3`)

### Browser Automation
- `browser-tool` CLI (navigate, screenshot, click, type, etc.)
- Playwright + Chromium (headless)
- See `.optagon/tools/browser/` for full docs

### Container Tools
- Docker CLI (`docker`)
- Docker Compose (`docker compose`)
- Tilt (`tilt`) - local K8s/Docker dev
- Commands run on host via socket passthrough

### Tilt Setup
```bash
# Start Tilt (UI available at $OPTAGON_TILT_PORT on host)
tilt up

# Check your Tilt port
echo $OPTAGON_TILT_PORT
```

### Utilities
- git
- ripgrep (`rg`)
- fd-find (`fd`)
- jq
- curl, wget
- htop
- tmux

## Networking

| Port | Purpose |
|------|---------|
| 3000 | Default dev server (mapped to host 33000-34000) |

Access from host: `http://localhost:<mapped-port>`
Check your mapped port: `optagon frame show <name>` on host.

Inside container, services see each other on localhost.

## Resource Limits

Default container has access to:
- All host CPU cores
- Memory limited by host
- Disk limited by host

No GPU by default. Flavors like `ml` may include GPU passthrough.

## Troubleshooting

### Command not found
```bash
which <command>           # Check if installed
echo $PATH                # Check PATH
```

### Permission denied
```bash
ls -la <file>             # Check permissions
# Probably trying to write outside /workspace
```

### Port in use
```bash
ss -tlnp | grep <port>    # What's using it
kill <pid>                # Stop it
```

### Out of memory
```bash
free -h                   # Check memory
htop                      # Find hungry process
```

### Container won't start
On host:
```bash
optagon frame events <name>   # Check logs
podman logs optagon-frame-<name>  # Container logs
```
