# Optagon Agent Environment

You are in an Optagon development frame.

## Quick Start

```bash
# You're in /workspace - your project files are here
ls

# Docs at .optagon/docs/
cat .optagon/docs/README.md
```

## Directory Structure

```
/workspace/                    # Your project (persists)
├── .optagon/                  # Frame config & docs
│   ├── docs/                  # → /opt/optagon (symlink)
│   │   ├── README.md          # You are here
│   │   ├── environment.md
│   │   ├── tools/
│   │   └── examples/
│   └── tmux-setup.sh          # Your startup script (create this)
├── .agent-data/               # Agent sessions (persists)
└── (your project files)
```

## What's Available

| File/Directory | Purpose | When to Read |
|----------------|---------|--------------|
| `.optagon/docs/tools/browser/` | Screenshot pages, click, type | UI work |
| `.optagon/docs/tools/search/` | Fast code search (rg, fd) | Finding code |
| `.optagon/docs/tools/shell/` | Available commands | Running stuff |
| `.optagon/docs/environment.md` | Full system details | Debugging |

## Key Facts

- **Project**: `/workspace` (persists)
- **Docs**: `.optagon/docs/`
- **Config**: `.optagon/tmux-setup.sh` (your startup script)
- **Sessions**: `.agent-data/` (persists across restarts)
- **tmux**: `Ctrl+b d` to detach
- **Docker**: `docker compose up` works

## Customizing Startup

To auto-create tmux windows on frame start:

```bash
cp .optagon/docs/examples/tmux-setup.sh .optagon/
# Edit .optagon/tmux-setup.sh - runs on every frame start
```

## First Task?

1. `ls` - check your project
2. `cat .optagon/docs/tools/shell/README.md` - see available commands
3. Start working
